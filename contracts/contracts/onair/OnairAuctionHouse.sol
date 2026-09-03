// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OnairAuctionHouse
/// @notice Continuous clearing auctions for ONAIR coins, escrowed here. One
///         contract runs every auction, so opening one is cheap (no contract
///         deploy). Mechanics, block by block:
///
///           - The auctioned supply is released evenly: `perBlock` coins a block.
///           - A bid is a budget of HYPE and a max price. The budget is spread
///             evenly over the blocks left in the auction (`rate` per block), so
///             nobody wins by being fast: a bid placed in the first second is
///             still paid out over the whole auction.
///           - Each block has ONE clearing price: the lowest grid price at which
///             the coins released that block cover every active bid's rate at or
///             above that price. Everyone active that block pays that price.
///             Demand only ever grows (bids cannot be pulled), so the clearing
///             price only ever rises. Earlier bids therefore average a lower
///             price than later ones.
///           - A bid whose max price falls under the clearing price is outbid
///             from that block on: no more fills, its unspent budget is refunded
///             when the auction ends.
///           - The auction graduates when the HYPE it raised reaches `minRaise`.
///             Then the factory takes the raised HYPE and the unsold coins to
///             seed the pool. Otherwise every bidder gets a full refund.
///
///         State is advanced lazily: a checkpoint is written whenever a bid moves
///         the clearing price, and fills are derived from the accumulator between
///         checkpoints, so claims cost O(1) with a hint.
contract OnairAuctionHouse is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant Q96 = 1 << 96;
    uint256 internal constant Q192 = 1 << 192;

    struct Params {
        uint64 durationBlocks;
        uint256 floorPriceQ96; // HYPE wei per coin wei, Q96; multiple of tickSpacingQ96
        uint256 tickSpacingQ96;
        uint256 minRaiseWei;
    }

    struct Checkpoint {
        uint64 blk; // first block this clearing price applies to
        uint256 priceQ96;
        uint256 cumInv192; // Σ over past blocks of 2^192 / price   (coins per wei, accumulated)
        uint256 raised; // Σ over past blocks of active rate       (HYPE spent so far)
        uint256 sold; // Σ over past blocks of coins cleared
    }

    struct Auction {
        address token;
        uint64 startBlock;
        uint64 endBlock;
        uint64 lastBlock; // block the accumulators are synced to
        uint256 supply;
        uint256 perBlock;
        uint256 floorPriceQ96;
        uint256 tickSpacingQ96;
        uint256 minRaiseWei;
        uint256 clearingQ96;
        uint256 activeRate; // Σ rate of bids with maxPrice >= clearing
        uint256 head; // lowest active tick price (0 = none)
        uint256 cumInv192;
        uint256 raised;
        uint256 sold;
        bool finalized;
        bool graduated;
        bool cancelled;
        uint256 collected; // HYPE already taken out of the spent escrow by the factory
    }

    struct Tick {
        uint256 next; // next higher tick price (0 = end)
        uint256 rate; // Σ rate of bids at this tick
        bool exists;
    }

    struct Bid {
        address owner;
        uint256 budget;
        uint256 rate;
        uint256 maxPriceQ96;
        uint64 startBlock;
        uint32 startCp; // checkpoint index in force when the bid was placed
        bool exited;
    }

    address public immutable factory;

    mapping(address token => Auction) internal _auctions;
    mapping(address token => mapping(uint256 price => Tick)) internal _ticks;
    mapping(address token => Checkpoint[]) internal _cps;
    mapping(address token => Bid[]) internal _bids;

    event AuctionOpened(address indexed token, uint64 startBlock, uint64 endBlock, uint256 supply, uint256 floorPriceQ96, uint256 minRaiseWei);
    event BidPlaced(address indexed token, uint256 indexed bidId, address indexed owner, uint256 maxPriceQ96, uint256 budget, uint256 rate);
    event ClearingPrice(address indexed token, uint64 blk, uint256 priceQ96);
    event Finalized(address indexed token, bool graduated, uint256 clearingQ96, uint256 raised, uint256 sold);
    event Cancelled(address indexed token);
    event EscrowCollected(address indexed token, address indexed to, uint256 amount);
    event Claimed(address indexed token, uint256 indexed bidId, address indexed owner, uint256 coins, uint256 refund);

    error OnlyFactory();
    error AlreadyOpen();
    error NotOpen();
    error AuctionOver();
    error AuctionRunning();
    error AlreadyFinalized();
    error NotFinalized();
    error ZeroAmount();
    error NotOnGrid();
    error BelowClearing();
    error BadHint();
    error AlreadyExited();
    error BadBid();
    error TransferFailed();

    modifier onlyFactory() {
        if (msg.sender != factory) revert OnlyFactory();
        _;
    }

    constructor(address factory_) {
        factory = factory_;
    }

    // ------------------------------------------------------------------
    // Factory: open / finalize / cancel
    // ------------------------------------------------------------------

    /// @notice Open an auction. The factory must have transferred `supply` of
    ///         `token` here beforehand.
    function open(address token, uint256 supply, Params calldata p) external onlyFactory {
        Auction storage a = _auctions[token];
        if (a.token != address(0)) revert AlreadyOpen();
        if (supply == 0 || p.durationBlocks == 0 || p.tickSpacingQ96 == 0 || p.floorPriceQ96 == 0 || p.floorPriceQ96 % p.tickSpacingQ96 != 0) revert BadBid();
        if (IERC20(token).balanceOf(address(this)) < supply) revert ZeroAmount();
        a.token = token;
        a.startBlock = uint64(block.number);
        a.endBlock = uint64(block.number) + p.durationBlocks;
        a.lastBlock = uint64(block.number);
        a.supply = supply;
        a.perBlock = supply / p.durationBlocks;
        a.floorPriceQ96 = p.floorPriceQ96;
        a.tickSpacingQ96 = p.tickSpacingQ96;
        a.minRaiseWei = p.minRaiseWei;
        a.clearingQ96 = p.floorPriceQ96;
        _cps[token].push(Checkpoint({blk: uint64(block.number), priceQ96: p.floorPriceQ96, cumInv192: 0, raised: 0, sold: 0}));
        emit AuctionOpened(token, a.startBlock, a.endBlock, supply, p.floorPriceQ96, p.minRaiseWei);
    }

    /// @notice After the end block: settle the accumulators and hand the factory
    ///         the raised HYPE (graduated) and the unsold coins (always).
    function finalize(address token) external onlyFactory nonReentrant returns (bool graduated, uint256 clearingQ96, uint256 raised, uint256 sold, uint256 unsold) {
        Auction storage a = _auctions[token];
        if (a.token == address(0)) revert NotOpen();
        if (a.finalized) revert AlreadyFinalized();
        if (block.number < a.endBlock && !a.cancelled) revert AuctionRunning();
        _sync(a, token);
        a.finalized = true;
        // Once spent escrow has been collected the fills stand, bond or not.
        graduated = !a.cancelled && (a.raised >= a.minRaiseWei || a.collected > 0);
        a.graduated = graduated;
        raised = a.raised;
        sold = a.sold;
        clearingQ96 = a.clearingQ96;
        if (graduated) {
            unsold = a.supply - sold;
            IERC20(token).safeTransfer(factory, unsold);
            uint256 due = raised - a.collected;
            a.collected = raised;
            (bool ok,) = factory.call{value: due}("");
            if (!ok) revert TransferFailed();
            raised = due; // what the factory receives now
        } else {
            // nothing sold: every coin goes back, every bidder refunds in full
            unsold = a.supply;
            sold = 0;
            raised = 0;
            IERC20(token).safeTransfer(factory, a.supply);
        }
        emit Finalized(token, graduated, clearingQ96, raised, sold);
    }

    /// @notice Factory (owner): take HYPE that bidders have already spent on
    ///         cleared coins, at any time. Unspent budgets stay in escrow for
    ///         refunds. After a collection the auction cannot fail: fills stand
    ///         and the pool is seeded with whatever spent HYPE is left.
    function collectEscrow(address token, address to) external onlyFactory nonReentrant returns (uint256 amount) {
        Auction storage a = _auctions[token];
        if (a.token == address(0)) revert NotOpen();
        if (a.finalized || a.cancelled) revert AlreadyFinalized();
        _sync(a, token);
        amount = a.raised - a.collected;
        if (amount == 0) revert ZeroAmount();
        a.collected = a.raised;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit EscrowCollected(token, to, amount);
    }

    /// @notice Escape hatch: stop an auction early. Every bidder is refunded in
    ///         full through {claim}; no coins are sold.
    function cancel(address token) external onlyFactory {
        Auction storage a = _auctions[token];
        if (a.token == address(0)) revert NotOpen();
        if (a.finalized) revert AlreadyFinalized();
        if (a.collected > 0) revert AlreadyFinalized(); // fills already stand
        a.cancelled = true;
        emit Cancelled(token);
    }

    // ------------------------------------------------------------------
    // Bidders
    // ------------------------------------------------------------------

    /// @notice Place a bid: `msg.value` is the budget, `maxPriceQ96` the most you
    ///         will pay per coin (a grid price). `prevTickHint` is the highest
    ///         existing tick price at or below your max price (0 to scan).
    function bid(address token, uint256 maxPriceQ96, uint256 prevTickHint) external payable nonReentrant returns (uint256 bidId) {
        Auction storage a = _auctions[token];
        if (a.token == address(0)) revert NotOpen();
        if (block.number >= a.endBlock || a.cancelled) revert AuctionOver();
        if (msg.value == 0) revert ZeroAmount();
        if (maxPriceQ96 < a.floorPriceQ96 || maxPriceQ96 % a.tickSpacingQ96 != 0) revert NotOnGrid();
        _sync(a, token);
        if (maxPriceQ96 < a.clearingQ96) revert BelowClearing();

        uint256 blocksLeft = a.endBlock - block.number;
        uint256 rate = msg.value / blocksLeft;
        if (rate == 0) revert ZeroAmount();

        _insertTick(token, a, maxPriceQ96, rate, prevTickHint);
        a.activeRate += rate;
        _reprice(a, token);
        if (maxPriceQ96 < a.clearingQ96) revert BelowClearing(); // would be outbid on arrival

        bidId = _bids[token].length;
        _bids[token].push(Bid({owner: msg.sender, budget: msg.value, rate: rate, maxPriceQ96: maxPriceQ96, startBlock: uint64(block.number), startCp: uint32(_cps[token].length - 1), exited: false}));
        emit BidPlaced(token, bidId, msg.sender, maxPriceQ96, msg.value, rate);
    }

    /// @notice After finalize: pay out a bid's coins and refund its unspent
    ///         budget to the bid owner. `cpHint` is the index of the last
    ///         checkpoint whose price is <= the bid's max price (the bid's
    ///         last filled stretch); {exitHint} computes it.
    function claim(address token, uint256 bidId, uint32 cpHint) external nonReentrant returns (uint256 coins, uint256 refund) {
        Auction storage a = _auctions[token];
        if (!a.finalized) revert NotFinalized();
        Bid storage b = _bids[token][bidId];
        if (b.exited) revert AlreadyExited();
        b.exited = true;
        if (a.graduated) {
            (coins, refund) = _fill(a, token, b, cpHint);
            // per-bid fills and the aggregate `sold` round independently; never
            // let a wei of rounding strand the last claimer.
            uint256 have = IERC20(token).balanceOf(address(this));
            if (coins > have) coins = have;
        } else {
            refund = b.budget;
        }
        if (coins > 0) IERC20(token).safeTransfer(b.owner, coins);
        if (refund > 0) {
            (bool ok,) = b.owner.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
        emit Claimed(token, bidId, b.owner, coins, refund);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function auction(address token) external view returns (Auction memory) {
        return _auctions[token];
    }

    function bids(address token, uint256 bidId) external view returns (Bid memory) {
        return _bids[token][bidId];
    }

    function bidCount(address token) external view returns (uint256) {
        return _bids[token].length;
    }

    function checkpoint(address token, uint256 i) external view returns (Checkpoint memory) {
        return _cps[token][i];
    }

    function checkpointCount(address token) external view returns (uint256) {
        return _cps[token].length;
    }

    function tick(address token, uint256 price) external view returns (Tick memory) {
        return _ticks[token][price];
    }

    /// @notice Live state as of now: clearing price, HYPE raised, coins sold.
    function live(address token) external view returns (uint256 clearingQ96, uint256 raised, uint256 sold, uint256 activeRate, uint64 blocksLeft) {
        Auction storage a = _auctions[token];
        uint64 now_ = uint64(block.number) > a.endBlock ? a.endBlock : uint64(block.number);
        uint256 dt = now_ > a.lastBlock ? now_ - a.lastBlock : 0;
        clearingQ96 = a.clearingQ96;
        raised = a.raised + a.activeRate * dt;
        sold = a.sold + (a.activeRate * dt * Q96) / (a.clearingQ96 == 0 ? 1 : a.clearingQ96);
        activeRate = a.activeRate;
        blocksLeft = a.endBlock > uint64(block.number) ? a.endBlock - uint64(block.number) : 0;
    }

    /// @notice The claim hint for a bid: index of the last checkpoint with a
    ///         price at or below the bid's max price, at or after its start.
    function exitHint(address token, uint256 bidId) external view returns (uint32) {
        Bid storage b = _bids[token][bidId];
        Checkpoint[] storage cps = _cps[token];
        uint256 i = b.startCp;
        while (i + 1 < cps.length && cps[i + 1].priceQ96 <= b.maxPriceQ96) i++;
        return uint32(i);
    }

    /// @notice Preview a bid's coins and refund with the current hint (exact once finalized).
    function preview(address token, uint256 bidId) external view returns (uint256 coins, uint256 spent, uint256 refund) {
        Auction storage a = _auctions[token];
        Bid storage b = _bids[token][bidId];
        Checkpoint[] storage cps = _cps[token];
        uint256 i = b.startCp;
        while (i + 1 < cps.length && cps[i + 1].priceQ96 <= b.maxPriceQ96) i++;
        uint64 stop = i + 1 < cps.length ? cps[i + 1].blk : (uint64(block.number) > a.endBlock ? a.endBlock : uint64(block.number));
        if (stop > b.startBlock) {
            uint256 inv = _cumInvAt(a, cps, i, stop) - _cumInvAt(a, cps, b.startCp, b.startBlock);
            coins = Math.mulDiv(b.rate, inv, Q96);
            spent = b.rate * (stop - b.startBlock);
        }
        refund = b.budget - spent;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Advance the accumulators from lastBlock to now (capped at the end).
    function _sync(Auction storage a, address token) internal {
        uint64 now_ = uint64(block.number) > a.endBlock ? a.endBlock : uint64(block.number);
        if (now_ <= a.lastBlock) return;
        uint256 dt = now_ - a.lastBlock;
        a.cumInv192 += dt * (Q192 / a.clearingQ96);
        a.raised += a.activeRate * dt;
        a.sold += (a.activeRate * dt * Q96) / a.clearingQ96;
        a.lastBlock = now_;
        token; // silence
    }

    /// @dev Raise the clearing price until the block's supply covers active demand:
    ///      activeRate * 2^96 <= perBlock * price. Ticks left below are outbid.
    function _reprice(Auction storage a, address token) internal {
        uint256 old = a.clearingQ96;
        uint256 price = old;
        while (a.activeRate * Q96 > a.perBlock * price) {
            // lowest price that would cover current demand, on the grid
            uint256 needed = Math.mulDiv(a.activeRate, Q96, a.perBlock);
            needed = ((needed + a.tickSpacingQ96 - 1) / a.tickSpacingQ96) * a.tickSpacingQ96;
            uint256 h = a.head;
            if (h == 0 || needed <= h) {
                price = needed > price ? needed : price;
                break;
            }
            // every bid at the lowest tick is outbid once price passes it
            Tick storage t = _ticks[token][h];
            a.activeRate -= t.rate;
            a.head = t.next;
            price = h + a.tickSpacingQ96;
        }
        if (price != old) {
            a.clearingQ96 = price;
            _cps[token].push(Checkpoint({blk: uint64(block.number), priceQ96: price, cumInv192: a.cumInv192, raised: a.raised, sold: a.sold}));
            emit ClearingPrice(token, uint64(block.number), price);
        }
    }

    /// @dev Add `rate` at `price` in the ascending tick list.
    function _insertTick(address token, Auction storage a, uint256 price, uint256 rate, uint256 hint) internal {
        Tick storage t = _ticks[token][price];
        if (t.exists) {
            t.rate += rate;
            return;
        }
        t.exists = true;
        t.rate = rate;
        if (a.head == 0 || price < a.head) {
            t.next = a.head;
            a.head = price;
            return;
        }
        uint256 prev = hint;
        if (prev == 0 || prev > price || !_ticks[token][prev].exists || prev < a.head) prev = a.head;
        // walk forward to the last tick below `price`
        while (_ticks[token][prev].next != 0 && _ticks[token][prev].next < price) prev = _ticks[token][prev].next;
        if (prev > price) revert BadHint();
        t.next = _ticks[token][prev].next;
        _ticks[token][prev].next = price;
    }

    /// @dev cumInv192 at the start of `blk`, given the checkpoint `i` in force there.
    function _cumInvAt(Auction storage a, Checkpoint[] storage cps, uint256 i, uint64 blk) internal view returns (uint256) {
        Checkpoint storage c = cps[i];
        uint64 upto = blk > a.endBlock ? a.endBlock : blk;
        if (upto <= c.blk) return c.cumInv192;
        return c.cumInv192 + uint256(upto - c.blk) * (Q192 / c.priceQ96);
    }

    /// @dev Coins filled and refund for a bid, from its start to the block it was outbid (or the end).
    function _fill(Auction storage a, address token, Bid storage b, uint32 hint) internal view returns (uint256 coins, uint256 refund) {
        Checkpoint[] storage cps = _cps[token];
        if (hint < b.startCp || hint >= cps.length) revert BadHint();
        if (cps[hint].priceQ96 > b.maxPriceQ96) revert BadHint();
        if (hint + 1 < cps.length && cps[hint + 1].priceQ96 <= b.maxPriceQ96) revert BadHint();
        uint64 stop = hint + 1 < cps.length ? cps[hint + 1].blk : a.endBlock;
        uint256 spent;
        if (stop > b.startBlock) {
            uint256 inv = _cumInvAt(a, cps, hint, stop) - _cumInvAt(a, cps, b.startCp, b.startBlock);
            coins = Math.mulDiv(b.rate, inv, Q96);
            spent = b.rate * (stop - b.startBlock);
        }
        refund = b.budget - spent;
    }

    receive() external payable {
        revert();
    }
}
