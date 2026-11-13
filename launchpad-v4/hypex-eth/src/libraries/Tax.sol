// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FullMath} from "v4-core/src/libraries/FullMath.sol";

/// @notice The swap tax: its rate over a pool's life and how it is split. Rates are in pips (1e6 = 100%) and always taken
///         on the quote leg's gross amount, rounded up (against the trader).
library Tax {
    uint256 internal constant PIPS = 1_000_000;
    /// @dev 2.5%: 0.5% floor / 0.7% creator / 0.7% trader airdrop / 0.6% protocol (team). The airdrop rides with the
    ///      protocol share into HypexRevenue, which books it to the trader (HypexRevenue.credit)
    uint256 internal constant BASE = 25_000;
    /// @dev The snipe window: 90% at second 0, linear down to BASE at SNIPE_SECONDS
    uint256 internal constant SNIPE_START = 900_000;
    uint256 internal constant SNIPE_SECONDS = 60;
    /// @dev The snipe window's split: this much to the $HYPEX buy-and-burn ($HYPEX's own pool: its creator fee, HYPEX's
    ///      revenue), the rest to the floor (vesting), none to the creator
    uint256 internal constant SNIPE_BURN_PCT = 40;

    /// @dev Rate `elapsed` seconds after launch, and whether that's still the snipe window.
    function rate(uint256 elapsed) internal pure returns (uint256 r, bool snipe) {
        if (elapsed >= SNIPE_SECONDS) return (BASE, false);
        return (SNIPE_START - (SNIPE_START - BASE) * elapsed / SNIPE_SECONDS, true);
    }

    /// @dev Tax on a gross amount: r of it.
    function ofGross(uint256 gross, uint256 r) internal pure returns (uint256) {
        return FullMath.mulDivRoundingUp(gross, r, PIPS);
    }

    /// @dev The gross amount whose net (after r) is `net`; the tax is the difference.
    function grossUp(uint256 net, uint256 r) internal pure returns (uint256) {
        return FullMath.mulDivRoundingUp(net, PIPS, PIPS - r);
    }

    /// @dev A normal (post-snipe) tax's creator share (28%: 0.7% of the trade); the floor gets 20% (0.5%).
    function creatorShare(uint256 tax) internal pure returns (uint256) {
        return tax * 7 / 25;
    }

    /// @dev A normal (post-snipe) tax's protocol share (52%: 1.3% of the trade): the trader's airdrop (0.7%, 7/13 of it)
    ///      and the team's (0.6%), split by HypexRevenue.credit.
    function protocolShare(uint256 tax) internal pure returns (uint256) {
        return tax * 13 / 25;
    }

    /// @dev A snipe-window tax's burn share; the floor gets the rest.
    function snipeBurn(uint256 tax) internal pure returns (uint256) {
        return tax * SNIPE_BURN_PCT / 100;
    }
}
