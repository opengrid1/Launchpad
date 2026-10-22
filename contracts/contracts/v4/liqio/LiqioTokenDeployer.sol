// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LiqioToken} from "./LiqioToken.sol";
import {LiqioDivToken} from "./LiqioDivToken.sol";

/// @title LiqioTokenDeployer
/// @notice Creates Liqio coins for the factory on HyperEVM. Same interface the Equo factory already speaks
///         (`deploy` and `predict`), so the factory, hook and router are reused unchanged.
///
///         A coin is a CREATE2 clone of one of two implementations (plain, or with holder rewards), at the
///         first salt derived from the launch salt whose address sorts below the pair token, so the coin is
///         always currency0 in its pool. The whole supply is minted to the factory in the same call. A clone
///         costs a few thousand gas to deploy instead of a few million, which is what lets a launch run in
///         HyperEVM's 3M-gas small blocks.
contract LiqioTokenDeployer {
    uint256 internal constant MAX_TRIES = 512;

    /// @notice Sets the factory, once.
    address public immutable admin;
    address public immutable tokenImpl;
    address public immutable divTokenImpl;
    address public factory;

    /// @dev Field for field the same struct the Equo factory encodes; `bridgeFeeTo` is unused on HyperEVM.
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
        address bridgeFeeTo;
        bool dividends;
    }

    /// @notice Coins created here.
    mapping(address => bool) public isCoin;

    event FactorySet(address indexed factory);
    event CoinCreated(address indexed coin, bytes32 salt, bool dividends);

    error NotFactory();
    error NotAdmin();
    error AlreadySet();
    error ZeroAddress();
    error NoSalt();
    error NoPeers();

    constructor(address admin_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        tokenImpl = address(new LiqioToken());
        divTokenImpl = address(new LiqioDivToken());
    }

    function setFactory(address factory_) external {
        if (msg.sender != admin) revert NotAdmin();
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    /// @notice The address a coin with launch salt `salt` gets for pair `pairAsset`. Mirrors {deploy}, so the
    ///         address is known before the launch transaction is sent.
    function predict(bytes32 salt, address pairAsset, bool dividends) public view returns (address a, bytes32 s) {
        address impl = dividends ? divTokenImpl : tokenImpl;
        for (uint256 i; i < MAX_TRIES; i++) {
            s = keccak256(abi.encode(salt, i));
            a = Clones.predictDeterministicAddress(impl, s, address(this));
            if (a < pairAsset && a.code.length == 0) return (a, s);
        }
        revert NoSalt();
    }

    /// @notice Create the coin and mint its whole supply to the factory. `peers` must be empty: a Liqio coin
    ///         lives on HyperEVM only.
    function deploy(bytes32 salt, Init calldata p, bytes calldata peers) external returns (address a) {
        if (msg.sender != factory) revert NotFactory();
        if (peers.length != 0) revert NoPeers();
        (address predicted, bytes32 s) = predict(salt, p.pairAsset, p.dividends);
        a = Clones.cloneDeterministic(p.dividends ? divTokenImpl : tokenImpl, s);
        if (a != predicted) revert NoSalt();
        if (p.dividends) {
            LiqioDivToken(payable(a)).initializeDiv(p.name, p.symbol, p.metadataURI, p.supply, factory, p.pairAsset, p.poolManager, factory, p.hook, p.converter, p.weth);
        } else {
            LiqioToken(a).initialize(p.name, p.symbol, p.metadataURI, p.supply, factory);
        }
        isCoin[a] = true;
        emit CoinCreated(a, salt, p.dividends);
    }
}
