import {
  createPublicClient,
  http,
  parseEther,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Hash,
} from "viem";

import { launchpadAbi, launchTokenAbi, feeDistributorAbi } from "./abi";
import { LaunchpadSocket } from "./ws";
import type {
  Address,
  Candle,
  CandleInterval,
  CandleUpdate,
  CreateTokenParams,
  CreatorStats,
  HolderRecord,
  LaunchpadAddresses,
  PlatformStats,
  PoolInfo,
  PriceUpdate,
  TokenSummary,
  TradeRecord,
  TradingLimits,
} from "./types";

export interface LaunchpadClientConfig {
  /** Deployed contract addresses on Robinhood Chain. */
  addresses: LaunchpadAddresses;
  /** Chain definition (id, rpcUrls) used when publicClient is not provided. */
  chain?: Chain;
  rpcUrl?: string;
  /** Bring your own viem clients if you already have them. */
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  /** Backend REST base URL, e.g. https://api.yourlaunchpad.xyz */
  apiUrl: string;
  /** Backend WebSocket URL, e.g. wss://api.yourlaunchpad.xyz/ws */
  wsUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_SUPPLY = 1_000_000_000n * 10n ** 18n;

/**
 * Launchpad SDK. On-chain writes go through a viem WalletClient (real
 * transaction signing, no custodied keys); reads come from the chain and the
 * indexer API; live data streams over WebSocket.
 */
export class LaunchpadClient {
  readonly addresses: LaunchpadAddresses;
  readonly publicClient: PublicClient;
  private walletClient?: WalletClient;
  private apiUrl: string;
  private socket?: LaunchpadSocket;
  private fetchFn: typeof fetch;

  constructor(config: LaunchpadClientConfig) {
    this.addresses = config.addresses;
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.fetchFn = config.fetchFn ?? fetch.bind(globalThis);

    if (config.publicClient) {
      this.publicClient = config.publicClient;
    } else if (config.chain) {
      this.publicClient = createPublicClient({
        chain: config.chain,
        transport: http(config.rpcUrl ?? config.chain.rpcUrls.default.http[0]),
      });
    } else {
      throw new Error("Provide either publicClient or chain in LaunchpadClientConfig");
    }

    this.walletClient = config.walletClient;
    if (config.wsUrl) this.socket = new LaunchpadSocket(config.wsUrl);
  }

  /** Attach or replace the signing wallet (e.g. after the user connects). */
  connectWallet(walletClient: WalletClient) {
    this.walletClient = walletClient;
  }

  private requireWallet(): WalletClient {
    if (!this.walletClient) throw new Error("No wallet connected. Call connectWallet first.");
    return this.walletClient;
  }

