// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The ERC-20 every launch deploys (HypexToken): fixed supply per chain at launch, holders can burn their own, and
///         the factory's bridge moves it between chains (burned on one, minted on the other).
interface IHypexToken is IERC20 {
    /// @notice Burns the caller's tokens; total supply goes down (the floor treats burned tokens as gone).
    function burn(uint256 amount) external;

    /// @notice HypexBridge only (the factory's bridge): mints coins that arrived from another chain.
    function bridgeMint(address to, uint256 amount) external;

    /// @notice HypexBridge only: burns `from`'s coins that leave for another chain (`from` is the bridge's caller).
    function bridgeBurn(address from, uint256 amount) external;
}
