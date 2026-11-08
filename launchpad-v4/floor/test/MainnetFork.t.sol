// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IZappyFactory} from "../src/interfaces/IZappyFactory.sol";
import {ZappyToken} from "../src/ZappyToken.sol";
import {ZappyBase} from "./Zappy.t.sol";

/// The whole stack on a fork of Ethereum mainnet, against Uniswap's real v4 PoolManager: $ZAPPY's launch, a creator's
/// ETH-paired launch with a dev buy, buys and sells through the snipe window and after, the block raise, the owner's
/// collect and a full exit into the floor. Runs only with ETH_RPC_URL set (forge test --match-contract MainnetFork).
contract MainnetForkTest is ZappyBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// Uniswap v4 PoolManager on Ethereum mainnet
    address constant MAINNET_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    bool forked;

    function setUp() public override {
        string memory rpc = vm.envOr("ETH_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return; // no RPC: every test below skips
        vm.createSelectFork(rpc);
        forked = true;
        super.setUp();
    }

    function _poolManager() internal pure override returns (IPoolManager) {
        return IPoolManager(MAINNET_POOL_MANAGER);
    }

    /// Salted so no test address is a real mainnet account: makeAddr("bob") is, with EIP-7702 code that sweeps ETH
    function _addr(string memory name) internal override returns (address a) {
        a = makeAddr(string.concat("zappy.fun fork test / ", name));
        require(a.code.length == 0, "test address exists on mainnet");
    }


    modifier onFork() {
        vm.skip(!forked);
        _;
    }

    function test_fork_isEthereumWithTheRealPoolManager() public onFork {
        assertEq(block.chainid, 1, "Ethereum mainnet");
        assertGt(MAINNET_POOL_MANAGER.code.length, 0, "the PoolManager is deployed");
        assertEq(address(pm), MAINNET_POOL_MANAGER, "the stack is on it");
    }

    function test_fork_zappyLaunchTradesAndRaises() public onFork {
        _launchZappy();
        address bob = _user("bob");
        _approve(bob, zappy);
        // snipe window: the first buy pays the high rate; the floor still gets its share
        _swap(bob, zappyKey, true, -1 ether, 1 ether);
        vm.warp(vm.getBlockTimestamp() + 2 minutes);
        vm.roll(vm.getBlockNumber() + 1);
        _swap(bob, zappyKey, true, -3 ether, 3 ether);
        (int24 tick0,,,,) = _pool(zappyKey);
        for (uint256 i; i < 8; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 15 minutes);
            _swap(bob, zappyKey, true, -0.5 ether, 0.5 ether);
        }
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(zappyKey);
        (int24 tick1,,,, uint128 band) = _pool(zappyKey);
        assertLt(tick1, tick0, "the floor moved up");
        assertGt(band, 0, "a band holds ETH under the price");
        // a sell through the real PoolManager, taxed on the ETH leg
        uint256 before = bob.balance;
        _swap(bob, zappyKey, false, -int256(ZappyToken(zappy).balanceOf(bob) / 4), 0);
        assertGt(bob.balance, before, "sold for ETH");
    }

    function test_fork_creatorLaunchOnEthThenCollectAndExit() public onFork {
        _launchZappy();
        address alice = _user("alice");
        string memory name = "Floor Frog";
        string memory ticker = "FFROG";
        bytes32 salt = _saltAfter(alice, address(0), name, ticker);
        // a dev buy of 0.2 ETH at launch, paid with the fee
        IZappyFactory.LaunchParams memory lp = _signedEth(alice, name, ticker, salt, 0.2 ether, ZAPPY_TICK);
        vm.prank(alice);
        (address frog,) = factory.launch{value: FEE + 0.2 ether}(lp);
        PoolKey memory key = hook.keyFor(address(0), frog);
        address bob = _user("bob");
        _approve(bob, frog);
        vm.warp(vm.getBlockTimestamp() + 2 minutes); // past the snipe window
        for (uint256 i; i < 10; i++) {
            vm.roll(vm.getBlockNumber() + 1);
            vm.warp(vm.getBlockTimestamp() + 10 minutes);
            _swap(bob, key, true, -0.5 ether, 0.5 ether);
        }
        vm.roll(vm.getBlockNumber() + 1);
        hook.poke(key);
        (,,,, uint128 band) = _pool(key);
        assertGt(band, 0, "the coin built a floor");

        // the owner takes 30% of the floor; the band drops to where the rest still covers everyone
        address treasury = _addr("treasury");
        hook.collectFloor(key, 3_000, treasury);
        assertGt(treasury.balance, 0, "collected in ETH");
        (int24 floorTick,,) = hook.floorOf(key);
        _dumpAll(key, _one(bob));
        (, int24 tickAfter,,) = pm.getSlot0(key.toId());
        assertLe(tickAfter, floorTick + 60, "every holder sold inside the floor");
    }
}
