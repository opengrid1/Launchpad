// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

interface IOneTokenPending {
    function pendingName() external view returns (string memory);
    function pendingSymbol() external view returns (string memory);
    function pendingMetadataURI() external view returns (string memory);
    function pendingSupply() external view returns (uint256);
}

/// @title OneToken
/// @notice A OneHook coin: a plain OpenZeppelin ERC-20 with EIP-2612 permits
///         and nothing else. The whole supply is minted once, at construction,
///         to the factory, which puts it into the coin's Uniswap v4 pool. No
///         owner, no mint, no pause, no blacklist, no tax, no upgrade path and
///         no transfer logic of any kind: a transfer can never revert beyond
///         the standard balance and allowance checks. Every instinct the coin
///         was born with lives in its pool hook, never here.
///
/// @dev    Name, symbol, metadata and supply are read back from the deployer
///         during construction (the pool-deployer pattern), which keeps the
///         init code constant: every coin's address is predictable with
///         CREATE2 and every coin verifies from the same source with no
///         constructor arguments.
contract OneToken is ERC20, ERC20Permit {
    string private _metadataURI;

    constructor()
        ERC20(IOneTokenPending(msg.sender).pendingName(), IOneTokenPending(msg.sender).pendingSymbol())
        ERC20Permit(IOneTokenPending(msg.sender).pendingName())
    {
        _metadataURI = IOneTokenPending(msg.sender).pendingMetadataURI();
        _mint(msg.sender, IOneTokenPending(msg.sender).pendingSupply());
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Never owned.
    function owner() external pure returns (address) {
        return address(0);
    }

    /// @notice Burn coins you hold. The hook burns buyback coins this way.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
