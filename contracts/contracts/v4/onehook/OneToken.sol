// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IOnePoolGate {
    function spend(bool intoPool, uint256 amount) external;
}

interface IWrappedNativeToken {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// @title OneToken
/// @notice A OneHook coin. Fixed supply, no owner, no mint, no pause, no
///         blacklist, no tax on transfers. The swap fee and every instinct the
///         coin was born with live in the pool hook; the two instincts a pool
///         can't enforce live here, fixed at launch:
///
///         Max-wallet: for an opening window no wallet may hold more than a
///         set share of the supply. Sells (transfers into the PoolManager) are
///         never blocked, and the cap lifts by itself at a time everyone can
///         read; nothing can re-arm or tighten it.
///
///         Dividends: the hook forwards the coin's dividend share of fees here
///         in the pair asset; holders claim pro-rata (as ETH for a WETH pair).
///         The launchpad's own contracts and the pool hold no claimable shares.
///
///         One pool: the coin only enters or leaves the Uniswap V4 PoolManager
///         as part of a swap in its own pool (the hook grants exactly that
///         amount for the transaction) or through the launchpad's own
///         contracts, and it refuses transfers into any other Uniswap V2/V3
///         style pool. Nobody can stand up a second pair for it.
///
///         Launch block: only the creator may receive coins from the pool, so
///         the creator's first buy can't be sniped in the same block.
contract OneToken is ERC20 {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAG = 1 << 128;

    address public immutable creator;
    address public immutable pairAsset;
    address public immutable poolManager;
    address public immutable factory;
    address public immutable hook;
    address public immutable converter;
    address public immutable weth;
    uint256 public immutable launchBlock;
    /// @notice Largest balance a wallet may hold while the cap is live (0: no cap).
    uint256 public immutable maxWalletAmount;
    /// @notice When the max-wallet cap lifts, as a timestamp (0: no cap).
    uint256 public immutable maxWalletUntil;
    bool public immutable dividendsOn;

    string private _metadataURI;

    /// @notice Supply held by claimable wallets (everything outside the pool and the launchpad's contracts).
    uint256 public totalShares;
    /// @notice Pair units distributed to holders so far.
    uint256 public totalDividends;
    uint256 private _magnifiedPerShare;
    mapping(address => int256) private _corrections;
    mapping(address => uint256) public withdrawnDividends;

    error LaunchGuard();
    error OtherPool();
    error InvalidParams();
    error MaxWallet();
    error NotHook();
    error NoShares();

    event DividendsDistributed(uint256 amount);
    event DividendsClaimed(address indexed holder, uint256 amount);

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        uint256 supply;
        address creator;
        address factory;
        address pairAsset;
        address poolManager;
        address hook;
        address converter;
        address weth;
        uint16 maxWalletBps;
        uint32 maxWalletSecs;
        bool dividends;
    }

    constructor(Init memory p) ERC20(p.name, p.symbol) {
        if (p.pairAsset == address(0) || p.factory == address(0) || p.hook == address(0) || p.weth == address(0)) revert InvalidParams();
        creator = p.creator;
        pairAsset = p.pairAsset;
        poolManager = p.poolManager;
        factory = p.factory;
        hook = p.hook;
        converter = p.converter;
        weth = p.weth;
        launchBlock = block.number;
        maxWalletAmount = p.maxWalletBps == 0 ? 0 : (p.supply * p.maxWalletBps) / BPS;
        maxWalletUntil = p.maxWalletBps == 0 ? 0 : block.timestamp + p.maxWalletSecs;
        dividendsOn = p.dividends;
        _metadataURI = p.metadataURI;
        _mint(p.factory, p.supply);
    }

    /// @dev Dividends on a WETH pair are claimed as ETH; the unwrap lands here first.
    receive() external payable {}

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice Burn coins you hold. The hook burns buyback coins this way.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Dividends
    // ---------------------------------------------------------------------

