// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ICtrlzPoolGate {
    function spend(bool intoPool, uint256 amount) external;
}

/// @title CtrlzToken
/// @notice A cntrl-z coin. Fixed supply, no owner, no mint, no pause, no
///         blacklist, no tax on transfers. The trade tax and the undo windows
///         live in the pool hook.
///
///         One pool: the coin only enters or leaves the Uniswap V4 PoolManager
///         as part of a swap in its own pool (the hook grants exactly that
///         amount for the transaction) or through the launchpad's own
///         contracts, and it refuses transfers into any other Uniswap V2/V3
///         style pool. Nobody can stand up a second pair for it.
///
///         Launch block: only the creator may receive coins from the pool, so
///         the creator's first buy can't be sniped in the same block.
contract CtrlzToken is ERC20 {
    address public immutable creator;
    address public immutable pairAsset;
    address public immutable poolManager;
    address public immutable factory;
    address public immutable hook;
    address public immutable converter;
    uint256 public immutable launchBlock;

    string private _metadataURI;

    error LaunchGuard();
    error OtherPool();
    error InvalidParams();

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
    }

    constructor(Init memory p) ERC20(p.name, p.symbol) {
        if (p.pairAsset == address(0) || p.factory == address(0) || p.hook == address(0)) revert InvalidParams();
        creator = p.creator;
        pairAsset = p.pairAsset;
        poolManager = p.poolManager;
        factory = p.factory;
        hook = p.hook;
        converter = p.converter;
        launchBlock = block.number;
        _metadataURI = p.metadataURI;
        _mint(p.factory, p.supply);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice Burn coins you hold. The hook burns window premiums this way.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _system(address a) private view returns (bool) {
        return a == factory || a == hook || (a == converter && a != address(0));
    }

    /// @dev The launchpad's own contracts move the coin freely; everyone else
    ///      reaches the PoolManager only through a swap in the coin's own pool,
    ///      and never reaches another V2/V3-style pool.
    function _gate(address from, address to, uint256 value) private {
        address pm = poolManager;
        if (to == pm) {
            if (from != address(0) && !_system(from)) ICtrlzPoolGate(hook).spend(true, value);
        } else if (from == pm) {
            if (!_system(to)) ICtrlzPoolGate(hook).spend(false, value);
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
        if (value > 0) _gate(from, to, value);
        super._update(from, to, value);
    }
}
