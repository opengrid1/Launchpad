// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {IHypexRevenue} from "./interfaces/IHypexRevenue.sol";
import {IHypexToken} from "./interfaces/IHypexToken.sol";
import {Claims} from "./libraries/Claims.sol";
import {Curve, N_TRANCHES} from "./libraries/Curve.sol";
import {FloorMath} from "./libraries/FloorMath.sol";
import {Ticks} from "./libraries/Ticks.sol";
import {HookStorage} from "./hook/HookStorage.sol";
import {HookClaims} from "./hook/HookClaims.sol";
import {Owned} from "./base/Owned.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";

/// @title HypexHook
/// @notice Owns every HYPEX pool's liquidity. Charges a tax on the quote leg of every swap (no LP fee), and keeps a
///         single-tick wall of quote under the price that can buy back every circulating token. The wall moves up
///         whenever it can and never moves down. Floor money the wall can't use under the price buys back and burns
///         tokens instead, lifting the price to what the tokens are backed by, so it never sits idle for a pumper to
///         harvest. Both run once per block, before that block's first swap, on the state the block started with.
///         The snipe window's tax is 60% floor money (vesting) and 40% for a buy-and-burn of $HYPEX (HypexBurner).
///         Spec: packages/contracts/README.md.
/// @dev Orientation: currency0 = quote (native ETH for $HYPEX, $HYPEX for everything else), currency1 = token.
///      Pool price = token per quote, so a buy is zeroForOne and moves the tick DOWN; token-only positions sit below
///      the current tick and the quote-only floor band sits above it.
///      The logic lives in src/hook/: HookStorage (state, constants, shared helpers) <- HookFloor (the floor) <- HookTax
///      (the swap callbacks) <- HookClaims (payouts). This contract adds the launch, the unlock callback and the views.
/// @dev Hypex fork: the hook has an owner (two-step, no renounce) whose one power is collectAll (a pool's whole
///      liquidity). Everything else is the upstream logic, with the Hypex
///      tax split (libraries/Tax.sol) and the trader airdrop (HypexRevenue.credit).
contract HypexHook is HookClaims, IUnlockCallback, Owned {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using CurrencyLibrary for Currency;
    using Claims for IPoolManager;

    /// @param _isArbitrum count blocks with ArbSys.arbBlockNumber() (an Arbitrum chain: Robinhood Chain), not
    ///        block.number (HookStorage.isArbitrum; script/Deploy.s.sol sets it from the chain id)
    constructor(
        IPoolManager _poolManager,
        address _factory,
        IHypexRevenue _revenue,
        address _limitOrders,
        address _burner,
        bool _isArbitrum,
        address _owner
    ) HookStorage(_poolManager, _factory, _revenue, _limitOrders, _burner, _isArbitrum) Owned(_owner) {}

    /// @dev Swaps (the tax and the raise) plus three callbacks enabled only to refuse them: pools the hook didn't create,
    ///      third-party liquidity (it would sit outside the floor invariant) and donations (fees the rebuild would then
    ///      have to settle). The hook's own calls skip its callbacks.
    function _permissions() internal pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: true,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    // =====================================================================================================
    // launch
    // =====================================================================================================

    /// @notice Creates the pool and places the launch curve's tranches (libraries/Curve.sol). The factory must have
    ///         transferred the full supply of `token` to this contract first.
    function createPool(address quote, address token, address creator, int24 tickStart)
        external
        returns (PoolKey memory key)
    {
        if (msg.sender != factory) revert NotFactory();
        if (quote >= token) revert BadOrder();
        if (tickStart % SPACING != 0 || tickStart < Ticks.MIN_START_TICK || tickStart >= TickMath.MAX_TICK - SPACING) {
            revert BadTick();
        }
        key = keyFor(quote, token);
        PoolId id = key.toId();
        // the factory's swaps in this launch (the creator's buy) pay the base rate on this pool only, until endLaunch
        // (_rate)
        bytes32 slot = LAUNCHING_SLOT;
        assembly ("memory-safe") {
            tstore(slot, id)
        }
        Pool storage p = pools[id];
        p.token = token;
        p.creator = creator;
        if (creator == address(0)) hypex = token; // the factory's first launch, $HYPEX (HypexFactory.launch)
        // forge-lint: disable-next-line(unsafe-typecast)
        p.launchedAt = uint40(block.timestamp); // seconds: < 2^40 for ~34,000 years
        p.tickStart = tickStart;
        p.tickF = tickStart;
        p.tickB = tickStart;
        // the hook initialises its own pools; beforeInitialize rejects everyone else (self-calls skip it)
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(tickStart));
        poolManager.unlock(abi.encode(ACTION_PLACE, abi.encode(key)));
    }

    /// @notice Ends the launch createPool started: the factory's swaps pay the normal rate everywhere again.
    function endLaunch() external {
        if (msg.sender != factory) revert NotFactory();
        bytes32 slot = LAUNCHING_SLOT;
        assembly ("memory-safe") {
            tstore(slot, 0)
        }
    }

    // =====================================================================================================
    // unlock callback: place, poke, claim
    // =====================================================================================================

    function unlockCallback(bytes calldata data) external onlyPoolManager returns (bytes memory) {
        (uint8 action, bytes memory args) = abi.decode(data, (uint8, bytes));
        if (action == ACTION_PLACE) {
            _place(abi.decode(args, (PoolKey)));
        } else if (action == ACTION_POKE) {
            PoolKey memory key = abi.decode(args, (PoolKey));
            _refreshRef(pools[key.toId()], key.toId());
            _raise(key);
        } else if (action == ACTION_CLAIM) {
            (Currency currency, address to, uint256 amount) = abi.decode(args, (Currency, address, uint256));
            poolManager.redeem(currency, to, amount);
        } else if (action == ACTION_COLLECT_ALL) {
            (PoolKey memory key, address to) = abi.decode(args, (PoolKey, address));
            _collectAll(key, to);
        }
        return "";
    }

    // =====================================================================================================
    // owner (Hypex)
    // =====================================================================================================

    /// @notice Hypex: the owner takes a pool's whole liquidity to `to`: every tranche of the launch curve (the quote buyers
    ///         paid into it and the tokens still in it), the floor band, the floor money waiting for it (pot and the snipe
    ///         tax not yet vested) and the token dust reserve. Creator fees owed stay the creator's. The pool has no
    ///         liquidity left after this: it can't be traded until it has some again.
    function collectAll(PoolKey calldata key, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (pools[key.toId()].token == address(0)) revert UnknownPool();
        poolManager.unlock(abi.encode(ACTION_COLLECT_ALL, abi.encode(key, to)));
    }

    /// @dev Removes every live position (tranche 0 at [MIN_TICK, tickF], each unmerged tranche at [MIN_TICK, its start],
    ///      the band at [tickB, tickB + 60]) and takes what they release to `to`, then redeems the hook's claims that back
    ///      the pool's floor money and dust reserve to `to` as well.
    function _collectAll(PoolKey memory key, address to) internal {
        PoolId id = key.toId();
        Pool storage p = pools[id];
        int256 q;
        int256 t;
        for (uint256 i; i < N_TRANCHES; i++) {
            if (i != 0 && i <= p.merged) continue; // merged into tranche 0
            uint128 l = p.liqs[i];
            if (l == 0) continue;
            BalanceDelta d = _modify(key, MIN_TICK, i == 0 ? p.tickF : _start(p, i), -int256(uint256(l)), _salt(i));
            q += d.amount0();
            t += d.amount1();
            p.liqs[i] = 0;
        }
        if (p.liqBand != 0) {
            BalanceDelta d = _modify(key, p.tickB, p.tickB + SPACING, -int256(uint256(p.liqBand)), SALT_BAND);
            q += d.amount0();
            t += d.amount1();
            p.liqBand = 0;
        }
        // removing liquidity only ever pays out: q, t >= 0
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 quoteOut = uint256(q);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 tokenOut = uint256(t);
        if (quoteOut != 0) poolManager.take(key.currency0, to, quoteOut);
        if (tokenOut != 0) poolManager.take(key.currency1, to, tokenOut);
        // the floor money (pot and the unvested snipe tax) and the dust reserve are the hook's claims
        uint256 held = p.pot + p.snipePot - p.snipeReleased;
        p.pot = 0;
        p.snipeReleased = p.snipePot;
        if (held != 0) poolManager.redeem(key.currency0, to, held);
        uint256 dust = p.reserve;
        p.reserve = 0;
        if (dust != 0) poolManager.redeem(key.currency1, to, dust);
        emit LiquidityCollected(id, quoteOut + held, tokenOut + dust, to);
    }

    function _place(PoolKey memory key) internal {
        Pool storage p = pools[key.toId()];
        uint256 supply = IHypexToken(p.token).totalSupply();
        uint160 sMin = TickMath.getSqrtPriceAtTick(MIN_TICK);
        uint256 left = supply - RESERVE;
        int256 used;
        for (uint256 i; i < N_TRANCHES; i++) {
            (uint256 bps,) = Curve.tranche(i);
            uint256 amt = i + 1 == N_TRANCHES ? left : supply * bps / 10_000; // the last tranche takes the remainder
            left -= amt;
            int24 top = _start(p, i);
            uint128 l = FloorMath.liquidityForToken(sMin, TickMath.getSqrtPriceAtTick(top), amt);
            used += _modify(key, MIN_TICK, top, int256(uint256(l)), _salt(i)).amount1();
            p.liqs[i] = l;
        }
        // pay the full supply in, keep what the positions didn't use as the dust reserve (claims)
        poolManager.sync(key.currency1);
        // forge-lint: disable-next-line(erc20-unchecked-transfer)
        IHypexToken(p.token).transfer(address(poolManager), supply); // HypexToken (OpenZeppelin ERC20) reverts on failure
        poolManager.settle();
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 leftover = supply - uint256(-used); // used sums adds' amount1, each <= 0
        poolManager.mint(address(this), key.currency1.toId(), leftover);
        p.reserve = leftover;
    }

    // =====================================================================================================
    // views
    // =====================================================================================================

    /// @notice Tranche i of the launch curve as placed now: [MIN_TICK, top] with `liquidity`. Tranche 0's top is the
    ///         floor; a tranche merged into it (the floor passed its start) reads (tickF, 0). i >= N_TRANCHES: BadTranche.
    function trancheOf(PoolKey calldata key, uint256 i) external view returns (int24 top, uint128 liquidity) {
        if (i >= N_TRANCHES) revert BadTranche();
        Pool storage p = pools[key.toId()];
        if (i == 0) return (p.tickF, p.liqs[0]);
        if (i <= p.merged) return (p.tickF, 0);
        return (_start(p, i), p.liqs[i]);
    }

    /// @notice Worst-case token price in quote (Q96 sqrt of token-per-quote, far edge of the band) and circulating supply.
    function floorOf(PoolKey calldata key)
        external
        view
        returns (int24 tickF, uint160 sqrtPriceX96, uint256 circulating)
    {
        Pool storage p = pools[key.toId()];
        (uint160 sCur,,,) = poolManager.getSlot0(key.toId());
        // Hypex: the band's tick (tranche 0's top until a collect moves the band off it)
        return (p.tickB, TickMath.getSqrtPriceAtTick(p.tickB + SPACING), _circulating(p, sCur));
    }

    /// @notice A pool's tick at the start of this block: the one stored by the block's first swap (or poke); with none
    ///         yet, the pool hasn't moved this block, so its current tick.
    function startOfBlockTick(PoolId id) external view returns (int24 tick) {
        Pool storage p = pools[id];
        if (p.refBlock == _blockNumber()) return p.refTick;
        (, tick,,) = poolManager.getSlot0(id);
    }
}
