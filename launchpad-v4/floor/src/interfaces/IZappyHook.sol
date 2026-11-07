// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IZappyRevenue} from "./IZappyRevenue.sol";

/// @notice ZappyHook: owns every ZAPPY pool's liquidity, taxes the quote leg of every swap and keeps the ratcheting floor.
///         Spec: packages/contracts/README.md.
interface IZappyHook {
    /// @param toBurn the snipe tax's $ZAPPY buy-and-burn share: burned at once on a $ZAPPY pair (ZappyBurned), sent to
    ///        ZappyBurner as claims on any other pair. toFloor + toCreator + toTeam + toBurn == the tax
    event TaxPaid(
        PoolId indexed poolId,
        address indexed swapper,
        bool buy,
        uint256 quoteVolume,
        uint256 toFloor,
        uint256 toCreator,
        uint256 toTeam,
        uint256 toBurn
    );
    /// @param sqrtPriceX96 worst-case price if everyone sells: the far edge of the band (tickF + 60)
    event FloorRaised(
        PoolId indexed poolId, int24 tickF, uint160 sqrtPriceX96, uint256 quoteInFloor, uint256 circulating
    );
    /// @notice The block's raise reverted (and rolled back); the swap went through. `reason` is the revert data: empty
    ///         when the raise ran out of its RAISE_GAS, else the error (FloorBroken, a PoolManager error, ...). It still
    ///         counts as the block's raise: the next block retries it
    event RaiseFailed(PoolId indexed poolId, bytes reason);
    /// @notice Floor money no one holds tokens for left the floor: an empty pool's pot, band and snipe pot (vested or
    ///         not), or floor money (pot, vested snipe tax, band) beyond what the circulating tokens can carry: their
    ///         worth at the highest price a buyback may lift to. Quote amount.
    /// @param burn it went to the $ZAPPY buy-and-burn, like TaxPaid.toBurn (burned at once on a $ZAPPY pair, else to
    ///        ZappyBurner as claims); false: to the team, only in $ZAPPY's own pool (unlike its snipe share, which is its
    ///        creator fee)
    event FloorSwept(PoolId indexed poolId, uint256 amount, bool burn);
    /// @notice $ZAPPY burned at once by a $ZAPPY pair's burn share (its snipe tax's, or its swept floor money): `poolId` is
    ///         the pool it was paid in. Every other pair's burn share goes to ZappyBurner, whose BoughtAndBurned logs its
    ///         burns.
    event ZappyBurned(PoolId indexed poolId, uint256 zappyBurned);
    /// @param burned tokens the spare floor money bought back and burned; sqrtPriceX96 the price it lifted the pool to
    event BoughtBack(PoolId indexed poolId, uint256 burned, uint160 sqrtPriceX96);
    event Claimed(address indexed account, address indexed currency, uint256 amount);
    event CreatorChanged(PoolId indexed poolId, address indexed creator);
    /// @notice ZappyRevenue.credit reverted: this swap's protocol fee stayed with the team here (teamOwed; $ZAPPY's creator
    ///         fee in its creatorOwed, which claimCreator credits to ZappyRevenue)
    event CreditFailed(PoolId indexed poolId, uint256 amount);
    /// @notice Zappy: the owner took `bps` of a pool's floor (its band and its pot): `quote` of the pair to `to`, and
    ///         `tokens` the band held (a band the price is inside) into the dust reserve.
    event FloorCollected(PoolId indexed poolId, uint16 bps, uint256 quote, uint256 tokens, address indexed to);

    error NotFactory();
    error ZeroAddress();
    error NotSelf();
    error NotCreator();
    error UnknownPool();
    error BadOrder();
    error BadTick();
    error PartialFill();
    error FloorBroken();
    error NeedGas();
    error BadTranche();
    error BadBps();

    /// @notice The pool key for a pair: `quote` is currency0 (address(0) = ETH), `token` currency1, no LP fee.
    function keyFor(address quote, address token) external view returns (PoolKey memory);

    /// @notice Creates the pool and places the launch curve. Factory only; it must have sent the full supply here first.
    /// @param creator address(0) for $ZAPPY (the team is its creator)
    function createPool(address quote, address token, address creator, int24 tickStart)
        external
        returns (PoolKey memory key);

    /// @notice Ends the launch createPool started: the factory's swaps pay the normal rate everywhere again.
    function endLaunch() external;

    /// @notice Raise entry used from beforeSwap (via try/catch). Only callable by the hook itself.
    function raiseFromHook(PoolKey calldata key) external;

    /// @notice Applies the pot to the floor now. Anyone can call it; trading normally does this already (a block's first
    ///         swap settles the block: a poke after it does nothing until the next block).
    function poke(PoolKey calldata key) external;

    /// @notice Pays a pool's creator balance to `to`. Every creator fee is owed (nobody is paid in a swap) until this
    ///         claims it. Anyone can send it to the creator (the keeper's payouts); only the creator can name another `to`. $ZAPPY's fees are ZAPPY's revenue, credited to ZappyRevenue in every swap: what a swap
    ///         couldn't credit (CreditFailed) is credited to it here instead (`to` unused), shared out to the partners and
    ///         the team with no referral (reverts if ZappyRevenue does: the fees stay owed).
    function claimCreator(PoolKey calldata key, address to) external;

    /// @notice Pays the team what it is owed in `currency`. Anyone can call it.
    function claimTeam(Currency currency) external;

    /// @notice Hands a pool's creator fees to a new address. The current creator only.
    function setCreator(PoolKey calldata key, address creator) external;

    /// @notice Tranche i of the launch curve as placed now: [MIN_TICK, top] with `liquidity`. Reverts BadTranche past the
    ///         last tranche.
    function trancheOf(PoolKey calldata key, uint256 i) external view returns (int24 top, uint128 liquidity);

    /// @notice The floor tick, the worst-case price (Q96 sqrt of token-per-quote at the band's far edge) and circulating supply.
    function floorOf(PoolKey calldata key)
        external
        view
        returns (int24 tickF, uint160 sqrtPriceX96, uint256 circulating);

    /// @notice A pool's tick at the start of this block (what the floor and the start bands measure against).
    function startOfBlockTick(PoolId id) external view returns (int24);

    /// @notice Blocks are counted with ArbSys.arbBlockNumber() (an Arbitrum chain: Robinhood Chain), not block.number.
    ///         Fixed at deploy.
    function isArbitrum() external view returns (bool);

    function factory() external view returns (address);
    /// @notice ZappyRevenue, which shares out the protocol fee (and $ZAPPY's own creator fee) of every swap.
    function revenue() external view returns (IZappyRevenue);
    /// @notice ZappyLimitOrders: the one swapper whose hookData names the trader ZappyRevenue credits (the order's owner).
    function limitOrders() external view returns (address);
    /// @notice ZappyBurner: gets every burn share that isn't already $ZAPPY, as ERC-6909 claims.
    function burner() external view returns (address);
    function zappy() external view returns (address);
    function teamOwed(Currency currency) external view returns (uint256);
}
