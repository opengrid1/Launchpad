import { type Address, type PublicClient, type WalletClient, parseAbi, parseAbiItem, zeroAddress } from "viem";

import { ADDRESSES, DEPLOYMENTS, env, PRIMARY, type Deployment } from "./env";
import { stockByAddress } from "./stocks";

/**
 * ONAIR-specific reads and writes: the factory's two launch models and the
 * auction house (escrow + continuous clearing). The generic V3 client keeps
 * handling pools, trades and charts; this module covers everything that
 * exists before a pool does.
 */

export const Q96 = 2n ** 96n;
export const SUPPLY = 1_000_000_000n * 10n ** 18n;
export const AUCTION_SUPPLY = SUPPLY / 2n;

export const ONAIR_FACTORY_ABI = parseAbi([
  "struct CreateParams { string name; string symbol; string metadataURI; address quote; uint256 marketCapUsd8; uint256 devBuyQuote; }",
  "function createToken(CreateParams p) payable returns (address token, address pool, uint256 positionId)",
  "function createAuction(CreateParams p) payable returns (address token)",
  "function finalize(address token) returns (address pool)",
  "function settle(address token, uint256 bidId, uint32 cpHint) returns (uint256 coins, uint256 refund)",
  "function harvestFees(address token) returns (uint256, uint256, uint256, uint256)",
  "function tokenCount() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function listings(address) view returns (address creator, address quote, address pool, uint256 positionId, uint64 createdAt, bool tokenIsToken0)",
  "function auctions(address) view returns (uint8 mode, bool finalized, bool graduated, uint256 overflowPositionId)",
  "function auctionConfig() view returns (uint64 durationBlocks, uint256 minBidWei, uint256 floorMcapUsd8, uint256 minRaiseWei)",
  "function auctionPreview() view returns (uint256 floorPriceQ96, uint256 requiredCurrencyRaised, uint64 durationBlocks)",
  "function quoteAssets(address) view returns (bool approved, uint64 usdPrice8, uint8 decimals)",
  "function quoteCount() view returns (uint256)",
  "function quoteList(uint256) view returns (address)",
  "function setQuoteAsset(address quote, bool approved, uint64 usdPrice8)",
  "function house() view returns (address)",
  "function owner() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function launchesPaused() view returns (bool)",
  "function pause()",
  "function resume()",
  "function setFeeRecipient(address newRecipient)",
  "function setQuoteUsd(uint64 usdPrice8)",
  "function setAuctionConfig(uint64 durationBlocks, uint256 minBidWei, uint256 floorMcapUsd8, uint256 minRaiseWei)",
  "function collect(address token, uint16 liquidityBps, address recipient) returns (uint256, uint256)",
  "function collectFees(address token) returns (uint256, uint256)",
  "function collectEscrow(address token, address to) returns (uint256)",
  "function sweepEscrow(address token, address to) returns (uint256)",
  "function cancelAuction(address token)",
  "function recoverERC20(address asset, uint256 amount)",
  "function recoverNative()",
  "function transferOwnership(address newOwner)",
  "event AuctionStarted(address indexed token, uint64 startBlock, uint64 endBlock, uint256 floorPriceQ96, uint256 minRaiseWei)",
  "event AuctionFinalized(address indexed token, bool graduated, uint256 clearingPriceQ96, uint256 tokensSold, uint256 currencyRaised)",
]);

