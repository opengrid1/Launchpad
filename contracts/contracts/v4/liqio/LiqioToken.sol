// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";

/// @title LiqioToken
/// @notice A Liqio coin on HyperEVM: an ERC-20 with EIP-2612 permits and a fixed supply, minted once at
///         creation to the factory, which puts all of it into the coin's Uniswap v4 pool. No owner, no mint,
///         no pause, no blacklist, no tax on transfers. Every instinct the coin was born with lives in its pool hook.
///
/// @dev    Every coin is a minimal proxy (EIP-1167 clone) of one implementation, so a launch deploys 45 bytes
///         of code instead of 13 KB and fits inside HyperEVM's 3M-gas small blocks. A clone is initialized in
///         the same transaction that creates it, by the token deployer; the implementation itself can never be.
contract LiqioToken is Initializable, ERC20Upgradeable, ERC20PermitUpgradeable {
    string private _metadataURI;

    constructor() {
        _disableInitializers();
    }

    function initialize(string calldata name_, string calldata symbol_, string calldata uri, uint256 supply, address to) external virtual initializer {
        _init(name_, symbol_, uri, supply, to);
    }

    function _init(string calldata name_, string calldata symbol_, string calldata uri, uint256 supply, address to) internal {
        __ERC20_init(name_, symbol_);
        __ERC20Permit_init(name_);
        _metadataURI = uri;
        _mint(to, supply);
    }

    function metadataURI() external view returns (string memory) {
        return _metadataURI;
    }

    /// @notice Burn coins you hold. The hook burns buyback coins this way.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
