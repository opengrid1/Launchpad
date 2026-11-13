// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IWormhole} from "../src/interfaces/IWormhole.sol";
import {IHypexHook} from "../src/interfaces/IHypexHook.sol";
import {IHypexFactory} from "../src/interfaces/IHypexFactory.sol";
import {HypexBridge} from "../src/HypexBridge.sol";
import {HypexToken} from "../src/HypexToken.sol";
import {HypexBase} from "./Hypex.t.sol";

/// Stands in for the Wormhole Core Bridge: publishMessage records the payload, and a "VAA" here is the ABI encoding of
/// (emitter chain, emitter, payload, hash), which parseAndVerifyVM accepts unless told to reject it.
contract MockWormhole is IWormhole {
    uint16 public immutable chainId;
    uint64 public seq;
    bytes public lastPayload;
    uint8 public lastConsistency;
    bool public reject;

    constructor(uint16 id) {
        chainId = id;
    }

    function setReject(bool r) external {
        reject = r;
    }

    function publishMessage(uint32, bytes memory payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence)
    {
        lastPayload = payload;
        lastConsistency = consistencyLevel;
        return seq++;
    }

    function parseAndVerifyVM(bytes calldata encoded)
        external
        view
        returns (VM memory vm, bool valid, string memory reason)
    {
        (uint16 from, bytes32 emitter, bytes memory payload, bytes32 hash) =
            abi.decode(encoded, (uint16, bytes32, bytes, bytes32));
        vm.emitterChainId = from;
        vm.emitterAddress = emitter;
        vm.payload = payload;
        vm.hash = hash;
        valid = !reject;
        reason = reject ? "bad signatures" : "";
    }

    function messageFee() external pure returns (uint256) {
        return 0;
    }
}

