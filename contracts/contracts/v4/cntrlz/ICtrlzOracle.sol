// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @dev The Etherhook price oracle already on mainnet: USD prices (18 dp per whole token)
///      for WETH, gold and every Ondo tokenized stock, from Chainlink, listings or pool TWAPs.
interface ICtrlzOracle {
    function price(address token) external view returns (uint256 usd18);
    function launchPrice(address token) external returns (uint256 usd18);
    function poke(address token) external returns (uint256 usd18);
    function settled(address token) external view returns (bool);
}
