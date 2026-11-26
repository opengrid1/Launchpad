// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IOneOracle} from "../onehook/IOneOracle.sol";

interface ILiqioERC4626 {
    function convertToAssets(uint256 shares) external view returns (uint256);
}

/// @title LiqioOracle
/// @notice USD prices for the pair tokens a Liqio coin can launch against, read from Hyperliquid itself.
///         HyperEVM exposes HyperCore's oracle prices as a precompile, so the price of HYPE, or of the stock
///         behind an xStock, comes straight from the exchange with no keeper, no signer and no delay.
///
///         The factory reads a price only at launch, to open every coin at its chosen USD market cap; trading
///         never depends on it. Prices are USD, 18 decimals, per 1e18 base units of the token (so a 6-decimal
///         stablecoin at $1 is 1e30).
///
///         Sources, set per token by the admin:
///           Fixed   a constant (stablecoins)
///           Core    a HyperCore market's oracle price (`index` as the precompile numbers markets: perps on the
///                   main book by their index, HIP-3 markets at 10000 * dex + index), times `multiplierE18`
///                   (an ETF of an index, say, at a tenth of it), times the token's ERC-4626 share ratio when it
///                   is a wrapper (the wrapped xStocks on HyperEVM accrue, so one share is a little more than
///                   one underlying).
contract LiqioOracle is IOneOracle {
    /// @dev HyperCore oracle price precompile: abi.encode(uint32 index) in, uint64 out, with 6 - szDecimals
    ///      decimals.
    address public constant ORACLE_PX = 0x0000000000000000000000000000000000000807;

    enum Kind {
        None,
        Fixed,
        Core
    }

    struct Source {
        Kind kind;
        uint32 index;
        uint8 szDecimals;
        uint8 decimals;
        bool erc4626;
        uint256 multiplierE18;
        uint256 fixedUsd18;
    }

    address public immutable admin;
    /// @notice Setup right of the deployer: sets sources at deploy time, then renounces. The admin keeps its own.
    address public owner;
    mapping(address token => Source) public sources;

    event SourceSet(address indexed token, Kind kind, uint32 index, uint256 multiplierE18, bool erc4626);
    event SourceRemoved(address indexed token);
    event OwnershipRenounced(address indexed owner);

    error NotAdmin();
    error NoPrice();
    error InvalidParams();

    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidParams();
        admin = admin_;
        owner = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin && msg.sender != owner) revert NotAdmin();
        _;
    }

    /// @notice Give up the deployer's setup right. Irreversible.
    function renounceOwnership() external {
        if (msg.sender != owner) revert NotAdmin();
        owner = address(0);
        emit OwnershipRenounced(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Admin: which market prices which token
    // ---------------------------------------------------------------------

    function setFixed(address token, uint256 usd18) external onlyAdmin {
        if (token == address(0) || usd18 == 0) revert InvalidParams();
        sources[token] = Source({kind: Kind.Fixed, index: 0, szDecimals: 0, decimals: 0, erc4626: false, multiplierE18: 1e18, fixedUsd18: usd18});
        emit SourceSet(token, Kind.Fixed, 0, 1e18, false);
    }

    function setCore(address token, uint32 index, uint8 szDecimals, uint256 multiplierE18, bool erc4626) external onlyAdmin {
        if (token == address(0) || szDecimals > 6 || multiplierE18 == 0 || multiplierE18 > 1e24) revert InvalidParams();
        uint8 dec = IERC20Metadata(token).decimals();
        if (dec > 18) revert InvalidParams();
        sources[token] = Source({kind: Kind.Core, index: index, szDecimals: szDecimals, decimals: dec, erc4626: erc4626, multiplierE18: multiplierE18, fixedUsd18: 0});
        // the market must answer now, so a typo cannot list a token with no price
        if (_corePx(index) == 0) revert NoPrice();
        emit SourceSet(token, Kind.Core, index, multiplierE18, erc4626);
    }

    function remove(address token) external onlyAdmin {
        delete sources[token];
        emit SourceRemoved(token);
    }

    // ---------------------------------------------------------------------
    // IOneOracle
    // ---------------------------------------------------------------------

    function price(address token) public view returns (uint256 usd18) {
        Source memory s = sources[token];
        if (s.kind == Kind.Fixed) return s.fixedUsd18;
        if (s.kind != Kind.Core) revert NoPrice();
        uint64 raw = _corePx(s.index);
        if (raw == 0) revert NoPrice();
        // raw has (6 - szDecimals) decimals: USD per whole token, 18 dp, is raw * 10^(12 + szDecimals);
        // per 1e18 base units that is scaled again by 10^(18 - decimals)
        usd18 = uint256(raw) * (10 ** (12 + uint256(s.szDecimals))) * (10 ** (18 - uint256(s.decimals)));
        usd18 = (usd18 * s.multiplierE18) / 1e18;
        if (s.erc4626) usd18 = (usd18 * ILiqioERC4626(token).convertToAssets(1e18)) / 1e18;
        if (usd18 == 0) revert NoPrice();
    }

    /// @notice The price a launch opens at: HyperCore's current oracle price.
    function launchPrice(address token) external view returns (uint256) {
        return price(token);
    }

    function poke(address token) external view returns (uint256) {
        return price(token);
    }

    function settled(address token) external view returns (bool) {
        return sources[token].kind != Kind.None;
    }

    // ---------------------------------------------------------------------

    function _corePx(uint32 index) internal view returns (uint64 px) {
        (bool ok, bytes memory r) = ORACLE_PX.staticcall(abi.encode(index));
        if (!ok || r.length != 32) return 0;
        px = abi.decode(r, (uint64));
    }
}