/// HypexBridge on one chain, its peer standing in for the other chain (the same bridge, as on a real deploy where both
/// have the same address): coins burn here and their share of the floor comes out, then the message mints them back and
/// the keeper pays the floor HYPE in again.
contract BridgeTest is HypexBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint16 constant ELYSIUM = 74;
    uint16 constant HYPEREVM = 47;

    MockWormhole wh;
    HypexBridge bridge;
    address keeper = makeAddr("bridgeKeeper");

    function setUp() public override {
        super.setUp();
        wh = new MockWormhole(ELYSIUM);
        bridge = new HypexBridge(wh, address(factory), address(this));
        factory.setBridge(address(bridge));
        bridge.setPeer(HYPEREVM, bytes32(uint256(uint160(address(bridge)))));
        bridge.setKeeper(keeper);
    }

    function _vaa(bytes memory payload, bytes32 hash) internal view returns (bytes memory) {
        return abi.encode(HYPEREVM, bytes32(uint256(uint160(address(bridge)))), payload, hash);
    }

    function _settle() internal {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
    }

    /// a coin with a floor: bob and carol buy over several blocks, then a poke raises the floor
    function _coin() internal returns (PoolKey memory k, address token, address bob, address carol) {
        _launchHypex();
        address creator = _user("creator");
        bytes32 s = keccak256("Bridged");
        vm.prank(creator);
        (token,) = factory.launch{value: 0.01 ether}(_signedEth(creator, "Bridged", "BRDG", s, 0, HYPEX_TICK));
        k = hook.keyFor(address(0), token);
        bob = _user("bob");
        carol = _user("carol");
        _approve(bob, token);
        _approve(carol, token);
        _settle();
        _swap(bob, k, true, -5 ether, 5 ether);
        for (uint256 i; i < 6; i++) {
            _settle();
            _swap(carol, k, true, -1 ether, 1 ether);
        }
        _settle();
        hook.poke(k);
    }

    function test_sendBurnsAndTakesTheFloorShare() public {
        (PoolKey memory k, address token, address bob,) = _coin();
        (, uint256 pot0,,, uint128 band0) = _pool(k);
        assertGt(band0, 0, "a floor band");
        uint256 supply0 = HypexToken(token).totalSupply();
        uint256 amount = HypexToken(token).balanceOf(bob) / 2;

        vm.prank(bob);
        bridge.send(token, amount, HYPEREVM, bob);

        assertEq(HypexToken(token).totalSupply(), supply0 - amount, "burned here");
        uint256 out = bridge.floorOut();
        assertGt(out, 0, "the coins took floor HYPE with them");
        assertEq(address(bridge).balance, out, "the bridge holds it for the keeper");
        (, uint256 pot1,,, uint128 band1) = _pool(k);
        assertLt(pot1 + band1, pot0 + band0, "the floor here let go of it");
        (address t, address to, uint256 a, uint256 hype) =
            abi.decode(wh.lastPayload(), (address, address, uint256, uint256));
        assertEq(t, token);
        assertEq(to, bob);
        assertEq(a, amount);
        assertEq(hype, out);
        assertEq(wh.lastConsistency(), 1, "final by default");
    }

    /// after coins leave, every holder still here can sell all of theirs into the floor
    function test_floorStillCoversEveryoneLeft() public {
        (PoolKey memory k, address token, address bob, address carol) = _coin();
        uint256 amount = HypexToken(token).balanceOf(bob) * 9 / 10;
        vm.prank(bob);
        bridge.send(token, amount, HYPEREVM, bob);
        _settle();
        address[] memory us = new address[](2);
        us[0] = bob;
        us[1] = carol;
        _dumpAll(k, us); // reverts PartialFill if the floor couldn't take them all
        assertEq(HypexToken(token).balanceOf(carol), 0);
    }

    function test_receiveMintsOnceAndBooksTheFloor() public {
        (, address token, address bob,) = _coin();
        address dave = makeAddr("dave");
        bytes memory payload = abi.encode(token, dave, 1_000e18, 0.3 ether);
        bridge.receiveMessage(_vaa(payload, keccak256("m1")));
        assertEq(HypexToken(token).balanceOf(dave), 1_000e18, "minted to the receiver");
        assertEq(bridge.floorOwed(token), 0.3 ether, "this floor is owed the HYPE");
        vm.expectRevert(HypexBridge.AlreadyDelivered.selector);
        bridge.receiveMessage(_vaa(payload, keccak256("m1")));
        // from anyone but the peer
        bytes memory forged = abi.encode(HYPEREVM, bytes32(uint256(uint160(bob))), payload, keccak256("m2"));
        vm.expectRevert(HypexBridge.UnknownEmitter.selector);
        bridge.receiveMessage(forged);
        // a message the guardians didn't sign
        wh.setReject(true);
        vm.expectRevert(abi.encodeWithSelector(HypexBridge.BadVaa.selector, "bad signatures"));
        bridge.receiveMessage(_vaa(payload, keccak256("m3")));
    }

    function test_keeperCarriesTheFloorAcross() public {
        (PoolKey memory k, address token, address bob,) = _coin();
        uint256 half = HypexToken(token).balanceOf(bob) / 2;
        vm.prank(bob);
        bridge.send(token, half, HYPEREVM, bob);
        uint256 out = bridge.floorOut();
        (, address to, uint256 a, uint256 hype) = abi.decode(wh.lastPayload(), (address, address, uint256, uint256));
        uint256 held = HypexToken(token).balanceOf(to);
        bridge.receiveMessage(_vaa(wh.lastPayload(), keccak256("back")));
        assertEq(HypexToken(token).balanceOf(to) - held, a, "minted on the other side");

        // only the keeper takes the HYPE out, never more than left the floors
        vm.expectRevert(HypexBridge.NotKeeper.selector);
        bridge.releaseFloor(payable(bob), out);
        vm.prank(keeper);
        vm.expectRevert(HypexBridge.BadAmount.selector);
        bridge.releaseFloor(payable(keeper), out + 1);
        vm.prank(keeper);
        bridge.releaseFloor(payable(keeper), out);
        assertEq(keeper.balance, out);

        // ...carries it over (Relay) and pays it into the floor it is owed to
        (, uint256 pot0,,,) = _pool(k);
        vm.prank(keeper);
        bridge.fundFloor{value: hype}(token);
        (, uint256 pot1,,,) = _pool(k);
        assertEq(pot1 - pot0, hype, "into the pot");
        assertEq(bridge.floorOwed(token), 0, "nothing owed");
        // every holder can still sell into the floor
        _settle();
        _dumpAll(k, _one(bob));
    }

    function test_onlyTheBridgeMovesCoinsAndFloor() public {
        (, address token, address bob,) = _coin();
        vm.expectRevert(HypexToken.NotBridge.selector);
        HypexToken(token).bridgeMint(bob, 1);
        vm.prank(bob);
        vm.expectRevert(HypexToken.NotBridge.selector);
        HypexToken(token).bridgeBurn(bob, 1);
        vm.expectRevert(IHypexHook.NotBridge.selector);
        hook.bridgeOut(token, 1);
        // a coin this hook never launched
        HypexToken stray = new HypexToken("Stray", "STRAY");
        vm.expectRevert(HypexToken.NotBridge.selector); // its "factory" (this test) names no bridge
        vm.prank(bob);
        bridge.send(address(stray), 1, HYPEREVM, bob);
        // no peer on that chain
        vm.prank(bob);
        vm.expectRevert(HypexBridge.NoPeer.selector);
        bridge.send(token, 1, 30, bob);
    }

    function test_bridgeSetOnce() public {
        vm.expectRevert(IHypexFactory.BridgeSet.selector);
        factory.setBridge(address(1));
    }

    function test_legLauncherOnly() public {
        _launchHypex();
        address creator = _user("creator");
        bytes32 s = keccak256("Leg");
        IHypexFactory.LaunchParams memory lp = _signedEth(creator, "Leg", "LEG", s, 0, HYPEX_TICK);
        vm.expectRevert(IHypexFactory.NotLegLauncher.selector);
        factory.launchLeg{value: 0.01 ether}(lp, creator);
        address service = _user("service");
        factory.setLegLauncher(service);
        vm.prank(service);
        (address token,) = factory.launchLeg{value: 0.01 ether}(lp, creator);
        // the same address the creator's own launch would have had, and the creator's pool
        assertEq(token, factory.predictToken(creator, s, "Leg", "LEG"), "same coin address");
        assertEq(_creatorOf(hook.keyFor(address(0), token)), creator, "the creator's");
    }
}
