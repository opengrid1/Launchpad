// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

interface IPadPoolGate {
    function spend(bool intoPool, uint256 amount) external;
}

/// @title PadToken
/// @notice A launchpad coin on Base. Fixed supply, minted once. No owner, no mint, no pause,
///         no blacklist, no transfer tax. All market mechanics (fee, anti-snipe, anti-sandwich)
///         live in the pool hook; the token itself never changes.
///
///         One pool: the coin only enters or leaves the Uniswap V4 PoolManager as part of a swap
///         in its own pool (the hook grants exactly that amount for the transaction) or through
///         the launchpad's own contracts, and it refuses transfers into any other V2/V3-style
///         pool. Nobody can stand up a second market for it.
///
///         Launch block: only the creator may receive coins from the pool, so the creator's first
///         buy can't be sniped in the same block.
contract PadToken is ERC20, ERC20Burnable {
    uint256 public constant SUPPLY = 1_000_000_000 ether;

    address public immutable creator;
    address public immutable factory;
    address public immutable hook;
    address public immutable poolManager;
    uint256 public immutable launchBlock;

    string private _metadataURI;

    error OtherPool();
    error LaunchGuard();
    error InvalidParams();

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        address creator;
        address factory;
        address hook;
        address poolManager;
    }

    constructor(Init memory p) ERC20(p.name, p.symbol) {
        if (p.factory == address(0) || p.hook == address(0)) revert InvalidParams();
        creator = p.creator;
        factory = p.factory;
        hook = p.hook;
        poolManager = p.poolManager;
        launchBlock = block.number;
        _metadataURI = p.metadataURI;
        _mint(p.factory, SUPPLY);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    function _system(address a) private view returns (bool) {
        return a == factory || a == hook;
    }

    /// @dev The launchpad's own contracts move the coin freely; everyone else reaches the
    ///      PoolManager only through a swap in the coin's own pool, and never another V2/V3 pool.
    function _gate(address from, address to, uint256 value) private {
        address pm = poolManager;
        if (to == pm) {
            if (from != address(0) && !_system(from)) IPadPoolGate(hook).spend(true, value);
        } else if (from == pm) {
            if (!_system(to)) IPadPoolGate(hook).spend(false, value);
        } else if (to != address(0) && to.code.length != 0 && !_system(to) && _isPoolOfThis(to)) {
            revert OtherPool();
        }
    }

    function _isPoolOfThis(address a) private view returns (bool) {
        return _side(a, 0x0dfe1681) || _side(a, 0xd21220a7); // token0(), token1()
    }

    function _side(address a, bytes4 sel) private view returns (bool) {
        (bool ok, bytes memory r) = a.staticcall{gas: 10_000}(abi.encodeWithSelector(sel));
        return ok && r.length == 32 && abi.decode(r, (address)) == address(this);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Launch block: coins leaving the pool may only reach the creator.
        if (block.number == launchBlock && from == poolManager && !_system(to) && to != address(0) && value > 0) {
            if (to != creator) revert LaunchGuard();
        }
        if (value > 0) _gate(from, to, value);
        super._update(from, to, value);
    }
}
