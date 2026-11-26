// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IOneOracle} from "../IOneOracle.sol";

/// @dev Test stand-in for the mainnet price oracle: a settable USD price
///      (18 dp per whole token) per pair asset.
contract MockOneOracle is IOneOracle {
    mapping(address => uint256) public prices;

    function set(address token, uint256 usd18) external {
        prices[token] = usd18;
    }

    function price(address token) external view returns (uint256) {
        return prices[token];
    }

    function launchPrice(address token) external view returns (uint256) {
        require(prices[token] != 0, "no price");
        return prices[token];
    }

    function poke(address token) external view returns (uint256) {
        return prices[token];
    }

    function settled(address) external pure returns (bool) {
        return true;
    }
}
