// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev Chainlink-compatible aggregator for tests.
contract MockAggregator {
    int256 public answer;
    uint8 public immutable decimals;

    constructor(int256 answer_, uint8 decimals_) {
        answer = answer_;
        decimals = decimals_;
    }

    /// @dev 0 = report the current block time (fresh); otherwise a fixed time.
    uint256 public updatedAtOverride;

    function setAnswer(int256 answer_) external {
        answer = answer_;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAtOverride = t;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        uint256 t = updatedAtOverride == 0 ? block.timestamp : updatedAtOverride;
        return (1, answer, t, t, 1);
    }
}