  private async api<T>(path: string): Promise<T> {
    const res = await this.fetchFn(`${this.apiUrl}${path}`);
    if (!res.ok) throw new Error(`API ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  // -------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------

  /** Launch a token: deploys the ERC-20, creates the V3 pool, seeds liquidity. */
  async createToken(params: CreateTokenParams): Promise<Hash> {
    const wallet = this.requireWallet();
    const [account] = await wallet.getAddresses();

    const metadataURI = JSON.stringify({
      description: params.description ?? "",
      logo: params.logo ?? "",
      website: params.website ?? "",
      twitter: params.twitter ?? "",
      telegram: params.telegram ?? "",
      links: params.links ?? [],
    });

    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.addresses.launchpad,
      abi: launchpadAbi,
      functionName: "createToken",
      args: [
        {
          name: params.name,
          symbol: params.symbol,
          metadataURI,
          totalSupply: params.totalSupply ?? DEFAULT_SUPPLY,
          feeTier: params.feeTier ?? 3000,
          maxTxBps: params.maxTxBps ?? 100,
          maxWalletBps: params.maxWalletBps ?? 200,
          buyCooldown: params.buyCooldownSeconds ?? 0,
        },
      ],
      value: params.initialLiquidityWei,
    });
    return wallet.writeContract(request);
  }

  /** Buy tokens with native currency. */
  async buyToken(token: Address, valueWei: bigint, opts?: { minTokensOut?: bigint; deadlineSeconds?: number }): Promise<Hash> {
    const wallet = this.requireWallet();
    const [account] = await wallet.getAddresses();
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts?.deadlineSeconds ?? 300));

    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.addresses.launchpad,
      abi: launchpadAbi,
      functionName: "buy",
      args: [token, opts?.minTokensOut ?? 0n, deadline],
      value: valueWei,
    });
    return wallet.writeContract(request);
  }

  /** Sell tokens for native currency. Handles the allowance automatically. */
  async sellToken(token: Address, amount: bigint, opts?: { minNativeOut?: bigint; deadlineSeconds?: number }): Promise<Hash> {
    const wallet = this.requireWallet();
    const [account] = await wallet.getAddresses();

    const allowance = await this.publicClient.readContract({
      address: token,
      abi: launchTokenAbi,
      functionName: "allowance",
      args: [account, this.addresses.launchpad],
    });
    if (allowance < amount) {
      const { request: approveReq } = await this.publicClient.simulateContract({
        account,
        address: token,
        abi: launchTokenAbi,
        functionName: "approve",
        args: [this.addresses.launchpad, amount],
      });
      const approveHash = await wallet.writeContract(approveReq);
      await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + (opts?.deadlineSeconds ?? 300));
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.addresses.launchpad,
      abi: launchpadAbi,
      functionName: "sell",
      args: [token, amount, opts?.minNativeOut ?? 0n, deadline],
    });
    return wallet.writeContract(request);
  }

  /** Withdraw pending creator earnings (one click). */
  async withdrawCreatorEarnings(): Promise<Hash> {
    const wallet = this.requireWallet();
    const [account] = await wallet.getAddresses();
    const { request } = await this.publicClient.simulateContract({
      account,
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "withdrawCreator",
      args: [],
    });
    return wallet.writeContract(request);
  }

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  async getToken(token: Address): Promise<TokenSummary> {
    return this.api<TokenSummary>(`/api/tokens/${token.toLowerCase()}`);
  }

  async getTokens(opts?: { sort?: "new" | "volume" | "marketCap" | "featured"; limit?: number; offset?: number }): Promise<TokenSummary[]> {
    const q = new URLSearchParams();
    if (opts?.sort) q.set("sort", opts.sort);
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.offset) q.set("offset", String(opts.offset));
    return this.api<TokenSummary[]>(`/api/tokens?${q}`);
  }

  /** Latest price in native wei per whole token, straight from the pool. */
  async getPrice(token: Address): Promise<{ priceWei: bigint; priceUsd: string }> {
    const [mcapWeth, mcapUsd, supply] = await Promise.all([
      this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "marketCapWeth",
        args: [token],
      }),
      this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "marketCapUsd",
        args: [token],
      }),
      this.publicClient.readContract({ address: token, abi: launchTokenAbi, functionName: "totalSupply" }),
    ]);
    const priceWei = supply === 0n ? 0n : (mcapWeth * 10n ** 18n) / supply;
    const priceUsd = supply === 0n ? "0" : formatUsd8((mcapUsd * 10n ** 18n) / supply);
    return { priceWei, priceUsd };
  }

  async getMarketCap(token: Address): Promise<{ marketCapWeth: bigint; marketCapUsd: string }> {
    const [mcapWeth, mcapUsd] = await Promise.all([
      this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "marketCapWeth",
        args: [token],
      }),
      this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "marketCapUsd",
        args: [token],
      }),
    ]);
    return { marketCapWeth: mcapWeth, marketCapUsd: formatUsd8(mcapUsd) };
  }

  async getLiquidity(token: Address): Promise<{ poolLiquidity: bigint; positionLiquidity: bigint }> {
    const info = await this.getPoolInfoRaw(token);
    return { poolLiquidity: BigInt(info.poolLiquidity), positionLiquidity: BigInt(info.positionLiquidity) };
  }

  async getVolume(token: Address): Promise<{ volume24hWei: string; volumeTotalWei: string }> {
    const t = await this.getToken(token);
    return { volume24hWei: t.volume24hWei, volumeTotalWei: t.volumeTotalWei };
  }

  async getTrades(token: Address, opts?: { limit?: number; before?: number }): Promise<TradeRecord[]> {
    const q = new URLSearchParams({ token: token.toLowerCase() });
    if (opts?.limit) q.set("limit", String(opts.limit));
    if (opts?.before) q.set("before", String(opts.before));
    return this.api<TradeRecord[]>(`/api/trades?${q}`);
  }

  async getHolders(token: Address, opts?: { limit?: number }): Promise<HolderRecord[]> {
    const q = new URLSearchParams({ token: token.toLowerCase() });
    if (opts?.limit) q.set("limit", String(opts.limit));
    return this.api<HolderRecord[]>(`/api/holders?${q}`);
  }

  async getCandles(token: Address, interval: CandleInterval, opts?: { from?: number; to?: number; limit?: number }): Promise<Candle[]> {
    const q = new URLSearchParams({ token: token.toLowerCase(), interval });
    if (opts?.from) q.set("from", String(opts.from));
    if (opts?.to) q.set("to", String(opts.to));
    if (opts?.limit) q.set("limit", String(opts.limit));
    return this.api<Candle[]>(`/api/candles?${q}`);
  }

  async getPoolInfoRaw(token: Address): Promise<PoolInfo> {
    const [pool, feeTier, sqrtPriceX96, tick, poolLiquidity, positionTokenId, positionLiquidity] =
      await this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "poolInfo",
        args: [token],
      });
    return {
      pool,
      feeTier: Number(feeTier),
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick: Number(tick),
      poolLiquidity: poolLiquidity.toString(),
      positionTokenId: positionTokenId.toString(),
      positionLiquidity: positionLiquidity.toString(),
    };
  }

  async getPoolInfo(token: Address): Promise<PoolInfo> {
    return this.getPoolInfoRaw(token);
  }

  async getTradingLimits(token: Address): Promise<TradingLimits> {
    const [[active, maxTx, maxWallet, cooldown, mcapUsd, remainingUsd], capUsd] = await Promise.all([
      this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "tradingLimits",
        args: [token],
      }),
      this.publicClient.readContract({
        address: this.addresses.launchpad,
        abi: launchpadAbi,
        functionName: "graduationCapUsd",
      }),
    ]);
    return {
      active,
      maxTxAmount: maxTx.toString(),
      maxWalletAmount: maxWallet.toString(),
      buyCooldownSeconds: Number(cooldown),
      marketCapUsd: formatUsd8(mcapUsd),
      remainingUsd: formatUsd8(remainingUsd),
      graduationCapUsd: formatUsd8(capUsd),
    };
  }

  async getPlatformStats(): Promise<PlatformStats> {
    return this.api<PlatformStats>("/api/stats");
  }

  async getCreatorStats(creator: Address): Promise<CreatorStats> {
    return this.api<CreatorStats>(`/api/creators/${creator.toLowerCase()}`);
  }

  async getCreatorPending(creator: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.addresses.feeDistributor,
      abi: feeDistributorAbi,
      functionName: "creatorPending",
      args: [creator],
    });
  }

  // -------------------------------------------------------------------
  // Live subscriptions
  // -------------------------------------------------------------------

  private requireSocket(): LaunchpadSocket {
    if (!this.socket) throw new Error("No wsUrl configured for LaunchpadClient");
    return this.socket;
  }

  subscribeToPrice(token: Address, onUpdate: (update: PriceUpdate) => void): () => void {
    return this.requireSocket().subscribe("price:update", { token }, (msg) => {
      if (msg.channel === "price:update") onUpdate(msg.data);
    });
  }

  subscribeToTrades(token: Address, onTrade: (trade: TradeRecord) => void): () => void {
    return this.requireSocket().subscribe("trade:update", { token }, (msg) => {
      if (msg.channel === "trade:update") onTrade(msg.data);
    });
  }

  subscribeToCandles(token: Address, interval: CandleInterval, onCandle: (update: CandleUpdate) => void): () => void {
    return this.requireSocket().subscribe("candle:update", { token, interval }, (msg) => {
      if (msg.channel === "candle:update" && msg.data.interval === interval) onCandle(msg.data);
    });
  }

  subscribeToLaunches(onLaunch: (token: TokenSummary) => void): () => void {
    return this.requireSocket().subscribe("token:launched", {}, (msg) => {
      if (msg.channel === "token:launched") onLaunch(msg.data);
    });
  }

  disconnect() {
    this.socket?.close();
  }
}

/** Formats an 8-decimal USD bigint as a decimal string, e.g. 4000000000000n -> "40000". */
export function formatUsd8(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 10n ** 8n;
  const frac = (abs % 10n ** 8n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export { parseEther };
