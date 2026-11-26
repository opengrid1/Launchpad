// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOneOracle} from "../onehook/IOneOracle.sol";

/// @title EquoPriceBook
/// @notice USD prices for pair tokens on chains with no on-chain oracle of our own. Price updaters (the launch
///         service) post prices; a launch only accepts a price posted within `maxAge`, so every chain of a
///         multichain launch opens at the same USD market cap. Prices are USD with 18 decimals per 1e18 base units.
///
///         The factory only reads a price at launch, to set the opening price; trading never depends on it.
contract EquoPriceBook is IOneOracle {
    address public immutable admin;
    mapping(address => bool) public updaters;
    /// @notice A launch rejects a price older than this.
    uint256 public maxAge = 1 hours;

    struct Px {
        uint192 usd18;
        uint64 at;
    }

    mapping(address token => Px) public prices;

    event UpdaterSet(address indexed updater, bool allowed);
    event PriceSet(address indexed token, uint256 usd18);
    event MaxAgeSet(uint256 maxAge);

    error NotAdmin();
    error NotUpdater();
    error NoPrice();
    error Stale();
    error InvalidParams();

    constructor(address admin_) {
        if (admin_ == address(0)) revert InvalidParams();
        admin = admin_;
        updaters[admin_] = true;
    }

    function setUpdater(address u, bool allowed) external {
        if (msg.sender != admin) revert NotAdmin();
        updaters[u] = allowed;
        emit UpdaterSet(u, allowed);
    }

    function setMaxAge(uint256 secs) external {
        if (msg.sender != admin) revert NotAdmin();
        if (secs < 60 || secs > 1 days) revert InvalidParams();
        maxAge = secs;
        emit MaxAgeSet(secs);
    }

    function setPrices(address[] calldata tokens, uint256[] calldata usd18) external {
        if (!updaters[msg.sender]) revert NotUpdater();
        if (tokens.length != usd18.length) revert InvalidParams();
        for (uint256 i; i < tokens.length; i++) {
            if (usd18[i] == 0 || usd18[i] > type(uint192).max) revert InvalidParams();
            prices[tokens[i]] = Px(uint192(usd18[i]), uint64(block.timestamp));
            emit PriceSet(tokens[i], usd18[i]);
        }
    }

    function price(address token) public view returns (uint256) {
        Px memory p = prices[token];
        if (p.usd18 == 0) revert NoPrice();
        return p.usd18;
    }

    /// @notice The price a launch opens at: must be fresh.
    function launchPrice(address token) external view returns (uint256) {
        Px memory p = prices[token];
        if (p.usd18 == 0) revert NoPrice();
        if (block.timestamp > p.at + maxAge) revert Stale();
        return p.usd18;
    }

    function poke(address token) external view returns (uint256) {
        return price(token);
    }

    function settled(address token) external view returns (bool) {
        return prices[token].usd18 != 0;
    }
}