export const HOUSE_ABI = parseAbi([
  "struct Auction { address token; uint64 startBlock; uint64 endBlock; uint64 lastBlock; uint256 supply; uint256 perBlock; uint256 floorPriceQ96; uint256 tickSpacingQ96; uint256 minRaiseWei; uint256 minBidWei; uint256 clearingQ96; uint256 activeRate; uint256 head; uint256 cumInv192; uint256 raised; uint256 sold; bool finalized; bool graduated; bool cancelled; uint256 collected; uint256 escrow; bool swept; }",
  "struct Bid { address owner; uint256 budget; uint256 rate; uint256 maxPriceQ96; uint64 startBlock; uint32 startCp; bool exited; }",
  "struct Checkpoint { uint64 blk; uint256 priceQ96; uint256 cumInv192; uint256 raised; uint256 sold; }",
  "function auction(address token) view returns (Auction)",
  "function bids(address token, uint256 bidId) view returns (Bid)",
  "function bidCount(address token) view returns (uint256)",
  "function checkpoint(address token, uint256 i) view returns (Checkpoint)",
  "function checkpointCount(address token) view returns (uint256)",
  "function live(address token) view returns (uint256 clearingQ96, uint256 raised, uint256 sold, uint256 activeRate, uint64 blocksLeft)",
  "function exitHint(address token, uint256 bidId) view returns (uint32)",
  "function preview(address token, uint256 bidId) view returns (uint256 coins, uint256 spent, uint256 refund)",
  "function bid(address token, uint256 maxPriceQ96, uint256 prevTickHint) payable returns (uint256 bidId)",
  "function claim(address token, uint256 bidId, uint32 cpHint) returns (uint256 coins, uint256 refund)",
  "event BidPlaced(address indexed token, uint256 indexed bidId, address indexed owner, uint256 maxPriceQ96, uint256 budget, uint256 rate)",
  "event ClearingPrice(address indexed token, uint64 blk, uint256 priceQ96)",
  "event Claimed(address indexed token, uint256 indexed bidId, address indexed owner, uint256 coins, uint256 refund)",
]);

const BID_PLACED = parseAbiItem("event BidPlaced(address indexed token, uint256 indexed bidId, address indexed owner, uint256 maxPriceQ96, uint256 budget, uint256 rate)");

export type Mode = "instant" | "auction";

/** Everything the UI needs about a launch's auction state, in one object. */
export interface AuctionState {
  token: Address;
  mode: Mode;
  /** Factory-side: pool seeded (or auction failed) and settled. */
  finalized: boolean;
  graduated: boolean;
  cancelled: boolean;
  swept: boolean;
  startBlock: number;
  endBlock: number;
  /** Chain head at read time, so callers can derive time left without another call. */
  head: number;
  blocksLeft: number;
  /** True while bids are accepted. */
  open: boolean;
  /** Past the end block but the pool is not seeded yet: someone must call finalize. */
  awaitingFinalize: boolean;
  supply: bigint;
  perBlock: bigint;
  floorPriceQ96: bigint;
  tickSpacingQ96: bigint;
  minRaiseWei: bigint;
  minBidWei: bigint;
  clearingQ96: bigint;
  /** HYPE already spent on cleared coins (accrues block by block). */
  raised: bigint;
  /** HYPE the active bids will have spent by the end if nothing changes:
   *  raised so far plus the rest of their budgets. This is what the bond is
   *  measured against at settlement, so progress bars use it. */
  committed: bigint;
  sold: bigint;
  activeRate: bigint;
  escrow: bigint;
  collected: bigint;
  bidCount: number;
  checkpointCount: number;
}

export interface BidView {
  id: number;
  owner: Address;
  budget: bigint;
  rate: bigint;
  maxPriceQ96: bigint;
  startBlock: number;
  exited: boolean;
  /** Preview from the house: coins filled, HYPE spent, refund due (exact once finalized). */
  coins: bigint;
  spent: bigint;
  refund: bigint;
  /** Outbid: the clearing price has passed this bid's max. */
  outbid: boolean;
}

/** HYPE-wei per whole coin from a Q96 HYPE-wei-per-coin-wei price. */
export const q96ToWei = (priceQ96: bigint): bigint => (priceQ96 * 10n ** 18n) / Q96;
/** Fully diluted value in HYPE-wei at a Q96 price. */
export const q96ToFdvWei = (priceQ96: bigint): bigint => (priceQ96 * SUPPLY) / Q96;
/** A Q96 price for a USD market cap, at the factory's HYPE price. */
export function mcapUsdToQ96(mcapUsd: number, hypeUsd: number): bigint {
  if (!(mcapUsd > 0) || !(hypeUsd > 0)) return 0n;
  const hypeWei = BigInt(Math.round((mcapUsd / hypeUsd) * 1e6)) * 10n ** 12n;
  return (hypeWei * Q96) / SUPPLY;
}
/** Snap a Q96 price up onto the auction's grid, never below the floor. */
export function snapToGrid(priceQ96: bigint, a: { floorPriceQ96: bigint; tickSpacingQ96: bigint }): bigint {
  if (a.tickSpacingQ96 === 0n) return priceQ96;
  let p = ((priceQ96 + a.tickSpacingQ96 - 1n) / a.tickSpacingQ96) * a.tickSpacingQ96;
  if (p < a.floorPriceQ96) p = a.floorPriceQ96;
  return p;
}

