// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title ProtocolConfig
/// @notice Single source of truth for the fixed protocol rules. Both the
///         TokenFactory and the Launchpad read from here, so the two can
///         never disagree and nothing is user-configurable.
library ProtocolConfig {
    uint16 internal constant BPS = 10_000;

    /// @notice Every token launches with this exact supply (18 decimals).
    uint256 internal constant TOTAL_SUPPLY = 1_000_000_000e18;
    /// @notice Uniswap V3 fee tier every pool is created with (1%), so the
    ///         pool tax bots and aggregators pay matches the platform's 1%.
    uint24 internal constant FEE_TIER = 10000;
    /// @notice Flat 1% trading fee, paid entirely to the token creator.
    uint16 internal constant TRADE_FEE_BPS = 100;
    /// @notice Max transaction while limits are active: 2% of supply.
    uint16 internal constant MAX_TX_BPS = 200;
    /// @notice Max wallet while limits are active: 2% of supply.
    uint16 internal constant MAX_WALLET_BPS = 200;
    /// @notice Market cap (USD, 8 decimals) every token starts trading at.
    uint256 internal constant INITIAL_MCAP_USD = 2_000e8;

    function maxTxAmount() internal pure returns (uint256) {
        return (TOTAL_SUPPLY * MAX_TX_BPS) / BPS;
    }

    function maxWalletAmount() internal pure returns (uint256) {
        return (TOTAL_SUPPLY * MAX_WALLET_BPS) / BPS;
    }
}
