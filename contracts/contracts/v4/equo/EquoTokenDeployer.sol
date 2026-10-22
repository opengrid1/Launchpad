// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ILayerZeroEndpointV2} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {SetConfigParam} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";

interface IEquoCreator {
    function create(bytes32 s) external returns (address);
    function predict(bytes32 s) external view returns (address);
}

interface IEquoOFT {
    function setPeer(uint32 eid, bytes32 peer) external;
    function peers(uint32 eid) external view returns (bytes32);
    function setEnforcedOptions(EnforcedOptionParam[] calldata options) external;
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title EquoTokenDeployer
/// @notice Creates Equo coins for the factory and wires them to their copies on the other chains.
///
///         A coin is created by one of two creator contracts (plain, or with holder rewards), at the first salt
///         derived from the launch salt whose address sorts below the pair token, so the coin is always currency0
///         in its pool. The address is predictable off-chain with the same loop, which is how a launch on several
///         chains knows every chain's address before any of them exists.
///
///         Right after creation the coin is linked to its peers on the other chains, with the executor gas and the
///         message library and verifier setup the admin pinned for each chain. This contract stays the coin's
///         owner, and the only thing it can do later is add a peer for a chain that has none: an existing peer, its
///         libraries and its verifiers can never be changed.
contract EquoTokenDeployer {
    uint256 internal constant MAX_TRIES = 128;
    uint16 internal constant MSG_SEND = 1;

    /// @notice Sets up creators, the factory and chain routes; nothing about a launched coin.
    address public immutable admin;
    ILayerZeroEndpointV2 public immutable endpoint;
    address public factory;
    address public tokenCreator;
    address public divTokenCreator;
    /// @notice Executor gas a bridge transfer must pay for on the receiving chain.
    uint128 public lzReceiveGas = 200_000;

    /// @notice The admin's pinned setup for a remote chain: message libraries and their configs.
    struct Route {
        address sendLib;
        address receiveLib;
        bytes sendConfig; // abi.encode(SetConfigParam[]) for the send library (executor + verifiers)
        bytes receiveConfig; // abi.encode(SetConfigParam[]) for the receive library (verifiers)
    }

    mapping(uint32 eid => Route) internal _routes;
    /// @notice Coins created here (only these can get a peer added later).
    mapping(address => bool) public isCoin;

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

    Init private _pending;

    event FactorySet(address indexed factory);
    event CreatorsSet(address tokenCreator, address divTokenCreator);
    event RouteSet(uint32 indexed eid, address sendLib, address receiveLib);
    event LzReceiveGasSet(uint128 gas);
    event CoinCreated(address indexed coin, bytes32 salt, bool dividends);
    event PeerSet(address indexed coin, uint32 indexed eid, bytes32 peer);

    error NotFactory();
    error NotAdmin();
    error AlreadySet();
    error ZeroAddress();
    error NoSalt();
    error BadPeers();
    error PeerExists();
    error NotCoin();

    constructor(address admin_, address endpoint_) {
        if (admin_ == address(0) || endpoint_ == address(0)) revert ZeroAddress();
        admin = admin_;
        endpoint = ILayerZeroEndpointV2(endpoint_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------------
    // One-time setup and chain routes (admin)
    // ---------------------------------------------------------------------

    function setFactory(address factory_) external onlyAdmin {
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function setCreators(address plain, address div) external onlyAdmin {
        if (tokenCreator != address(0)) revert AlreadySet();
        if (plain == address(0) || div == address(0)) revert ZeroAddress();
        tokenCreator = plain;
        divTokenCreator = div;
        emit CreatorsSet(plain, div);
    }

    /// @notice Pin the libraries and verifier setup used for `eid`. Applies to coins wired from now on; coins
    ///         already wired keep what they were given.
    function setRoute(uint32 eid, Route calldata r) external onlyAdmin {
        _routes[eid] = r;
        emit RouteSet(eid, r.sendLib, r.receiveLib);
    }

    function setLzReceiveGas(uint128 gas) external onlyAdmin {
        if (gas < 50_000 || gas > 1_000_000) revert BadPeers();
        lzReceiveGas = gas;
        emit LzReceiveGasSet(gas);
    }

    function route(uint32 eid) external view returns (Route memory) {
        return _routes[eid];
    }

    // ---------------------------------------------------------------------
    // What a coin under construction reads back (through its creator)
    // ---------------------------------------------------------------------

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

    function pendingLz() external view returns (address, address, address) {
        return (address(endpoint), address(this), _pending.bridgeFeeTo);
    }

    function pendingDivWiring() external view returns (address, address, address, address, address, address) {
        return (_pending.pairAsset, _pending.poolManager, factory, _pending.hook, _pending.converter, _pending.weth);
    }

    // ---------------------------------------------------------------------
    // Create and wire
    // ---------------------------------------------------------------------

    /// @notice The address a coin with launch salt `salt` gets on this chain for pair `pairAsset`. Mirrors
    ///         {deploy}; off-chain code computes the same thing for every chain before a multichain launch.
    function predict(bytes32 salt, address pairAsset, bool dividends) public view returns (address a, bytes32 s) {
        IEquoCreator c = IEquoCreator(dividends ? divTokenCreator : tokenCreator);
        for (uint256 i; i < MAX_TRIES; i++) {
            s = keccak256(abi.encode(salt, i));
            a = c.predict(s);
            if (a < pairAsset && a.code.length == 0) return (a, s);
        }
        revert NoSalt();
    }

    /// @notice Create the coin, hand the factory the whole supply and link it to `peers` on other chains
    ///         (abi.encode(uint32[] eids, bytes32[] peers); empty for a coin on this chain only).
    function deploy(bytes32 salt, Init calldata p, bytes calldata peers) external returns (address a) {
        if (msg.sender != factory) revert NotFactory();
        if (p.bridgeFeeTo == address(0)) revert ZeroAddress();
        (address predicted, bytes32 s) = predict(salt, p.pairAsset, p.dividends);
        _pending = p;
        a = IEquoCreator(p.dividends ? divTokenCreator : tokenCreator).create(s);
        delete _pending;
        if (a != predicted) revert NoSalt();
        isCoin[a] = true;
        emit CoinCreated(a, salt, p.dividends);
        IEquoOFT(a).transfer(factory, p.supply);
        if (peers.length != 0) {
            (uint32[] memory eids, bytes32[] memory addrs) = abi.decode(peers, (uint32[], bytes32[]));
            if (eids.length != addrs.length) revert BadPeers();
            for (uint256 i; i < eids.length; i++) _wire(a, eids[i], addrs[i]);
        }
    }

    /// @notice Link a launched coin to its copy on a chain it has no peer on yet (a chain added later).
    function addPeer(address coin, uint32 eid, bytes32 peer) external onlyAdmin {
        if (!isCoin[coin]) revert NotCoin();
        _wire(coin, eid, peer);
    }

    function _wire(address coin, uint32 eid, bytes32 peer) internal {
        if (peer == bytes32(0) || eid == endpoint.eid()) revert BadPeers();
        if (IEquoOFT(coin).peers(eid) != bytes32(0)) revert PeerExists();
        Route storage r = _routes[eid];
        if (r.sendLib != address(0)) {
            endpoint.setSendLibrary(coin, eid, r.sendLib);
            if (r.sendConfig.length != 0) endpoint.setConfig(coin, r.sendLib, abi.decode(r.sendConfig, (SetConfigParam[])));
        }
        if (r.receiveLib != address(0)) {
            endpoint.setReceiveLibrary(coin, eid, r.receiveLib, 0);
            if (r.receiveConfig.length != 0) endpoint.setConfig(coin, r.receiveLib, abi.decode(r.receiveConfig, (SetConfigParam[])));
        }
        EnforcedOptionParam[] memory opts = new EnforcedOptionParam[](1);
        // type-3 options: executor (worker 1), lzReceive (option 1) with `lzReceiveGas` and no value
        opts[0] = EnforcedOptionParam({eid: eid, msgType: MSG_SEND, options: abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), lzReceiveGas)});
        IEquoOFT(coin).setEnforcedOptions(opts);
        IEquoOFT(coin).setPeer(eid, peer);
        emit PeerSet(coin, eid, peer);
    }
}
