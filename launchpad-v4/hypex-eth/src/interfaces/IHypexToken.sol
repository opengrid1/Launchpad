// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The ERC-20 every launch deploys (HypexToken): fixed supply per chain at launch, holders can burn their own, and
///         the factory's bridge moves it between chains (burned on one by its holder, minted on the other, capped).
interface IHypexToken is IERC20 {
    /// @notice Burns the caller's tokens; total supply goes down (the floor treats burned tokens as gone).
    function burn(uint256 amount) external;

    /// @notice HypexBridge only (the factory's bridge): mints coins that arrived from another chain, never past MAX_SUPPLY.
    function bridgeMint(address to, uint256 amount) external;
}
