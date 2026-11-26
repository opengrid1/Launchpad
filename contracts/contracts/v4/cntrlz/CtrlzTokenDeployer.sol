// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CtrlzToken} from "./CtrlzToken.sol";

/// @title CtrlzTokenDeployer
/// @notice Creates cntrl-z coin contracts on the factory's behalf, so the
///         factory stays under the contract size limit. The coin is always
///         placed at an address below its pair token's, so in every pool the
///         coin is currency0 and the pair is currency1: the hook's liquidity
///         book only has to reason about one orientation.
contract CtrlzTokenDeployer {
    uint256 internal constant MAX_TRIES = 128;

    address public immutable deployer;
    address public factory;

    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error NoSalt();

    constructor() {
        deployer = msg.sender;
    }

    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotFactory();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice Deploy the coin at a salt derived from `salt` whose address is below `p.pairAsset`.
    function deploy(bytes32 salt, CtrlzToken.Init calldata p) external returns (address a) {
        if (msg.sender != factory || p.factory != factory) revert NotFactory();
        bytes32 hash = keccak256(abi.encodePacked(type(CtrlzToken).creationCode, abi.encode(p)));
        bytes32 s;
        for (uint256 i; i < MAX_TRIES; i++) {
            s = keccak256(abi.encode(salt, i));
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), s, hash)))));
            if (predicted < p.pairAsset && predicted.code.length == 0) {
                a = address(new CtrlzToken{salt: s}(p));
                return a;
            }
        }
        revert NoSalt();
    }
}
