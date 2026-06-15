// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// NOTE: run this in a Foundry + v4-template project (forge test). It can't run in the
// chat sandbox. It's a starting scaffold — adjust imports/paths to your template and
// validate that BOTH a buy and a sell increase a holder's claimable ETH.

import {Test, console} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

import {OFAFeeHook, IOFADistributor} from "../src/OFAFeeHook.sol";
import {OFAToken} from "../src/OFAToken.sol";

contract OFAFeeHookTest is Test, Deployers {
    OFAFeeHook hook;
    OFAToken token;
    PoolKey key;
    address holder = makeAddr("holder");

    uint256 constant FEE_BPS = 200; // 2%

    function setUp() public {
        deployFreshManagerAndRouters(); // sets `manager`, swapRouter, modifyLiquidityRouter

        // $OFA token; full supply to this test contract
        token = new OFAToken("Order Flow Auction", "OFA", 100_000_000e18, address(this), address(this));

        // mine an address with the 4 required flag bits and deploy the hook there
        uint160 flags = uint160(
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
        );
        address hookAddr = address(flags ^ (0x4444 << 144));
        deployCodeTo("OFAFeeHook.sol:OFAFeeHook", abi.encode(manager, IOFADistributor(address(token)), FEE_BPS), hookAddr);
        hook = OFAFeeHook(payable(hookAddr));

        // ETH (currency0 = address 0) / OFA (currency1) pool with the hook
        key = PoolKey({
            currency0: CurrencyLibrary.ADDRESS_ZERO,
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        // exclude the things that hold OFA but shouldn't earn: pool manager + hook + this test
        token.setExcludedFromRewards(address(manager), true);
        token.setExcludedFromRewards(address(hook), true);
        token.setExcludedFromRewards(address(this), true);

        // make `holder` an eligible holder so rewards have somewhere to go
        token.transfer(holder, 1_000_000e18);

        // seed two-sided liquidity so both buy and sell can execute
        token.approve(address(modifyLiquidityRouter), type(uint256).max);
        modifyLiquidityRouter.modifyLiquidity{value: 10 ether}(
            key,
            ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 1e18, salt: 0}),
            ""
        );
    }

    function test_buyForwardsEthRewardToHolders() public {
        uint256 before = token.withdrawableRewardOf(holder);
        // BUY: ETH -> OFA, exact-in
        swap(key, true, -1 ether, "");
        uint256 afterBal = token.withdrawableRewardOf(holder);
        assertGt(afterBal, before, "buy should increase holder ETH rewards");
    }

    function test_sellForwardsEthRewardToHolders() public {
        // get some OFA to the holder and have them sell
        uint256 before = token.withdrawableRewardOf(holder);
        // SELL: OFA -> ETH, exact-in (negative amountSpecified, zeroForOne = false)
        vm.prank(holder);
        token.approve(address(swapRouter), type(uint256).max);
        vm.prank(holder);
        // depending on template, use the swapRouter helper; this is illustrative
        swap(key, false, -1000e18, "");
        uint256 afterBal = token.withdrawableRewardOf(holder);
        assertGt(afterBal, before, "sell should increase holder ETH rewards");
    }

    receive() external payable {}
}
