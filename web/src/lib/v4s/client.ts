import { type Address, concatHex, encodeAbiParameters, getContractAddress, keccak256 } from "viem";

import { type Core, V4Client } from "../v4/client";
import { factoryAbi, tokenAbi } from "../v4/abis";
import { QUIVER_TOKEN_M_BYTECODE } from "./tokenBytecode";
import { STOCKS_S, stockSOf } from "./stocks";

const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

const routerSAbi = [
  { type: "function", name: "buyWithEth", stateMutability: "payable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sellForEth", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "buyWithStock", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sellForStock", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const factorySLaunchAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "symbol", type: "string" },
          { name: "metadataURI", type: "string" },
          { name: "pairStock", type: "address" },
          { name: "taxBps", type: "uint16" },
          { name: "rewardStocks", type: "address[]" },
        ],
      },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "poolId", type: "bytes32" },
    ],
  },
  { type: "function", name: "rewardStocksOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address[]" }] },
] as const;

/**
 * Client for the v4s STOCK-PAIRED launchpad. Pools quote in a tokenized stock
 * instead of WETH, so every "native" figure the base client computes is in
 * pair-stock units; `quoteUsd` converts with the stock's live USD price. The
 * ETH-path router entrances keep the existing trade UI working unchanged.
 */
export class V4SClient extends V4Client {
  /** pair-stock USD prices, refreshed opportunistically for sync use. */
  private quoteUsdCache = new Map<string, number>();

  /** Summaries need the pair stock's USD price synchronously — prefetch it
   *  for every launched pair before building token summaries. */
  override async getTokens(opts?: Parameters<V4Client["getTokens"]>[0]): ReturnType<V4Client["getTokens"]> {
    await this.loadCores();
    const pairs = [...new Set([...this.cores.values()].map((c) => c.stock))];
    await Promise.all(
      pairs.map(async (s) => {
        const usd = await this.stockUsdPrice(s).catch(() => 0);
        if (usd > 0) this.quoteUsdCache.set(s.toLowerCase(), usd);
      }),
    );
    // Attach each token's reward basket to its metadata once (immutable after
    // launch), so discovery cards and the API can show the full basket.
    await Promise.all(
      [...this.cores.values()]
        .filter((c) => !(c.metadata as any).rewardBasket)
        .map(async (c) => {
          const b = await this.rewardBasket(c.address).catch(() => [] as Address[]);
          if (b.length) (c.metadata as any).rewardBasket = b.map((a) => a.toLowerCase());
        }),
    );
    return super.getTokens(opts);
  }

  protected override quoteUsd(core: Core): number {
    const key = core.stock.toLowerCase();
    const cached = this.quoteUsdCache.get(key);
    // Fire-and-forget refresh; stockUsdPrice has its own 60s cache.
    this.stockUsdPrice(core.stock)
      .then((usd) => {
        if (Number.isFinite(usd) && usd > 0) this.quoteUsdCache.set(key, usd);
      })
      .catch(() => {});
    if (cached) return cached;
    return 0; // first paint may show $0; corrected on the next refresh tick
  }

  /** Launch a stock-paired token: 1 pair stock + a 1..5 reward basket. */
  async createTokenS(params: {
    name: string;
    symbol: string;
    metadataURI?: string;
    pairStock: Address;
    taxBps: number;
    rewardStocks: Address[];
  }): Promise<`0x${string}`> {
    const wc = this.requireWallet();
    const creator = this.account();
    const metadataURI = params.metadataURI ?? "";
    const args = encodeAbiParameters(
      [
        { type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" },
        { type: "address" }, { type: "address" }, { type: "uint16" }, { type: "address[]" },
      ],
      [params.name, params.symbol, metadataURI, TOTAL_SUPPLY, creator, this.v4.factory, params.taxBps, params.rewardStocks],
    );
    const initCodeHash = keccak256(concatHex([QUIVER_TOKEN_M_BYTECODE as `0x${string}`, args]));
    let salt: `0x${string}` | null = null;
    for (let i = 0n; i < 3_000_000n; i++) {
      const s = `0x${i.toString(16).padStart(64, "0")}` as `0x${string}`;
      const addr = getContractAddress({ opcode: "CREATE2", from: this.v4.factory, salt: s, bytecodeHash: initCodeHash });
      if ((BigInt(addr) & 0xffffn) === 0x4663n) {
        salt = s;
        break;
      }
    }
    if (!salt) throw new Error("Could not mine a launch address. Try again.");
    return wc.writeContract({
      account: creator,
      chain: wc.chain,
      address: this.v4.factory,
      abi: factorySLaunchAbi,
      functionName: "launch",
      args: [
        {
          name: params.name,
          symbol: params.symbol,
          metadataURI,
          pairStock: params.pairStock,
          taxBps: params.taxBps,
          rewardStocks: params.rewardStocks,
        },
        salt,
      ],
    });
  }

  /** Buy with native ETH via the router's ETH -> USDG -> stock -> token path. */
  override async buyToken(token: Address, valueWei: bigint, minOut: bigint = 0n): Promise<`0x${string}`> {
    const wc = this.requireWallet();
    return wc.writeContract({
      account: this.account(),
      chain: wc.chain,
      address: this.v4.router,
      abi: routerSAbi,
      functionName: "buyWithEth",
      args: [token, minOut],
      value: valueWei,
    });
  }

  override async sellToken(token: Address, amount: bigint, minOut: bigint = 0n): Promise<`0x${string}`> {
    const wc = this.requireWallet();
    const account = this.account();
    const allowance = (await this.publicClient.readContract({
      address: token,
      abi: tokenAbi,
      functionName: "allowance",
      args: [account, this.v4.router],
    })) as bigint;
    if (allowance < amount) {
      const approveHash = await wc.writeContract({
        account,
        chain: wc.chain,
        address: token,
        abi: tokenAbi,
        functionName: "approve",
        args: [this.v4.router, 2n ** 256n - 1n],
      });
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }
    return wc.writeContract({
      account,
      chain: wc.chain,
      address: this.v4.router,
      abi: routerSAbi,
      functionName: "sellForEth",
      args: [token, amount, minOut],
    });
  }

  /** Lifetime distribution per basket stock, with USD value. */
  async basketTotals(
    token: Address,
  ): Promise<{ stock: Address; amount: bigint; usd: number }[]> {
    const rewardsAbi = [
      { type: "function", name: "rewardTokens", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
      { type: "function", name: "totalRewardsDistributedAt", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
    ] as const;
    const stocks = (await this.publicClient.readContract({
      address: token, abi: rewardsAbi, functionName: "rewardTokens",
    })) as Address[];
    return Promise.all(
      stocks.map(async (stock, i) => {
        const amount = (await this.publicClient.readContract({
          address: token, abi: rewardsAbi, functionName: "totalRewardsDistributedAt", args: [BigInt(i)],
        })) as bigint;
        const px = await this.stockUsdPrice(stock).catch(() => 0);
        return { stock, amount, usd: (Number(amount) / 1e18) * px };
      }),
    );
  }

  /** Reward basket of a launched token (1..5 stock addresses). */
  async rewardBasket(token: Address): Promise<Address[]> {
    return (await this.publicClient.readContract({
      address: this.v4.factory,
      abi: factorySLaunchAbi,
      functionName: "rewardStocksOf",
      args: [token],
    })) as Address[];
  }
}

export { STOCKS_S, stockSOf };
