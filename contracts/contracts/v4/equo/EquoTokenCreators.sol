// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EquoToken, IEquoTokenPending} from "./EquoToken.sol";
import {EquoDivToken, IEquoDivTokenPending} from "./EquoDivToken.sol";

/// @dev Shared by both creators: only the token deployer may create, and a coin under construction reads its
///      settings back through here from the deployer.
abstract contract EquoCreatorBase {
    address public immutable tokenDeployer;
    bytes32 public immutable initCodeHash;

    error NotDeployer();

    constructor(address tokenDeployer_, bytes32 initCodeHash_) {
        tokenDeployer = tokenDeployer_;
        initCodeHash = initCodeHash_;
    }

    function pendingName() external view returns (string memory) {
        return IEquoTokenPending(tokenDeployer).pendingName();
    }

    function pendingSymbol() external view returns (string memory) {
        return IEquoTokenPending(tokenDeployer).pendingSymbol();
    }

    function pendingMetadataURI() external view returns (string memory) {
        return IEquoTokenPending(tokenDeployer).pendingMetadataURI();
    }

    function pendingSupply() external view returns (uint256) {
        return IEquoTokenPending(tokenDeployer).pendingSupply();
    }

    function pendingLz() external view returns (address, address, address) {
        return IEquoTokenPending(tokenDeployer).pendingLz();
    }

    /// @notice Address a coin created with salt `s` would get.
    function predict(bytes32 s) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), s, initCodeHash)))));
    }
}

/// @title EquoTokenCreator
/// @notice Holds the creation code of a plain Equo coin, so the token deployer stays under the size limit.
contract EquoTokenCreator is EquoCreatorBase {
    constructor(address tokenDeployer_) EquoCreatorBase(tokenDeployer_, keccak256(type(EquoToken).creationCode)) {}

    function create(bytes32 s) external returns (address) {
        if (msg.sender != tokenDeployer) revert NotDeployer();
        return address(new EquoToken{salt: s}());
    }
}

/// @title EquoDivTokenCreator
/// @notice Holds the creation code of an Equo coin with holder rewards.
contract EquoDivTokenCreator is EquoCreatorBase {
    constructor(address tokenDeployer_) EquoCreatorBase(tokenDeployer_, keccak256(type(EquoDivToken).creationCode)) {}

    function pendingDivWiring() external view returns (address, address, address, address, address, address) {
        return IEquoDivTokenPending(tokenDeployer).pendingDivWiring();
    }

    function create(bytes32 s) external returns (address) {
        if (msg.sender != tokenDeployer) revert NotDeployer();
        return address(new EquoDivToken{salt: s}());
    }
}
