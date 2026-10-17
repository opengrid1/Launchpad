// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice USD price of ONE RAW unit (1e18) of a tokenized stock, scaled 1e18.
///
///         "Raw" is the ERC-20 balanceOf unit. Robinhood stock tokens (ERC-8056)
///         express splits and dividends through a `uiMultiplier` that scales the
///         EFFECTIVE share count while raw balances stay fixed. The lending market
///         accounts every position in raw units, so corporate actions never touch
///         its ledger; the oracle is the single place the multiplier is applied:
///
///             pricePerRaw = marketPricePerShare * uiMultiplier
///
///         A dividend therefore raises the value of a borrower's raw debt, which is
///         exactly TradFi's "dividend in lieu" owed by a short seller to the lender.
interface IStockOracle {
    /// @dev Reverts if the price is stale or unset.
    function getPrice(address stock) external view returns (uint256 pricePerRaw18);
}
