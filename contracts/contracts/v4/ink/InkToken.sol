// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title InkToken
/// @notice A plain, immutable launch coin for the Ink launchpad. Ink has no
///         native token predeploy (unlike Base's B20), so each coin is a
///         standard ERC20: the full fixed supply is minted to the launcher
///         (the factory) at construction, and there is no owner, no minter and
///         no further mint path — supply is fixed forever the moment it deploys.
contract InkToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address to)
        ERC20(name_, symbol_)
    {
        _mint(to, supply);
    }
}