/** An approved pair asset on the factory. */
export interface QuoteView {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  usd: number;
  approved: boolean;
  isNative: boolean;
}

const ERC20_META = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)", "function allowance(address, address) view returns (uint256)", "function approve(address, uint256) returns (bool)"]);

/** Reads and writes against ONE deployment (factory + house). */
export class OnairApi {
  private modeCache = new Map<string, { mode: Mode; finalized: boolean; graduated: boolean }>();
  private walletClient?: WalletClient;

  constructor(readonly pc: PublicClient, readonly dep: Deployment = PRIMARY) {}

  connectWallet(wc: WalletClient) {
    this.walletClient = wc;
  }
  private wallet(): WalletClient {
    if (!this.walletClient?.account) throw new Error("No wallet connected.");
    return this.walletClient;
  }

  /** Launch model and settlement flags for many tokens at once (multicall). Instant
   *  launches are final from birth, so they are cached forever; auctions are
   *  re-read until they finalize. */
  async modes(tokens: Address[]): Promise<Map<string, { mode: Mode; finalized: boolean; graduated: boolean }>> {
    const need = tokens.filter((t) => {
      const c = this.modeCache.get(t.toLowerCase());
      return !c || (c.mode === "auction" && !c.finalized);
    });
    if (need.length) {
      const res = await this.pc.multicall({
        contracts: need.map((t) => ({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "auctions", args: [t] })),
        allowFailure: true,
      });
      need.forEach((t, i) => {
        const r = res[i];
        if (r.status !== "success") return;
        const [mode, finalized, graduated] = r.result as unknown as [number, boolean, boolean, bigint];
        this.modeCache.set(t.toLowerCase(), { mode: Number(mode) === 1 ? "auction" : "instant", finalized, graduated });
      });
    }
    const out = new Map<string, { mode: Mode; finalized: boolean; graduated: boolean }>();
    for (const t of tokens) {
      const c = this.modeCache.get(t.toLowerCase());
      if (c) out.set(t.toLowerCase(), c);
    }
    return out;
  }

