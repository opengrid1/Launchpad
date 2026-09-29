// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Plain mintable ERC-20 for tests.
contract MockToken is ERC20 {
    uint8 private immutable _dec;
    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) { _dec = d; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Stands in for the launchpad router: takes the pair by allowance and
///      pays a fixed ETH rate per whole unit, funded by tests.
contract MockConverter {
    uint256 public ethPerUnit; // wei per 1e18 of pair
    constructor(uint256 rate) { ethPerUnit = rate; }
    receive() external payable {}
    function pairToEth(address pair, uint256 amount, address to, uint256 minOut, bytes calldata) external returns (uint256 ethOut) {
        IERC20(pair).transferFrom(msg.sender, address(this), amount);
        ethOut = (amount * ethPerUnit) / 1e18;
        require(ethOut >= minOut, "slippage");
        (bool ok,) = to.call{value: ethOut}("");
        require(ok, "send");
    }
}
