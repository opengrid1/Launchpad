// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IHypexHook} from "../src/interfaces/IHypexHook.sol";
import {HypexToken} from "../src/HypexToken.sol";
import {HypexBase} from "./Hypex.t.sol";

/// Hypex: the 2.5% tax splits 0.5% floor / 0.7% creator / 0.7% trader airdrop / 0.6% platform; the trader's airdrop is
/// booked to them in the swap and claimable any time; the hook owner can take a pool's whole liquidity (collectAll).
contract HypexSplitTest is HypexBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function _ethChild(address creator, string memory name) internal returns (PoolKey memory k) {
        bytes32 s = keccak256(abi.encode(name));
        vm.prank(creator);
        (address tok,) = factory.launch{value: 0.01 ether}(_signedEth(creator, name, name, s, 0, HYPEX_TICK));
        k = hook.keyFor(address(0), tok);
    }

    /// past the snipe window, so every swap pays the base 2.5%
    function _settle() internal {
        vm.roll(vm.getBlockNumber() + 1);
        vm.warp(vm.getBlockTimestamp() + 20 minutes);
    }

    function test_splitOfABuy() public {
        _launchHypex();
        address creator = _user("creator");
        PoolKey memory k = _ethChild(creator, "Split");
        _settle();
        address bob = _user("bob");
        (, uint256 pot0, uint256 owed0,,) = _pool(k);
        uint256 team0 = revenue.owed(revenue.team(), address(0));

        _swap(bob, k, true, -1 ether, 1 ether);

        uint256 tax = 1 ether * 25_000 / 1_000_000; // 0.025 ETH
        (, uint256 pot1, uint256 owed1,,) = _pool(k);
        uint256 creatorCut = owed1 - owed0;
        uint256 airdrop = revenue.owed(bob, address(0));
        uint256 team = revenue.owed(revenue.team(), address(0)) - team0;
        assertEq(creatorCut, tax * 7 / 25, "creator 0.7%");
        assertEq(airdrop, tax * 7 / 25, "trader airdrop 0.7%");
        assertEq(team, tax * 6 / 25, "platform 0.6%");
        assertEq(pot1 - pot0, tax - creatorCut - airdrop - team, "floor 0.5%");
        assertApproxEqAbs(airdrop, 0.007 ether, 1, "0.7% of 1 ETH");
        assertApproxEqAbs(team, 0.006 ether, 1, "0.6% of 1 ETH");
        assertApproxEqAbs(pot1 - pot0, 0.005 ether, 1, "0.5% of 1 ETH");
    }

    function test_airdropOnSellsTooAndClaimable() public {
        _launchHypex();
        PoolKey memory k = _ethChild(_user("creator"), "Sell");
        _settle();
        address bob = _user("bob");
        address token = Currency.unwrap(k.currency1);
        _swap(bob, k, true, -1 ether, 1 ether);
        uint256 afterBuy = revenue.owed(bob, address(0));
        _settle();
        _approve(bob, token);
        uint256 bal = HypexToken(token).balanceOf(bob);
        _swap(bob, k, false, -int256(bal / 2), 0);
        uint256 afterSell = revenue.owed(bob, address(0));
        assertGt(afterSell, afterBuy, "a sell earns airdrop too");

        // anyone can push it to bob; only bob can send it elsewhere
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert();
        revenue.claim(bob, address(0), eve);
        uint256 before = bob.balance;
        vm.prank(eve);
        revenue.claim(bob, address(0), bob);
        assertEq(bob.balance - before, afterSell, "the whole airdrop paid in ETH");
        assertEq(revenue.owed(bob, address(0)), 0, "nothing left owed");
    }

    /// trading against yourself never pays: the airdrop and the creator fee back are less than the tax
    function test_washTradingLoses() public {
        _launchHypex();
        address w = _user("washer");
        PoolKey memory k = _ethChild(w, "Wash");
        _settle();
        address token = Currency.unwrap(k.currency1);
        _approve(w, token);
        uint256 start = w.balance;
        for (uint256 i; i < 5; i++) {
            _swap(w, k, true, -1 ether, 1 ether);
            _settle();
            _swap(w, k, false, -int256(HypexToken(token).balanceOf(w)), 0);
            _settle();
        }
        vm.prank(w);
        revenue.claim(w, address(0), w);
        hook.claimCreator(k, w);
        assertLt(w.balance, start, "wash trading loses money");
    }

    // ------------------------------------------------------------------ collectAll

    function _built() internal returns (PoolKey memory k, address bob) {
        _launchHypex();
        k = _ethChild(_user("creator"), "Coll");
        bob = _user("bob");
        _swap(bob, k, true, -5 ether, 5 ether);
        for (uint256 i; i < 8; i++) {
            _settle();
            _swap(bob, k, true, -0.5 ether, 0.5 ether);
        }
        _settle();
        hook.poke(k);
    }

    function test_collectAllOnlyOwner() public {
        (PoolKey memory k,) = _built();
        address eve = makeAddr("eve");
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, eve));
        hook.collectAll(k, eve);
        vm.expectRevert(IHypexHook.ZeroAddress.selector);
        hook.collectAll(k, address(0));
        PoolKey memory unknown = hook.keyFor(address(0), address(0xBEEF));
        vm.expectRevert(IHypexHook.UnknownPool.selector);
        hook.collectAll(unknown, address(this));
    }

    function test_collectAllTakesEveryPosition() public {
        (PoolKey memory k, address bob) = _built();
        (, uint256 pot,, uint256 reserve, uint128 band) = _pool(k);
        assertGt(band, 0, "a floor was built");
        address token = Currency.unwrap(k.currency1);
        uint256 creatorOwed;
        (,, creatorOwed,,) = _pool(k);
        address to = makeAddr("treasury");
        uint256 inPool = pm.getLiquidity(k.toId());
        assertGt(inPool, 0, "liquidity at the price");

        hook.collectAll(k, to);

        (, uint256 pot1, uint256 creatorOwed1, uint256 reserve1, uint128 band1) = _pool(k);
        assertEq(pot1, 0, "pot taken");
        assertEq(band1, 0, "band taken");
        assertEq(reserve1, 0, "dust taken");
        assertEq(creatorOwed1, creatorOwed, "creator fees stay the creator's");
        assertEq(pm.getLiquidity(k.toId()), 0, "no liquidity left at the price");
        // every quote buyers paid in (net of the tax that went elsewhere) and the floor money came out
        assertGt(to.balance, 5 ether, "the buyers' ETH and the floor money");
        assertGt(HypexToken(token).balanceOf(to), 0, "the unsold tokens");
        // every token is with bob (who bought) or the treasury (the rest): none stays in the pool beyond rounding dust
        assertApproxEqAbs(
            HypexToken(token).balanceOf(to) + HypexToken(token).balanceOf(bob),
            HypexToken(token).totalSupply(),
            1e6,
            "no token stays in the pool"
        );
        pot;
        reserve;

        // the creator can still claim their fees
        hook.claimCreator(k, _addr("creator"));
    }
}
