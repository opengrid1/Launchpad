import { parseAbiItem, getAddress, zeroAddress, type Address } from "viem";
import { publicClient } from "./chain.js";
import { ADDRESSES, FEE_TIERS } from "./config.js";
import { factoryAbi, poolAbi } from "./abis.js";
import { snipeBuy } from "./dex.js";
import { checkToken } from "./safety.js";

const POOL_CREATED = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SnipeConfig {
  /** Specific token to snipe. If omitted, snipes the first NEW token paired with WETH. */
  targetToken?: string;
  /** ETH to spend on the buy. */
  ethAmount: string;
  /** Stop trying after this many blocks once a target pool is seen. */
  maxBlocks?: number;
  /** Poll interval in ms (lower = faster detection, more RPC load). */
  pollMs?: number;
  /** Run a honeypot/safety check before buying (adds latency). */
  safetyCheck?: boolean;
}

export type SnipeEvent =
  | { kind: "armed"; fromBlock: bigint }
  | { kind: "detected"; token: Address; pool: Address; fee: number; block: bigint }
  | { kind: "skipped"; token: Address; reason: string }
  | { kind: "buying"; token: Address; fee: number; attempt: number }
  | { kind: "bought"; token: Address; fee: number; hash?: string; dryRun: boolean }
  | { kind: "failed"; token: Address; reason: string };

export interface SniperHandle {
  stop: () => void;
  done: Promise<void>;
}

/** Find an existing initialised WETH pool for a token (used when sniping a known address). */
async function existingPool(token: Address): Promise<{ pool: Address; fee: number } | null> {
  const weth = ADDRESSES.weth as Address;
  for (const fee of FEE_TIERS) {
    const pool = (await publicClient.readContract({
      address: ADDRESSES.factory as Address,
      abi: factoryAbi,
      functionName: "getPool",
      args: [token, weth, fee],
    })) as Address;
    if (pool !== zeroAddress) return { pool, fee };
  }
  return null;
}

async function poolHasLiquidity(pool: Address): Promise<boolean> {
  try {
    const [slot0, liq] = await Promise.all([
      publicClient.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
      publicClient.readContract({ address: pool, abi: poolAbi, functionName: "liquidity" }),
    ]);
    return (slot0[0] as bigint) > 0n && (liq as bigint) > 0n;
  } catch {
    return false;
  }
}

/**
 * Arm the sniper. Watches Factory `PoolCreated` events (and, for a known
 * target, any pre-existing pool), then fires a pre-built buy the moment the
 * pool has liquidity — retrying each block until it lands or maxBlocks passes.
 */
export function armSniper(cfg: SnipeConfig, emit: (e: SnipeEvent) => void): SniperHandle {
  const weth = getAddress(ADDRESSES.weth);
  const target = cfg.targetToken ? getAddress(cfg.targetToken) : null;
  const pollMs = cfg.pollMs ?? 400;
  const maxBlocks = cfg.maxBlocks ?? 30;
  let stopped = false;

  const buyWithRetries = async (token: Address, fee: number) => {
    if (cfg.safetyCheck) {
      const safety = await checkToken(token).catch(() => null);
      if (safety && safety.sellable === false) {
        emit({ kind: "skipped", token, reason: "honeypot — sell simulation reverted" });
        return;
      }
    }
    const startBlock = await publicClient.getBlockNumber();
    for (let attempt = 1; !stopped; attempt++) {
      try {
        emit({ kind: "buying", token, fee, attempt });
        const r = await snipeBuy(token, fee, cfg.ethAmount);
        emit({ kind: "bought", token, fee, hash: r.hash, dryRun: r.dryRun });
        return;
      } catch (e: any) {
        const now = await publicClient.getBlockNumber();
        if (now - startBlock > BigInt(maxBlocks)) {
          emit({ kind: "failed", token, reason: e.shortMessage || e.message });
          return;
        }
        await sleep(pollMs); // pool likely not liquid yet — try again next block
      }
    }
  };

  const run = async (): Promise<void> => {
    // Fast path: known target whose pool already exists — wait for liquidity, buy.
    if (target) {
      const existing = await existingPool(target);
      if (existing) {
        emit({ kind: "detected", token: target, pool: existing.pool, fee: existing.fee, block: await publicClient.getBlockNumber() });
        await buyWithRetries(target, existing.fee);
        return;
      }
    }

    let last = await publicClient.getBlockNumber();
    emit({ kind: "armed", fromBlock: last });

    while (!stopped) {
      const bn = await publicClient.getBlockNumber();
      if (bn > last) {
        const logs = await publicClient.getLogs({
          address: ADDRESSES.factory as Address,
          event: POOL_CREATED,
          fromBlock: last + 1n,
          toBlock: bn,
        });
        for (const log of logs) {
          const { token0, token1, fee, pool } = log.args as {
            token0: Address; token1: Address; fee: number; pool: Address;
          };
          const isWeth0 = getAddress(token0) === weth;
          const isWeth1 = getAddress(token1) === weth;
          if (!isWeth0 && !isWeth1) continue; // only WETH pairs are buyable with ETH
          const token = getAddress(isWeth0 ? token1 : token0);
          if (target && token !== target) continue;
          emit({ kind: "detected", token, pool: getAddress(pool), fee, block: bn });
          await buyWithRetries(token, fee);
          if (target) return; // sniped the one we wanted
        }
        last = bn;
      }
      await sleep(pollMs);
    }
  };

  const done = run().catch((e) => {
    emit({ kind: "failed", token: zeroAddress, reason: e.message });
  });

  return { stop: () => { stopped = true; }, done };
}

export function formatSnipeEvent(e: SnipeEvent): string {
  switch (e.kind) {
    case "armed": return `🎯 Sniper armed at block ${e.fromBlock}. Watching for new WETH pools…`;
    case "detected": return `🔎 New pool: \`${e.token}\` (fee ${e.fee / 10000}%) @ block ${e.block}`;
    case "skipped": return `⏭️ Skipped \`${e.token}\`: ${e.reason}`;
    case "buying": return `⚡ Buying \`${e.token}\` (attempt ${e.attempt})…`;
    case "bought": return e.dryRun
      ? `🧪 DRY RUN — would have sniped \`${e.token}\``
      : `✅ SNIPED \`${e.token}\`! Tx: ${e.hash}`;
    case "failed": return `❌ Snipe failed: ${e.reason}`;
  }
}