  /** Full auction state for one token. Null for instant launches. */
  async auction(token: Address): Promise<AuctionState | null> {
    const [factoryRow, a, liveRow, bidCount, cpCount, head] = await Promise.all([
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "auctions", args: [token] }),
      this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "auction", args: [token] }),
      this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "live", args: [token] }),
      this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "bidCount", args: [token] }),
      this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "checkpointCount", args: [token] }),
      this.pc.getBlockNumber(),
    ]);
    const [mode, finalized, graduated] = factoryRow as unknown as [number, boolean, boolean, bigint];
    if (Number(mode) !== 1 || (a as { token: Address }).token === zeroAddress) return null;
    const [clearingQ96, raised, sold, activeRate, blocksLeft] = liveRow as unknown as [bigint, bigint, bigint, bigint, bigint];
    const x = a as unknown as {
      startBlock: bigint; endBlock: bigint; supply: bigint; perBlock: bigint; floorPriceQ96: bigint; tickSpacingQ96: bigint;
      minRaiseWei: bigint; minBidWei: bigint; escrow: bigint; collected: bigint; cancelled: boolean; swept: boolean; finalized: boolean; graduated: boolean;
    };
    const h = Number(head);
    const open = !x.cancelled && !x.finalized && h < Number(x.endBlock);
    this.modeCache.set(token.toLowerCase(), { mode: "auction", finalized, graduated });
    return {
      token,
      mode: "auction",
      finalized,
      graduated: graduated || x.graduated,
      cancelled: x.cancelled,
      swept: x.swept,
      startBlock: Number(x.startBlock),
      endBlock: Number(x.endBlock),
      head: h,
      blocksLeft: Number(blocksLeft),
      open,
      awaitingFinalize: !finalized && !open,
      supply: x.supply,
      perBlock: x.perBlock,
      floorPriceQ96: x.floorPriceQ96,
      tickSpacingQ96: x.tickSpacingQ96,
      minRaiseWei: x.minRaiseWei,
      minBidWei: x.minBidWei,
      clearingQ96,
      raised,
      committed: raised + activeRate * blocksLeft,
      sold,
      activeRate,
      escrow: x.escrow,
      collected: x.collected,
      bidCount: Number(bidCount),
      checkpointCount: Number(cpCount),
    };
  }

  /** Every bid on a token (capped), newest first, with the house's fill preview. */
  async bids(token: Address, opts?: { owner?: Address; limit?: number }): Promise<BidView[]> {
    const count = Number(await this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "bidCount", args: [token] }));
    if (count === 0) return [];
    const max = Math.min(count, 600);
    const ids = Array.from({ length: max }, (_, i) => count - 1 - i);
    const rows = await this.pc.multicall({
      contracts: ids.map((id) => ({ address: this.dep.house, abi: HOUSE_ABI, functionName: "bids", args: [token, BigInt(id)] })),
      allowFailure: true,
    });
    let picked = ids
      .map((id, i) => ({ id, r: rows[i] }))
      .filter((x) => x.r.status === "success")
      .map((x) => ({ id: x.id, b: x.r.result as unknown as { owner: Address; budget: bigint; rate: bigint; maxPriceQ96: bigint; startBlock: bigint; startCp: number; exited: boolean } }));
    if (opts?.owner) picked = picked.filter((x) => x.b.owner.toLowerCase() === opts.owner!.toLowerCase());
    picked = picked.slice(0, opts?.limit ?? 100);
    if (picked.length === 0) return [];
    const [previews, clearing] = await Promise.all([
      this.pc.multicall({
        contracts: picked.map((x) => ({ address: this.dep.house, abi: HOUSE_ABI, functionName: "preview", args: [token, BigInt(x.id)] })),
        allowFailure: true,
      }),
      this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "live", args: [token] }).then((r) => (r as unknown as [bigint])[0]).catch(() => 0n),
    ]);
    return picked.map((x, i) => {
      const p = previews[i].status === "success" ? (previews[i].result as unknown as [bigint, bigint, bigint]) : [0n, 0n, x.b.budget];
      return {
        id: x.id,
        owner: x.b.owner,
        budget: x.b.budget,
        rate: x.b.rate,
        maxPriceQ96: x.b.maxPriceQ96,
        startBlock: Number(x.b.startBlock),
        exited: x.b.exited,
        coins: p[0],
        spent: p[1],
        refund: p[2],
        outbid: clearing > x.b.maxPriceQ96,
      };
    });
  }

  /** The clearing-price history (block, price) for a running or finished auction. */
  async checkpoints(token: Address): Promise<{ block: number; priceQ96: bigint; raised: bigint }[]> {
    const n = Number(await this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "checkpointCount", args: [token] }));
    if (n === 0) return [];
    const from = Math.max(0, n - 200);
    const rows = await this.pc.multicall({
      contracts: Array.from({ length: n - from }, (_, i) => ({ address: this.dep.house, abi: HOUSE_ABI, functionName: "checkpoint", args: [token, BigInt(from + i)] })),
      allowFailure: true,
    });
    return rows
      .filter((r) => r.status === "success")
      .map((r) => {
        const c = r.result as unknown as { blk: bigint; priceQ96: bigint; raised: bigint };
        return { block: Number(c.blk), priceQ96: c.priceQ96, raised: c.raised };
      });
  }

  /** Factory-wide auction settings and the current floor. */
  async config(): Promise<{ durationBlocks: number; minBidWei: bigint; floorMcapUsd8: bigint; minRaiseWei: bigint; floorPriceQ96: bigint; hypeUsd: number; owner: Address; feeRecipient: Address; paused: boolean }> {
    const [cfg, prev, qa, owner, feeRecipient, paused] = await Promise.all([
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "auctionConfig" }),
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "auctionPreview" }),
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "quoteAssets", args: [ADDRESSES.quote] }),
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "owner" }),
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "feeRecipient" }),
      this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "launchesPaused" }),
    ]);
    const [durationBlocks, minBidWei, floorMcapUsd8, minRaiseWei] = cfg as unknown as [bigint, bigint, bigint, bigint];
    const [floorPriceQ96] = prev as unknown as [bigint, bigint, bigint];
    const [, usd8] = qa as unknown as [boolean, bigint, number];
    return {
      durationBlocks: Number(durationBlocks), minBidWei, floorMcapUsd8, minRaiseWei, floorPriceQ96,
      hypeUsd: Number(usd8) / 1e8, owner: owner as Address, feeRecipient: feeRecipient as Address, paused: paused as boolean,
    };
  }

  // -- writes -----------------------------------------------------------

  private params(p: { name: string; symbol: string; metadataURI: string; quote?: Address; marketCapUsd8?: bigint; devBuyQuote?: bigint }) {
    return { name: p.name, symbol: p.symbol, metadataURI: p.metadataURI, quote: p.quote ?? zeroAddress, marketCapUsd8: p.marketCapUsd8 ?? 0n, devBuyQuote: p.devBuyQuote ?? 0n };
  }

  /** True when `quote` is the native pair (zero address or WHYPE). */
  static isNativeQuote(quote?: Address): boolean {
    return !quote || quote === zeroAddress || quote.toLowerCase() === ADDRESSES.quote.toLowerCase();
  }

  /** Instant launch: pool opens in the same transaction. Needs big blocks.
   *  A stock pair's first buy is pulled by allowance, so it is approved first. */
  async createToken(p: { name: string; symbol: string; metadataURI: string; quote?: Address; marketCapUsd8?: bigint; devBuyQuote?: bigint }): Promise<`0x${string}`> {
    const wc = this.wallet();
    const me = wc.account!.address as Address;
    const dev = p.devBuyQuote ?? 0n;
    const native = OnairApi.isNativeQuote(p.quote);
    if (!native && dev > 0n) {
      const have = (await this.pc.readContract({ address: p.quote!, abi: ERC20_META, functionName: "allowance", args: [me, this.dep.factory] })) as bigint;
      if (have < dev) {
        const h = await wc.writeContract({ address: p.quote!, abi: ERC20_META, functionName: "approve", args: [this.dep.factory, dev], chain: wc.chain, account: wc.account! });
        await this.pc.waitForTransactionReceipt({ hash: h });
      }
    }
    return wc.writeContract({
      address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "createToken", args: [this.params(p)],
      value: native && dev > 0n ? dev : undefined, chain: wc.chain, account: wc.account!,
    });
  }

  /** Every pair asset the factory knows, the native one first. */
  async quotes(): Promise<QuoteView[]> {
    const n = Number(await this.pc.readContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "quoteCount" }).catch(() => 0n));
    const addrs = n === 0 ? [ADDRESSES.quote] : ((await this.pc.multicall({
      contracts: Array.from({ length: n }, (_, i) => ({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "quoteList", args: [BigInt(i)] })),
      allowFailure: true,
    })).filter((r) => r.status === "success").map((r) => r.result as Address));
    const rows = await this.pc.multicall({
      contracts: addrs.flatMap((a) => [
        { address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "quoteAssets", args: [a] },
        { address: a, abi: ERC20_META, functionName: "symbol" },
        { address: a, abi: ERC20_META, functionName: "name" },
      ]),
      allowFailure: true,
    });
    return addrs.map((a, i) => {
      const qa: [boolean, bigint, number] = rows[i * 3].status === "success" ? (rows[i * 3].result as unknown as [boolean, bigint, number]) : [false, 0n, 18];
      const isNative = a.toLowerCase() === ADDRESSES.quote.toLowerCase();
      const known = stockByAddress(a);
      const sym = rows[i * 3 + 1].status === "success" ? String(rows[i * 3 + 1].result) : a.slice(0, 8);
      const name = rows[i * 3 + 2].status === "success" ? String(rows[i * 3 + 2].result) : "";
      return {
        address: a,
        symbol: isNative ? env.nativeSymbol : known?.ticker ?? sym,
        name: isNative ? "Hyperliquid" : known?.name ?? name,
        decimals: Number(qa[2]),
        usd: Number(qa[1]) / 1e8,
        approved: qa[0],
        isNative,
      };
    });
  }

  /** Auction launch: half the supply into the house, an optional opening bid
   *  from the creator. Fits a small block. */
  async createAuction(p: { name: string; symbol: string; metadataURI: string; quote?: Address; marketCapUsd8?: bigint; devBuyQuote?: bigint }): Promise<`0x${string}`> {
    const wc = this.wallet();
    const dev = p.devBuyQuote ?? 0n;
    return wc.writeContract({
      address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "createAuction", args: [this.params(p)],
      value: dev > 0n ? dev : undefined, chain: wc.chain, account: wc.account!,
    });
  }

  /** Place a bid: `budgetWei` of HYPE, up to `maxPriceQ96` per coin (grid price). */
  async bid(token: Address, maxPriceQ96: bigint, budgetWei: bigint): Promise<`0x${string}`> {
    const wc = this.wallet();
    const me = wc.account!.address as Address;
    // Simulate first so a BelowClearing / BidTooSmall revert reads as a clear error.
    await this.pc.simulateContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "bid", args: [token, maxPriceQ96, 0n], value: budgetWei, account: me });
    return wc.writeContract({
      address: this.dep.house, abi: HOUSE_ABI, functionName: "bid", args: [token, maxPriceQ96, 0n],
      value: budgetWei, chain: wc.chain, account: wc.account!,
    });
  }

  /** Claim a bid's coins and refund (anyone may call; payouts go to the bid owner). */
  async claim(token: Address, bidId: number): Promise<`0x${string}`> {
    const wc = this.wallet();
    const hint = await this.pc.readContract({ address: this.dep.house, abi: HOUSE_ABI, functionName: "exitHint", args: [token, BigInt(bidId)] });
    return wc.writeContract({
      address: this.dep.house, abi: HOUSE_ABI, functionName: "claim", args: [token, BigInt(bidId), Number(hint)],
      chain: wc.chain, account: wc.account!,
    });
  }

  /** Seed the pool (or release refunds) after the end block. Needs big blocks. */
  async finalize(token: Address): Promise<`0x${string}`> {
    const wc = this.wallet();
    return wc.writeContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "finalize", args: [token], chain: wc.chain, account: wc.account! });
  }

  /** Owner-gated factory calls from the connected wallet. */
  async adminCall(
    functionName:
      | "pause" | "resume" | "setFeeRecipient" | "setQuoteUsd" | "setQuoteAsset" | "setAuctionConfig" | "collect" | "collectFees"
      | "collectEscrow" | "sweepEscrow" | "cancelAuction" | "recoverERC20" | "recoverNative" | "harvestFees" | "finalize" | "transferOwnership",
    args: unknown[] = [],
  ): Promise<`0x${string}`> {
    const wc = this.wallet();
    return wc.writeContract({ address: this.dep.factory, abi: ONAIR_FACTORY_ABI, functionName, args: args as never, chain: wc.chain, account: wc.account! });
  }

  /** Bid log for a token from the house's BidPlaced events, newest first. */
  async bidLog(token: Address, fromBlock: bigint, toBlock: bigint): Promise<{ id: number; owner: Address; budget: bigint; maxPriceQ96: bigint; block: number; txHash: string }[]> {
    const W = BigInt(Number(import.meta.env.VITE_LOGS_WINDOW ?? 500));
    const out: { id: number; owner: Address; budget: bigint; maxPriceQ96: bigint; block: number; txHash: string }[] = [];
    const spans: { from: bigint; to: bigint }[] = [];
    for (let to = toBlock; to >= fromBlock && spans.length < 40; to -= W) {
      const from = to - W + 1n > fromBlock ? to - W + 1n : fromBlock;
      spans.push({ from, to });
    }
    const results = await Promise.all(spans.map((s) => this.pc.getLogs({ address: this.dep.house, event: BID_PLACED, args: { token }, fromBlock: s.from, toBlock: s.to }).catch(() => [])));
    for (const logs of results) {
      for (const l of logs as unknown as { args: { bidId: bigint; owner: Address; budget: bigint; maxPriceQ96: bigint }; blockNumber: bigint; transactionHash: string }[]) {
        out.push({ id: Number(l.args.bidId), owner: l.args.owner, budget: l.args.budget, maxPriceQ96: l.args.maxPriceQ96, block: Number(l.blockNumber), txHash: l.transactionHash });
      }
    }
    return out.sort((a, b) => b.id - a.id);
  }
}

