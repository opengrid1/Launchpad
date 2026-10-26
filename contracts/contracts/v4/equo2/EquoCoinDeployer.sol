// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ILayerZeroEndpointV2} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {SetConfigParam} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";

import {EquoCoin} from "./EquoCoin.sol";

interface IEquoCoinWiring {
    function setPeer(uint32 eid, bytes32 peer) external;
    function peers(uint32 eid) external view returns (bytes32);
    function setEnforcedOptions(EnforcedOptionParam[] calldata options) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function renounceOwnership() external;
}

/// @title EquoCoinCreator
/// @notice Holds EquoCoin's creation code so the deployer stays under the contract size limit. A coin under
///         construction reads its settings back through here from the deployer.
contract EquoCoinCreator {
    address public immutable deployer;
    bytes32 public immutable initCodeHash = keccak256(type(EquoCoin).creationCode);

    error NotDeployer();

    constructor(address deployer_) {
        deployer = deployer_;
    }

    function pendingCoin() external view returns (string memory, string memory, string memory, uint256, uint256, address) {
        return EquoCoinDeployer(deployer).pendingCoin();
    }

    function pendingLz() external view returns (address, address, address) {
        return EquoCoinDeployer(deployer).pendingLz();
    }

    function predict(bytes32 s) public view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), s, initCodeHash)))));
    }

    function create(bytes32 s) external returns (address) {
        if (msg.sender != deployer) revert NotDeployer();
        return address(new EquoCoin{salt: s}());
    }
}

