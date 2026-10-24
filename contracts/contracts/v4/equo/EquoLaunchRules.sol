// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EquoHook} from "./EquoHook.sol";

/// @title EquoLaunchRules
/// @notice The factory's launch-time rules on a coin's instincts, as a linked library so the factory stays under
///         the contract size limit. Pure validation only: nothing here touches state.
///
///         The hook enforces the constitution's caps on its own at registration; these rules are the factory's
///         stricter launch checks on top (paired settings, thresholds, and the one-way evolution path).
library EquoLaunchRules {
    error BadGenes();

    /// @dev The constitution's bounds on a coin's instincts, plus the pairing rules between settings.
    function checkGenes(EquoHook.Genes calldata g, EquoHook hook) public view {
        if (g.feeMode > 2) revert BadGenes();
        if (g.feeBps < hook.MIN_FEE_BPS() || g.feeBps > hook.MAX_FEE_BPS()) revert BadGenes();
        if ((g.snipeBps == 0) != (g.snipeBlocks == 0)) revert BadGenes();
        if (g.snipeBps != 0 && (g.snipeBps <= g.feeBps || g.snipeBps > hook.MAX_SNIPE_BPS() || g.snipeBlocks < 5 || g.snipeBlocks > hook.MAX_SNIPE_BLOCKS())) revert BadGenes();
        if ((g.buybackShareBps == 0) != (g.buybackThreshold == 0)) revert BadGenes();
        if (g.buybackShareBps > hook.MAX_POT_EACH_BPS() || g.divShareBps > hook.MAX_POT_EACH_BPS()) revert BadGenes();
        if (uint256(g.buybackShareBps) + g.divShareBps > hook.MAX_POT_SHARE_BPS()) revert BadGenes();
        if (g.buybackShareBps != 0 && g.buybackThreshold < 1_000) revert BadGenes();
        if ((g.maxWalletBps == 0) != (g.maxWalletSecs == 0)) revert BadGenes();
        if (g.maxWalletBps != 0 && (g.maxWalletBps < 50 || g.maxWalletBps > 2_000 || g.maxWalletSecs < 600 || g.maxWalletSecs > 30 days)) revert BadGenes();
    }

    /// @dev A later stage may only help holders versus the one before it: the fee can only fall, the buyback and
    ///      dividend shares can only grow, and anti-snipe and max-wallet can only ease (never tighten or
    ///      re-enable). The fee engine stays the same so a coin can't flip to a harsher mode. Anti-snipe eases on
    ///      BOTH axes (peak and window), so a later stage can never re-arm or lengthen the buy tax; and once a
    ///      buyback is on, its trigger threshold can only fall, so a stage can never neuter the automatic
    ///      buy-and-burn while keeping its share.
    function checkEvolve(EquoHook.Genes memory a, EquoHook.Genes calldata b) public pure {
        if (b.feeMode != a.feeMode) revert BadGenes();
        if (b.feeBps > a.feeBps) revert BadGenes();
        if (b.snipeBps > a.snipeBps) revert BadGenes();
        if (b.snipeBlocks > a.snipeBlocks) revert BadGenes();
        if (b.buybackShareBps < a.buybackShareBps) revert BadGenes();
        if (a.buybackShareBps != 0 && b.buybackThreshold > a.buybackThreshold) revert BadGenes();
        if (b.divShareBps < a.divShareBps) revert BadGenes();
        if (a.maxWalletBps == 0) {
            if (b.maxWalletBps != 0) revert BadGenes();
        } else {
            if (b.maxWalletBps != 0 && b.maxWalletBps < a.maxWalletBps) revert BadGenes();
            if (b.maxWalletSecs > a.maxWalletSecs) revert BadGenes();
        }
    }
}