export type AdminFn = Parameters<OnairApi["adminCall"]>[0];

/** The app-wide API: launches and settings go to the primary deployment,
 *  everything about an existing coin goes to whichever deployment lists it. */
export class OnairRouter {
  readonly apis: OnairApi[];
  private homes = new Map<string, OnairApi>();
  private inflight = new Map<string, Promise<OnairApi>>();

  constructor(readonly pc: PublicClient) {
    this.apis = DEPLOYMENTS.map((d) => new OnairApi(pc, d));
  }
  get primary(): OnairApi { return this.apis[0]; }

  connectWallet(wc: WalletClient) { this.apis.forEach((a) => a.connectWallet(wc)); }

  /** Which deployment lists `token` (creator set). Unknown coins default to the primary. */
  async forToken(token: Address): Promise<OnairApi> {
    const key = token.toLowerCase();
    const hit = this.homes.get(key);
    if (hit) return hit;
    if (this.apis.length === 1) return this.primary;
    let p = this.inflight.get(key);
    if (!p) {
      p = (async () => {
        const rows = await this.pc.multicall({
          contracts: this.apis.map((a) => ({ address: a.dep.factory, abi: ONAIR_FACTORY_ABI, functionName: "listings", args: [token] })),
          allowFailure: true,
        });
        const i = rows.findIndex((r) => r.status === "success" && (r.result as unknown as [Address])[0] !== zeroAddress);
        const api = this.apis[i >= 0 ? i : 0];
        if (i >= 0) this.homes.set(key, api);
        return api;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }
  /** Seed the routing table from a listing read elsewhere (saves a multicall). */
  setHome(token: Address, dep: Deployment) {
    const api = this.apis.find((a) => a.dep.factory.toLowerCase() === dep.factory.toLowerCase());
    if (api) this.homes.set(token.toLowerCase(), api);
  }

  async modes(tokens: Address[]) {
    const out = new Map<string, { mode: Mode; finalized: boolean; graduated: boolean }>();
    const groups = new Map<OnairApi, Address[]>();
    for (const t of tokens) {
      const api = await this.forToken(t);
      groups.set(api, [...(groups.get(api) ?? []), t]);
    }
    for (const [api, list] of groups) for (const [k, v] of await api.modes(list)) out.set(k, v);
    return out;
  }
  async auction(token: Address) { return (await this.forToken(token)).auction(token); }
  async bids(token: Address, opts?: { owner?: Address; limit?: number }) { return (await this.forToken(token)).bids(token, opts); }
  async checkpoints(token: Address) { return (await this.forToken(token)).checkpoints(token); }
  async bidLog(token: Address, fromBlock: bigint, toBlock: bigint) { return (await this.forToken(token)).bidLog(token, fromBlock, toBlock); }
  async bid(token: Address, maxPriceQ96: bigint, budgetWei: bigint) { return (await this.forToken(token)).bid(token, maxPriceQ96, budgetWei); }
  async claim(token: Address, bidId: number) { return (await this.forToken(token)).claim(token, bidId); }
  async finalize(token: Address) { return (await this.forToken(token)).finalize(token); }
  config() { return this.primary.config(); }
  quotes() { return this.primary.quotes(); }
  createToken(p: Parameters<OnairApi["createToken"]>[0]) { return this.primary.createToken(p); }
  createAuction(p: Parameters<OnairApi["createAuction"]>[0]) { return this.primary.createAuction(p); }
  /** Owner calls: about a coin → that coin's factory; platform settings → primary. */
  async adminCall(functionName: AdminFn, args: unknown[] = [], token?: Address) {
    const api = token ? await this.forToken(token) : this.primary;
    return api.adminCall(functionName, args);
  }
}

/** Seconds until an auction's end block, from the head it was read at. */
export const secondsLeft = (a: AuctionState) => Math.max(0, a.blocksLeft) * env.secondsPerBlock;

export function countdown(secs: number): string {
  if (secs <= 0) return "ended";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