/// @title EquoCoinDeployer
/// @notice Creates Equo coins for the factory and wires each to its copies on the coin's other chains.
///
///         ITS OWN ADDRESS ON EVERY CHAIN, ONE FAMILY MARK. A coin's address comes from its salt, which the factory
///         binds to the launch (launch id, creator, this chain's leg salt), so every chain of a coin gets a
///         different address: a wallet or trading bot knows the chain from the address alone. Every Equo coin's
///         address ends in {ADDRESS_MARK} and sits below {ADDRESS_CEILING}; the launch service mines each leg's salt
///         to get there, and {deploy} refuses anything else.
///
///         ROUTES ARE FIXED. Each remote chain's message libraries and verifier setup are pinned here before any coin
///         uses them, every route with at least two DVNs; a coin is only wired to chains with a pinned route, never
///         to LayerZero's defaults.
///
///         PEERS ARE SEALED AT LAUNCH. Right after creation the coin is linked to its peers, and this contract gives
///         up the coin's ownership in the same call: nobody can add, change or remove a peer, an option or the
///         delegate afterwards. This contract stays the coin's endpoint delegate but has no function that touches a
///         coin after {deploy}.
contract EquoCoinDeployer {
    /// @notice Every Equo coin's address ends in this byte.
    uint8 public constant ADDRESS_MARK = 0xe9;
    /// @notice Every coin's address is below this, so it sorts below every wrapped native token (currency0).
    address public constant ADDRESS_CEILING = 0x1000000000000000000000000000000000000000;
    uint16 internal constant MSG_SEND = 1;
    uint16 internal constant MSG_SEND_AND_CALL = 2;
    uint32 internal constant CONFIG_TYPE_ULN = 2;
    uint8 internal constant NIL_DVN_COUNT = type(uint8).max;
    /// @notice Each route must be checked by at least this many DVNs (required plus the optional threshold).
    uint8 public constant MIN_DVNS = 2;

    /// @dev LayerZero's ULN config, as its message libraries decode it (configType 2).
    struct UlnConfig {
        uint64 confirmations;
        uint8 requiredDVNCount;
        uint8 optionalDVNCount;
        uint8 optionalDVNThreshold;
        address[] requiredDVNs;
        address[] optionalDVNs;
    }

    struct Route {
        address sendLib;
        address receiveLib;
        bytes sendConfig; // abi.encode(SetConfigParam[]): executor + ULN for the send library
        bytes receiveConfig; // abi.encode(SetConfigParam[]): ULN for the receive library
        uint128 receiveGas; // executor gas for lzReceive on the remote chain
        uint128 composeGas; // extra gas for SEND_AND_CALL messages
    }

    struct Init {
        string name;
        string symbol;
        string metadataURI;
        uint256 slice;
        uint256 launchTotal;
        address creator;
        address bridgeFeeTo;
    }

    address public immutable admin;
    address public setupBy;
    ILayerZeroEndpointV2 public endpoint;
    address public factory;
    EquoCoinCreator public creatorContract;

    mapping(uint32 eid => Route) internal _routes;
    mapping(address => bool) public isCoin;
    Init private _pending;

    event EndpointSet(address indexed endpoint);
    event FactorySet(address indexed factory);
    event CreatorContractSet(address indexed creator);
    event SetupEnded();
    event RouteSet(uint32 indexed eid, address sendLib, address receiveLib);
    event CoinCreated(address indexed coin, bytes32 salt);
    event PeerSet(address indexed coin, uint32 indexed eid, bytes32 peer);

    error NotFactory();
    error NotAdmin();
    error AlreadySet();
    error ZeroAddress();
    error BadAddress();
    error BadPeers();
    error BadRoute();
    error NoRoute(uint32 eid);

    /// @param admin_ The admin, the same on every chain.
    /// @param setupBy_ The deploying account: may do the one-time setup until {endSetup}.
    constructor(address admin_, address setupBy_) {
        if (admin_ == address(0)) revert ZeroAddress();
        admin = admin_;
        setupBy = setupBy_;
    }

    modifier onlySetup() {
        if (msg.sender != admin && (msg.sender != setupBy || setupBy == address(0))) revert NotAdmin();
        _;
    }

    function endSetup() external onlySetup {
        setupBy = address(0);
        emit SetupEnded();
    }

    function setEndpoint(address endpoint_) external onlySetup {
        if (address(endpoint) != address(0)) revert AlreadySet();
        if (endpoint_ == address(0)) revert ZeroAddress();
        endpoint = ILayerZeroEndpointV2(endpoint_);
        emit EndpointSet(endpoint_);
    }

    function setFactory(address factory_) external onlySetup {
        if (factory != address(0)) revert AlreadySet();
        if (factory_ == address(0)) revert ZeroAddress();
        factory = factory_;
        emit FactorySet(factory_);
    }

    function setCreatorContract(EquoCoinCreator c) external onlySetup {
        if (address(creatorContract) != address(0)) revert AlreadySet();
        if (address(c) == address(0) || c.deployer() != address(this)) revert ZeroAddress();
        creatorContract = c;
        emit CreatorContractSet(address(c));
    }

    /// @notice Pin the route to `eid` for coins wired from now on. Both libraries must be named (no defaults), every
    ///         ULN config must name at least {MIN_DVNS} verifiers, and the executor gas must be set.
    function setRoute(uint32 eid, Route calldata r) external onlySetup {
        if (r.sendLib == address(0) || r.receiveLib == address(0)) revert BadRoute();
        if (r.receiveGas < 50_000 || r.receiveGas > 2_000_000 || r.composeGas > 5_000_000) revert BadRoute();
        if (!_dvnsOk(r.sendConfig) || !_dvnsOk(r.receiveConfig)) revert BadRoute();
        _routes[eid] = r;
        emit RouteSet(eid, r.sendLib, r.receiveLib);
    }

    function route(uint32 eid) external view returns (Route memory) {
        return _routes[eid];
    }

    /// @dev A config must hold at least one ULN entry, and each ULN entry must ask for {MIN_DVNS} or more.
    function _dvnsOk(bytes calldata config) internal pure returns (bool) {
        if (config.length == 0) return false;
        SetConfigParam[] memory ps = abi.decode(config, (SetConfigParam[]));
        bool uln;
        for (uint256 i; i < ps.length; i++) {
            if (ps[i].configType != CONFIG_TYPE_ULN) continue;
            uln = true;
            UlnConfig memory u = abi.decode(ps[i].config, (UlnConfig));
            uint256 req = u.requiredDVNCount == NIL_DVN_COUNT ? 0 : u.requiredDVNCount;
            uint256 opt = u.optionalDVNCount == NIL_DVN_COUNT ? 0 : u.optionalDVNThreshold;
            if (u.requiredDVNCount == 0 || req + opt < MIN_DVNS) return false; // 0 means "use the default": not allowed
        }
        return uln;
    }

    // ---------------------------------------------------------------------
    // What a coin under construction reads back
    // ---------------------------------------------------------------------

    function pendingCoin() external view returns (string memory, string memory, string memory, uint256, uint256, address) {
        Init storage p = _pending;
        return (p.name, p.symbol, p.metadataURI, p.slice, p.launchTotal, p.creator);
    }

    function pendingLz() external view returns (address, address, address) {
        return (address(endpoint), address(this), _pending.bridgeFeeTo);
    }

    // ---------------------------------------------------------------------
    // Create and wire
    // ---------------------------------------------------------------------

    /// @notice The address a coin created with `salt` gets on this chain.
    function predict(bytes32 salt) public view returns (address) {
        return creatorContract.predict(salt);
    }

    /// @notice True when `a` is a valid Equo coin address: below the ceiling and ending in the family mark.
    function markOk(address a) public pure returns (bool) {
        return a < ADDRESS_CEILING && uint8(uint160(a)) == ADDRESS_MARK;
    }

    /// @notice Create the coin, hand the factory its slice and link it to `eids`/`peers` on its other chains.
    function deploy(bytes32 salt, Init calldata p, uint32[] calldata eids, bytes32[] calldata peers) external returns (address a) {
        if (msg.sender != factory) revert NotFactory();
        if (p.bridgeFeeTo == address(0) || address(endpoint) == address(0)) revert ZeroAddress();
        if (eids.length != peers.length) revert BadPeers();
        address predicted = predict(salt);
        if (!markOk(predicted)) revert BadAddress();
        _pending = p;
        a = creatorContract.create(salt);
        delete _pending;
        if (a != predicted) revert BadAddress();
        isCoin[a] = true;
        emit CoinCreated(a, salt);
        IEquoCoinWiring(a).transfer(factory, p.slice);
        uint32 self = endpoint.eid();
        for (uint256 i; i < eids.length; i++) _wire(a, self, eids[i], peers[i]);
        IEquoCoinWiring(a).renounceOwnership();
    }

    function _wire(address coin, uint32 self, uint32 eid, bytes32 peer) internal {
        if (peer == bytes32(0) || eid == self) revert BadPeers();
        if (IEquoCoinWiring(coin).peers(eid) != bytes32(0)) revert BadPeers();
        Route storage r = _routes[eid];
        if (r.sendLib == address(0)) revert NoRoute(eid);
        endpoint.setSendLibrary(coin, eid, r.sendLib);
        endpoint.setConfig(coin, r.sendLib, abi.decode(r.sendConfig, (SetConfigParam[])));
        endpoint.setReceiveLibrary(coin, eid, r.receiveLib, 0);
        endpoint.setConfig(coin, r.receiveLib, abi.decode(r.receiveConfig, (SetConfigParam[])));
        EnforcedOptionParam[] memory opts = new EnforcedOptionParam[](2);
        // type-3 options: executor (worker 1), lzReceive (option 1, 16 bytes gas); compose adds option 3
        bytes memory recv = abi.encodePacked(uint16(3), uint8(1), uint16(17), uint8(1), r.receiveGas);
        opts[0] = EnforcedOptionParam({eid: eid, msgType: MSG_SEND, options: recv});
        opts[1] = EnforcedOptionParam({
            eid: eid,
            msgType: MSG_SEND_AND_CALL,
            options: r.composeGas == 0 ? recv : abi.encodePacked(recv, uint8(1), uint16(19), uint8(3), uint16(0), r.composeGas)
        });
        IEquoCoinWiring(coin).setEnforcedOptions(opts);
        IEquoCoinWiring(coin).setPeer(eid, peer);
        emit PeerSet(coin, eid, peer);
    }
}
