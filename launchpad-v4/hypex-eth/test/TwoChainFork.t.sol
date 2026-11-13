// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, Vm} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IHypexFactory} from "../src/interfaces/IHypexFactory.sol";
import {IWormhole} from "../src/interfaces/IWormhole.sol";
import {HypexFactory} from "../src/HypexFactory.sol";
import {HypexHook} from "../src/HypexHook.sol";
import {HypexRevenue} from "../src/HypexRevenue.sol";
import {HypexLimitOrders} from "../src/HypexLimitOrders.sol";
import {HypexBurner} from "../src/HypexBurner.sol";
import {HypexVesting} from "../src/HypexVesting.sol";
import {HypexBridge} from "../src/HypexBridge.sol";
import {HypexToken} from "../src/HypexToken.sol";
import {StartTick} from "../script/StartTick.sol";
import {MockArbSys} from "./Blocks.t.sol";

/// Hypex on both its chains at once, forked from mainnet: Elysium and HyperEVM, the real Uniswap v4 PoolManagers and the
/// real Wormhole Core Bridges. The stack is deployed on each by the same fresh deployer in the same order, so the factory,
/// the bridge and every coin have the same address on both. The Wormhole guardian set is swapped for a test key on the
/// receiving chain (storage override), which signs the VAA of the message the sending chain's real Core Bridge published.
///   ELYSIUM_RPC_URL=https://rpc.elysium.kinetiq.xyz HYPEREVM_RPC_URL=https://rpc.hyperliquid.xyz/evm \
///   forge test --match-contract TwoChainFork -vv
contract TwoChainForkTest is Test {
    using PoolIdLibrary for PoolKey;

    address constant ELY_PM = 0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1;
    address constant HYP_PM = 0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F;
    address constant ELY_WH = 0xC8aD24fC6063c41cB5C12a8e3851AafC3b3CF027;
    address constant HYP_WH = 0x7C0faFc4384551f063e05aee704ab943b8B53aB3;
    uint16 constant ELY_CHAIN = 74;
    uint16 constant HYP_CHAIN = 47;
    uint160 constant FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG
        | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_DONATE_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
        | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG;
    uint256 constant HYPE_USD = 40;
    /// HyperEVM's small blocks (the fast ones every wallet uses by default)
    uint256 constant HYPEREVM_SMALL_BLOCK_GAS = 3_000_000;

    struct Stack {
        IPoolManager pm;
        HypexFactory factory;
        HypexHook hook;
        HypexRevenue revenue;
        HypexBridge bridge;
        PoolSwapTest router;
        address wormhole;
    }

    uint256 ely;
    uint256 hyp;
    Stack E;
    Stack H;
    address deployer;
    address startSigner;
    uint256 startSignerKey;
    address guardian;
    uint256 guardianKey;
    address keeper;
    bool noRpc;

    function setUp() public {
        string memory eUrl = vm.envOr("ELYSIUM_RPC_URL", string(""));
        string memory hUrl = vm.envOr("HYPEREVM_RPC_URL", string(""));
        if (bytes(eUrl).length == 0 || bytes(hUrl).length == 0) {
            noRpc = true;
            return;
        }
        deployer = makeAddr("hypex two-chain deployer");
        (startSigner, startSignerKey) = makeAddrAndKey("hypex two-chain start signer");
        (guardian, guardianKey) = makeAddrAndKey("hypex two-chain guardian");
        keeper = makeAddr("hypex two-chain keeper");
        ely = vm.createFork(eUrl);
        hyp = vm.createFork(hUrl);
        vm.selectFork(ely);
        // Elysium is an Arbitrum Orbit chain: the hook counts blocks with ArbSys, which a fork doesn't simulate
        vm.etch(address(0x64), address(new MockArbSys()).code);
        E = _deploy(ELY_PM, ELY_WH, HYP_CHAIN, true);
        vm.selectFork(hyp);
        H = _deploy(HYP_PM, HYP_WH, ELY_CHAIN, false);
    }

    function _deploy(address pm, address wh, uint16 peerChain, bool isArbitrum) internal returns (Stack memory s) {
        vm.deal(deployer, 100 ether);
        vm.setNonce(deployer, 0);
        vm.startPrank(deployer, deployer);
        s.pm = IPoolManager(pm);
        s.wormhole = wh;
        HypexVesting vesting = new HypexVesting();
        s.factory = new HypexFactory(s.pm, deployer, deployer, 0.1 ether, vesting);
        s.revenue = new HypexRevenue(s.pm, deployer, deployer);
        HypexLimitOrders lo =
            new HypexLimitOrders(s.pm, IHypexFactory(address(s.factory)), deployer, IAggregatorV3(address(0)), 0);
        HypexBurner burner = new HypexBurner(s.pm, deployer);
        s.bridge = new HypexBridge(IWormhole(wh), address(s.factory), deployer);
        address hookAddr = address(uint160(FLAGS) | (uint160(0x4444) << 144));
        vm.stopPrank();
        deployCodeTo(
            "HypexHook.sol:HypexHook",
            abi.encode(pm, address(s.factory), address(s.revenue), address(lo), address(burner), isArbitrum, deployer),
            hookAddr
        );
        s.hook = HypexHook(hookAddr);
        vm.startPrank(deployer, deployer);
        s.factory.setHook(s.hook);
        s.revenue.setHook(hookAddr);
        burner.setHook(s.hook);
        s.factory.setBridge(address(s.bridge));
        s.factory.setLegLauncher(keeper);
        s.bridge.setPeer(peerChain, bytes32(uint256(uint160(address(s.bridge)))));
        s.bridge.setKeeper(keeper);
        s.factory.setStartSigner(startSigner);
        int24 mid = StartTick.forEthUsd(HYPE_USD);
        int24 half = s.factory.MAX_START_BAND() / 2;
        s.factory.setStartBand(mid - half, mid + half);
        // $HYPEX first (the owner's launch), then everything else
        s.factory.launch(IHypexFactory.LaunchParams("Hypex", "HYPEX", "ipfs://hypex", bytes32(0), address(0), 0, 0, mid, 0, "", 0));
        vm.stopPrank();
        s.router = new PoolSwapTest(s.pm);
    }

    function _signedStart(Stack memory s, address creator, bytes32 salt, int24 tick)
        internal
        view
        returns (IHypexFactory.LaunchParams memory lp)
    {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = s.factory.launchStartDigest(creator, salt, address(0), "Twin", "TWIN", tick, deadline);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(startSignerKey, digest);
        lp = IHypexFactory.LaunchParams("Twin", "TWIN", "ipfs://twin", salt, address(0), 0, type(uint256).max, tick, deadline, abi.encodePacked(r, ss, v), 0);
    }

    function _swap(Stack memory s, address who, PoolKey memory key, bool buy, int256 amount, uint256 value) internal {
        vm.prank(who, who);
        s.router.swap{value: value}(
            key,
            IPoolManager.SwapParams({
                zeroForOne: buy,
                amountSpecified: amount,
                sqrtPriceLimitX96: buy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
    }

    /// Puts our test key in as the only guardian of the current guardian set of `wh` (Wormhole's State: provider in
    /// slots 0-1, guardianSets mapping in slot 2, guardianSetIndex in slot 3; a GuardianSet is {address[] keys; uint32
    /// expirationTime})
    function _overrideGuardians(address wh) internal returns (uint32 index) {
        index = uint32(uint256(vm.load(wh, bytes32(uint256(3)))));
        bytes32 set = keccak256(abi.encode(uint256(index), uint256(2)));
        vm.store(wh, set, bytes32(uint256(1))); // keys.length = 1
        vm.store(wh, keccak256(abi.encode(set)), bytes32(uint256(uint160(guardian)))); // keys[0]
        vm.store(wh, bytes32(uint256(set) + 1), bytes32(0)); // no expiry
    }

    /// A VAA (version 1) with one signature from our guardian over `body`
    function _vaa(uint32 index, bytes memory body) internal view returns (bytes memory) {
        bytes32 hash = keccak256(abi.encodePacked(keccak256(body)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianKey, hash);
        return abi.encodePacked(uint8(1), index, uint8(1), uint8(0), r, s, uint8(v - 27), body);
    }

    /// The LogMessagePublished of `wh` among the recorded logs, as a VAA body
    function _body(Vm.Log[] memory logs, address wh, uint16 fromChain, address emitter)
        internal
        view
        returns (bytes memory)
    {
        bytes32 topic = keccak256("LogMessagePublished(address,uint64,uint32,bytes,uint8)");
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != wh || logs[i].topics[0] != topic) continue;
            (uint64 seq, uint32 nonce, bytes memory payload, uint8 level) =
                abi.decode(logs[i].data, (uint64, uint32, bytes, uint8));
            return abi.encodePacked(
                uint32(block.timestamp), nonce, fromChain, bytes32(uint256(uint160(emitter))), seq, level, payload
            );
        }
        revert("no Wormhole message");
    }

    function test_sameAddressesOnBothChains() public view {
        if (noRpc) return;
        assertEq(address(E.factory), address(H.factory), "factory");
        assertEq(address(E.bridge), address(H.bridge), "bridge");
    }

    /// A coin launched on Elysium and put on HyperEVM by the launch service: same address, a pool and a floor on each.
    /// Coins bridged from Elysium to HyperEVM over Wormhole take their share of Elysium's floor; the keeper pays it
    /// into HyperEVM's floor; holders on both chains can still sell everything into their floors.
    function test_launchBothChainsBridgeAndKeepFloors() public {
        if (noRpc) return;
        address creator = makeAddr("twin creator");
        address bob = makeAddr("twin bob");
        address carol = makeAddr("twin carol");
        bytes32 salt = keccak256("twin");
        int24 tick = StartTick.forEthUsd(HYPE_USD);

        // Elysium: the creator's launch, then trading builds a floor
        vm.selectFork(ely);
        vm.deal(creator, 10 ether);
        vm.deal(bob, 1_000 ether);
        IHypexFactory.LaunchParams memory lpE = _signedStart(E, creator, salt, tick);
        vm.prank(creator, creator);
        (address token,) = E.factory.launch{value: 0.1 ether}(lpE);
        PoolKey memory kE = E.hook.keyFor(address(0), token);
        vm.warp(block.timestamp + 120);
        for (uint256 i; i < 6; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 20 minutes);
            _swap(E, bob, kE, true, -5 ether, 5 ether);
        }
        vm.roll(block.number + 1);
        E.hook.poke(kE);

        // HyperEVM: the launch service puts the same coin there, within HyperEVM's small-block gas
        vm.selectFork(hyp);
        vm.deal(keeper, 10 ether);
        vm.deal(carol, 1_000 ether);
        IHypexFactory.LaunchParams memory lpH = _signedStart(H, creator, salt, tick);
        uint256 g = gasleft();
        vm.prank(keeper, keeper);
        (address tokenH,) = H.factory.launchLeg{value: 0.1 ether}(lpH, creator);
        g -= gasleft();
        emit log_named_uint("HyperEVM leg launch gas", g);
        assertEq(tokenH, token, "the same coin address on both chains");
        assertLt(g, HYPEREVM_SMALL_BLOCK_GAS, "a leg launch fits a HyperEVM small block");
        PoolKey memory kH = H.hook.keyFor(address(0), token);
        vm.warp(block.timestamp + 120);
        for (uint256 i; i < 4; i++) {
            vm.roll(block.number + 1);
            vm.warp(block.timestamp + 20 minutes);
            _swap(H, carol, kH, true, -3 ether, 3 ether);
        }
        vm.roll(block.number + 1);
        H.hook.poke(kH);

        // bob bridges half his coins from Elysium to HyperEVM
        vm.selectFork(ely);
        uint256 half = HypexToken(token).balanceOf(bob) / 2;
        vm.recordLogs();
        vm.prank(bob, bob);
        E.bridge.send(token, half, HYP_CHAIN, bob);
        bytes memory body = _body(vm.getRecordedLogs(), ELY_WH, ELY_CHAIN, address(E.bridge));
        uint256 floorHype = E.bridge.floorOut();
        assertGt(floorHype, 0, "Elysium's floor let go of their share");
        // bob's other half still sells into Elysium's floor
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 1 minutes);
        uint256 rest = HypexToken(token).balanceOf(bob);
        vm.prank(bob);
        HypexToken(token).approve(address(E.router), rest);
        _swap(E, bob, kE, false, -int256(rest), 0);
        vm.prank(keeper);
        E.bridge.releaseFloor(payable(keeper), floorHype);

        // HyperEVM: the signed message mints bob's coins; the keeper pays the floor HYPE in (it carried it over)
        vm.selectFork(hyp);
        uint32 index = _overrideGuardians(HYP_WH);
        uint256 supply0 = HypexToken(token).totalSupply();
        H.bridge.receiveMessage(_vaa(index, body));
        assertEq(HypexToken(token).balanceOf(bob), half, "minted on HyperEVM");
        assertEq(HypexToken(token).totalSupply(), supply0 + half);
        assertEq(H.bridge.floorOwed(token), floorHype, "HyperEVM's floor is owed it");
        vm.deal(keeper, keeper.balance + floorHype);
        vm.prank(keeper);
        H.bridge.fundFloor{value: floorHype}(token);
        assertEq(H.bridge.floorOwed(token), 0);
        vm.expectRevert(HypexBridge.AlreadyDelivered.selector);
        H.bridge.receiveMessage(_vaa(index, body));

        // every holder on HyperEVM sells everything into its floor
        vm.roll(block.number + 1);
        vm.warp(block.timestamp + 20 minutes);
        H.hook.poke(kH);
        address[2] memory us = [bob, carol];
        for (uint256 i; i < 2; i++) {
            uint256 bal = HypexToken(token).balanceOf(us[i]);
            vm.prank(us[i]);
            HypexToken(token).approve(address(H.router), bal);
            _swap(H, us[i], kH, false, -int256(bal), 0);
        }
        assertEq(HypexToken(token).balanceOf(bob) + HypexToken(token).balanceOf(carol), 0, "all sold");
    }
}