    /// @notice Record `amount` of the pair asset (already transferred here by
    ///         the hook) as dividends for current holders. Hook only.
    function distribute(uint256 amount) external {
        if (msg.sender != hook) revert NotHook();
        if (!dividendsOn || amount == 0) revert InvalidParams();
        if (totalShares == 0) revert NoShares();
        _magnifiedPerShare += (amount * MAG) / totalShares;
        totalDividends += amount;
        emit DividendsDistributed(amount);
    }

    /// @notice Pair units `a` can claim right now.
    function withdrawableDividends(address a) public view returns (uint256) {
        if (!dividendsOn || _noShares(a)) return 0;
        uint256 acc = uint256(int256(_magnifiedPerShare * balanceOf(a)) + _corrections[a]) / MAG;
        return acc - withdrawnDividends[a];
    }

    /// @notice Claim your dividend share: ETH for a WETH pair, otherwise the pair token.
    function claimDividends() external returns (uint256 amount) {
        amount = withdrawableDividends(msg.sender);
        if (amount == 0) return 0;
        withdrawnDividends[msg.sender] += amount;
        if (pairAsset == weth) {
            IWrappedNativeToken(weth).withdraw(amount);
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) {
                // a contract that refuses ETH gets WETH instead
                IWrappedNativeToken(weth).deposit{value: amount}();
                IERC20(weth).safeTransfer(msg.sender, amount);
            }
        } else {
            IERC20(pairAsset).safeTransfer(msg.sender, amount);
        }
        emit DividendsClaimed(msg.sender, amount);
    }

    /// @dev The pool, the launchpad's contracts and this contract hold no claimable shares.
    function _noShares(address a) private view returns (bool) {
        return a == address(0) || a == poolManager || a == address(this) || _system(a);
    }

    /// @dev Keep every holder's already-accrued dividends unchanged as balances move.
    function _moveShares(address from, address to, uint256 value) private {
        uint256 m = _magnifiedPerShare * value;
        if (!_noShares(from)) {
            _corrections[from] += int256(m);
            totalShares -= value;
        }
        if (!_noShares(to)) {
            _corrections[to] -= int256(m);
            totalShares += value;
        }
    }

    // ---------------------------------------------------------------------
    // Transfer rules
    // ---------------------------------------------------------------------

    function _system(address a) private view returns (bool) {
        return a == factory || a == hook || (a == converter && a != address(0));
    }

    /// @dev The launchpad's own contracts move the coin freely; everyone else
    ///      reaches the PoolManager only through a swap in the coin's own pool,
    ///      and never reaches another V2/V3-style pool.
    function _gate(address from, address to, uint256 value) private {
        address pm = poolManager;
        if (to == pm) {
            if (from != address(0) && !_system(from)) IOnePoolGate(hook).spend(true, value);
        } else if (from == pm) {
            if (!_system(to)) IOnePoolGate(hook).spend(false, value);
        } else if (to != address(0) && to.code.length != 0 && !_system(to) && _isPoolOfThis(to)) {
            revert OtherPool();
        }
    }

    /// @dev A Uniswap V2/V3-style pool that holds this coin (token0 or token1 is this).
    function _isPoolOfThis(address a) private view returns (bool) {
        return _side(a, 0x0dfe1681) || _side(a, 0xd21220a7); // token0(), token1()
    }

    function _side(address a, bytes4 sel) private view returns (bool) {
        (bool ok, bytes memory r) = a.staticcall{gas: 10_000}(abi.encodeWithSelector(sel));
        return ok && r.length == 32 && abi.decode(r, (address)) == address(this);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Launch block: coins leaving the pool (or the router passing them on) may only reach the creator.
        if (block.number == launchBlock && (from == poolManager || (from == converter && from != address(0))) && !_system(to) && to != address(0) && value > 0) {
            if (to != creator) revert LaunchGuard();
        }
        if (value > 0) {
            _gate(from, to, value);
            // Max-wallet: caps what a wallet can receive while live; never touches a sell.
            if (maxWalletAmount != 0 && block.timestamp < maxWalletUntil && to != address(0) && to != poolManager && !_system(to)) {
                if (balanceOf(to) + value > maxWalletAmount) revert MaxWallet();
            }
        }
        super._update(from, to, value);
        if (dividendsOn && value > 0) _moveShares(from, to, value);
    }
}
