// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Owned} from "./base/Owned.sol";
import {IWormhole} from "./interfaces/IWormhole.sol";
import {IHypexToken} from "./interfaces/IHypexToken.sol";

interface IHypexHookBridge {
    function bridge(address token, uint256 amountOut) external payable returns (uint256 floorOut);
    function poolManager() external view returns (address);
}

/// @title HypexBridge
/// @notice Moves a Hypex coin between the chains it is launched on (Elysium and HyperEVM), over Wormhole, and keeps every
///         chain's floor covering that chain's holders. This bridge has the same address on every chain (the same
///         deployer nonce on both), so each one's peer is itself.
///
///         Sending `amount` from chain A to chain B: the coins are burned on A, and A's floor lets go of the HYPE that
///         backed them (HypexHook.bridge: the same share of the floor money and the floor band as `amount` is of the
///         circulating coins), which waits here (floorOut). A Wormhole message names the coin on both chains (every
///         chain has its own address for it, paired by the launch service: HypexFactory.remoteOf), the receiver,
///         `amount` and that HYPE. On B, anyone can bring the signed message (receiveMessage): the coins are minted to the
///         receiver and B's bridge books the HYPE B's floor is owed (floorOwed). The keeper moves the HYPE from A to B
///         (Relay) and pays it into B's floor (fundFloor): until it lands, B's floor carries its new holders with the
///         money it already had and does not move up for them.
/// @dev Native HYPE only. The keeper is trusted with the floor HYPE in transit (releaseFloor); the owner (a Safe) sets the
///      peers, the keeper and the Wormhole consistency level.
contract HypexBridge is Owned, ReentrancyGuard {
    IWormhole public immutable wormhole;
    /// @notice The factory every coin comes from (it names this bridge, and the hook through it)
    address public immutable factory;

    /// @notice The bridge on each other chain, by Wormhole chain id (this same address, left-padded)
    mapping(uint16 => bytes32) public peers;
    /// @notice Messages already delivered here (by their Wormhole hash)
    mapping(bytes32 => bool) public consumed;
    /// @notice HYPE this chain's floors let go of for coins sent out, waiting for the keeper to carry it over
    uint256 public floorOut;
    /// @notice HYPE each coin's floor here is owed for coins that came in, until the keeper pays it in
    mapping(address => uint256) public floorOwed;
    /// @notice Carries floor HYPE between chains (releaseFloor) and usually delivers the messages
    address public keeper;
    /// @notice How final a sending block must be before the guardians sign (Wormhole: 200 instant, 201 safe, 1 final)
    uint8 public consistency = 1;

    event Sent(
        address indexed token,
        address indexed from,
        address to,
        uint16 indexed toChain,
        uint256 amount,
        uint256 floorHype,
        uint64 sequence
    );
    event Received(
        address indexed token, address indexed to, uint16 indexed fromChain, uint256 amount, uint256 floorHype, bytes32 hash
    );
    event FloorReleased(address indexed to, uint256 amount);
    event FloorFunded(address indexed token, uint256 amount, uint256 stillOwed);
    event PeerSet(uint16 indexed chain, bytes32 peer);
    event KeeperSet(address indexed keeper);
    event ConsistencySet(uint8 level);

    error NoPeer();
    error NoRemote();
    error BadAmount();
    error ZeroAddress();
    error BadVaa(string reason);
    error UnknownEmitter();
    error AlreadyDelivered();
    error NotKeeper();
    error SendFailed();
    error NotHook();

    constructor(IWormhole _wormhole, address _factory, address _owner) Owned(_owner) {
        if (address(_wormhole) == address(0) || _factory == address(0)) revert ZeroAddress();
        wormhole = _wormhole;
        factory = _factory;
    }

    /// @notice Only the floor a send lets go of comes in here (HypexHook.bridge pays it out of the PoolManager)
    receive() external payable {
        address h = _hook();
        if (msg.sender != h && msg.sender != IHypexHookBridge(h).poolManager()) revert NotHook();
    }

    // =====================================================================================================
    // send and receive
    // =====================================================================================================

    /// @notice Sends `amount` of `token` to `to` on the chain whose Wormhole id is `toChain`. Burns the caller's coins
    ///         (no approval needed: only this bridge can burn them) and moves their share of this chain's floor out
    ///         with them. Pay the Wormhole message fee (wormhole.messageFee(), 0 on Elysium and HyperEVM) as value.
    function send(address token, uint256 amount, uint16 toChain, address to)
        external
        payable
        nonReentrant
        returns (uint64 sequence)
    {
        if (peers[toChain] == bytes32(0)) revert NoPeer();
        if (amount == 0) revert BadAmount();
        if (to == address(0)) revert ZeroAddress();
        // the same coin's own address on that chain (every chain has its own), recorded by the launch service
        address remote = IHypexFactoryHook(factory).remoteOf(token, toChain);
        if (remote == address(0)) revert NoRemote();
        IHypexToken(token).bridgeBurn(msg.sender, amount);
        // reverts for a coin this chain's hook didn't launch
        uint256 hype = IHypexHookBridge(_hook()).bridge(token, amount);
        floorOut += hype;
        sequence = wormhole.publishMessage{value: msg.value}(0, abi.encode(token, remote, to, amount, hype), consistency);
        emit Sent(token, msg.sender, to, toChain, amount, hype, sequence);
    }

    /// @notice Delivers a signed message from a peer: mints the coins to their receiver and books the floor HYPE this
    ///         chain's floor is owed for them; HYPE sent with it (the keeper's, once it carried it over) pays that floor
    ///         first. This chain's floor band is then re-placed where it carries every holder here, the newcomers too
    ///         (lower than before if their HYPE hasn't arrived; the raises lift it once it has). Anyone can deliver; each
    ///         message once.
    function receiveMessage(bytes calldata vaa) external payable nonReentrant {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(vaa);
        if (!valid) revert BadVaa(reason);
        bytes32 peer = peers[vm.emitterChainId];
        if (peer == bytes32(0) || peer != vm.emitterAddress) revert UnknownEmitter();
        if (consumed[vm.hash]) revert AlreadyDelivered();
        consumed[vm.hash] = true;
        (address from, address token, address to, uint256 amount, uint256 hype) =
            abi.decode(vm.payload, (address, address, address, uint256, uint256));
        // the coin here must be the one the launch service paired with the sending chain's coin
        if (IHypexFactoryHook(factory).remoteOf(token, vm.emitterChainId) != from) revert NoRemote();
        IHypexToken(token).bridgeMint(to, amount);
        floorOwed[token] += hype;
        emit Received(token, to, vm.emitterChainId, amount, hype, vm.hash);
        _fund(token, msg.value);
    }

    // =====================================================================================================
    // floor HYPE in transit
    // =====================================================================================================

    /// @notice The keeper takes floor HYPE that left this chain's floors, to carry it to the chains the coins went to.
    function releaseFloor(address payable to, uint256 amount) external nonReentrant {
        if (msg.sender != keeper) revert NotKeeper();
        if (to == address(0)) revert ZeroAddress();
        if (amount > floorOut) revert BadAmount();
        floorOut -= amount;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert SendFailed();
        emit FloorReleased(to, amount);
    }

    /// @notice Pays HYPE into `token`'s floor here and takes it off what that floor is owed. Anyone can pay (more than
    ///         is owed simply adds to the floor); the keeper pays what it carried over.
    function fundFloor(address token) external payable nonReentrant {
        if (msg.value == 0) revert BadAmount();
        _fund(token, msg.value);
    }

    function _fund(address token, uint256 value) internal {
        uint256 owed = floorOwed[token];
        uint256 left = value >= owed ? 0 : owed - value;
        floorOwed[token] = left;
        IHypexHookBridge(_hook()).bridge{value: value}(token, 0);
        if (value != 0) emit FloorFunded(token, value, left);
    }

    // =====================================================================================================
    // owner
    // =====================================================================================================

    function setPeer(uint16 chain, bytes32 peer) external onlyOwner {
        peers[chain] = peer;
        emit PeerSet(chain, peer);
    }

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperSet(_keeper);
    }

    function setConsistency(uint8 level) external onlyOwner {
        consistency = level;
        emit ConsistencySet(level);
    }

    function _hook() internal view returns (address) {
        return IHypexFactoryHook(factory).hook();
    }
}

interface IHypexFactoryHook {
    function hook() external view returns (address);
    function remoteOf(address token, uint16 chain) external view returns (address);
}
