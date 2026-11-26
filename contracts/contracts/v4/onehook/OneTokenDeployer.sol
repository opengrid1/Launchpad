// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {OneToken} from "./OneToken.sol";
import {OneDivToken} from "./OneDivToken.sol";

/// @title OneTokenDeployer
/// @notice Creates OneHook coin contracts on the factory's behalf, so the
///         factory stays under the contract size limit. Coins without the
///         dividends instinct get OneToken (a plain ERC-20 with permits);
///         coins born with it get OneDivToken. Either way the coin reads its
///         name, symbol, metadata and supply back from here during
///         construction, so each variant's init code is constant: addresses
///         are predictable with CREATE2 and every coin verifies from the same
///         source with no constructor arguments.
///
///         The coin is always placed at an address below its pair token's, so
///         in every pool the coin is currency0 and the pair is currency1: the
///         hook only has to reason about one orientation.
contract OneTokenDeployer {
    uint256 internal constant MAX_TRIES = 128;

    address public immutable deployer;
    bytes32 public immutable tokenInitCodeHash;
    bytes32 public immutable divTokenInitCodeHash;
    address public factory;

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        uint256 supply;
        address pairAsset;
        address poolManager;
        address hook;
        address converter;
        address weth;
        bool dividends;
    }

    Init private _pending;

    event FactorySet(address indexed factory);

    error NotFactory();
    error AlreadySet();
    error ZeroAddress();
    error NoSalt();

    constructor() {
        deployer = msg.sender;
        tokenInitCodeHash = keccak256(type(OneToken).creationCode);
        divTokenInitCodeHash = keccak256(type(OneDivToken).creationCode);
    }

    function setFactory(address factory_) external {
        if (msg.sender != deployer) revert NotFactory();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    // The coin under construction reads its configuration back from here.
    function pendingName() external view returns (string memory) {
        return _pending.name;
    }

    function pendingSymbol() external view returns (string memory) {
        return _pending.symbol;
    }

    function pendingMetadataURI() external view returns (string memory) {
        return _pending.metadataURI;
    }

    function pendingSupply() external view returns (uint256) {
        return _pending.supply;
    }

    function pendingDivWiring() external view returns (address, address, address, address, address, address) {
        return (_pending.pairAsset, _pending.poolManager, factory, _pending.hook, _pending.converter, _pending.weth);
    }

    /// @notice Deploy the coin at a salt derived from `salt` whose address is
    ///         below `p.pairAsset`, and hand the factory the whole supply.
    function deploy(bytes32 salt, Init calldata p) external returns (address a) {
        if (msg.sender != factory) revert NotFactory();
        bytes32 hash = p.dividends ? divTokenInitCodeHash : tokenInitCodeHash;
        bytes32 s;
        for (uint256 i; i < MAX_TRIES; i++) {
            s = keccak256(abi.encode(salt, i));
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), s, hash)))));
            if (predicted < p.pairAsset && predicted.code.length == 0) {
                _pending = p;
                a = p.dividends ? address(new OneDivToken{salt: s}()) : address(new OneToken{salt: s}());
                delete _pending;
                OneToken(a).transfer(factory, p.supply);
                return a;
            }
        }
        revert NoSalt();
    }
}
