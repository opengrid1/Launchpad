/* eslint-disable no-console */
// Reward keeper. Every KEEPER_INTERVAL_MS it walks every coin on the factory,
// finds holders with unclaimed rewards worth at least MIN_PUSH_USD, and pushes
// them to their wallets in batches through Multicall3 (claimFor is public, the
// keeper only pays gas). Also pushes the platform share to the fee recipient.
//
// Env: KEEPER_PRIVATE_KEY (gas wallet), ALCHEMY_HTTP, KEEPER_INTERVAL_MS (30 min),
//      MIN_PUSH_USD (0.25), BATCH (60), MIN_GAS_ETH (0.003), SELF_FUND_TOKEN
//      (optional coin whose creator fees refill the gas wallet when low),
//      KEEPER_DRY_RUN=1 to only print.
import { ethers } from "ethers";

const FACTORY = "0x88e21f36829f692FA1fF29fcC8Cc5E61afE77922";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90".toLowerCase();
const START_BLOCK = 25915149;
const TRANSFER = ethers.id("Transfer(address,address,uint256)");

const FACTORY_ABI = [
  "function totalTokens() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function listings(address) view returns (address creator, address pair, uint16 taxBps, uint64 createdAt, bytes32 poolId)",
  "function pairUsdPrice(address) view returns (uint256)",
  "function pushPlatformFees(address[] tokens)",
];
const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function pendingRewards(address) view returns (uint256)",
  "function platformFees() view returns (uint256)",
  "function creatorFees() view returns (uint256)",
  "function claimFor(address holder) returns (uint256)",
  "function claimCreatorFees(bool asEth, uint256 minEthOut, bytes route) returns (uint256)",
];
const MC_ABI = ["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])"];

export function startKeeper(opts = {}) {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) { console.log("keeper: KEEPER_PRIVATE_KEY not set, keeper off"); return; }
  const rpc = process.env.ALCHEMY_HTTP || process.env.RPC_URL;
  const p = new ethers.JsonRpcProvider(rpc, 1, { staticNetwork: true, batchMaxCount: 1 });
  const w = new ethers.Wallet(key, p);
  const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 30 * 60_000);
  const MIN_USD = Number(process.env.MIN_PUSH_USD ?? "0.25");
  const BATCH = Number(process.env.BATCH ?? "60");
  const MIN_GAS = ethers.parseEther(process.env.MIN_GAS_ETH ?? "0.003");
  const DRY = process.env.KEEPER_DRY_RUN === "1";
  const SELF_FUND = process.env.SELF_FUND_TOKEN;
  const log = opts.log ?? ((...a) => console.log("keeper:", ...a));
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, w);
  const mc = new ethers.Contract(MULTICALL3, MC_ABI, w);
  const tokenIface = new ethers.Interface(TOKEN_ABI);
  const erc = (a) => new ethers.Contract(a, TOKEN_ABI, p);
  const feeOpts = async () => { const f = await p.getFeeData(); return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n }; };
  let running = false;

  async function holdersOf(token) {
    const latest = await p.getBlockNumber();
    const bal = new Map();
    for (let a = START_BLOCK; a <= latest; a += 50_000) {
      const logs = await p.getLogs({ address: token, topics: [TRANSFER], fromBlock: a, toBlock: Math.min(a + 49_999, latest) });
      for (const l of logs) { const f = "0x" + l.topics[1].slice(26), t = "0x" + l.topics[2].slice(26), v = BigInt(l.data); bal.set(f, (bal.get(f) ?? 0n) - v); bal.set(t, (bal.get(t) ?? 0n) + v); }
    }
    return [...bal.entries()].filter(([a, v]) => v > 0n && a !== POOL_MANAGER && a !== ethers.ZeroAddress).map(([a]) => a);
  }

  async function pendingOf(token, holders) {
    const out = [];
    for (let i = 0; i < holders.length; i += 200) {
      const chunk = holders.slice(i, i + 200);
      const calls = chunk.map((h) => ({ target: token, allowFailure: true, callData: tokenIface.encodeFunctionData("pendingRewards", [h]) }));
      const res = await mc.aggregate3.staticCall(calls);
      res.forEach((r, j) => { if (r.success) { const v = BigInt(r.returnData); if (v > 0n) out.push({ address: chunk[j], pending: v }); } });
    }
    return out;
  }

  async function ensureGas() {
    const bal = await p.getBalance(w.address);
    if (bal >= MIN_GAS || !SELF_FUND || DRY) return bal;
    const t = new ethers.Contract(SELF_FUND, TOKEN_ABI, w);
    const owed = await t.creatorFees();
    if (owed === 0n) { log("gas low", ethers.formatEther(bal), "ETH and nothing to self-fund from"); return bal; }
    const tx = await t.claimCreatorFees(true, 0, "0x", await feeOpts());
    await tx.wait();
    const after = await p.getBalance(w.address);
    log("self-funded gas from creator fees:", ethers.formatEther(owed), "ETH, balance now", ethers.formatEther(after), "tx", tx.hash);
    return after;
  }

  async function run() {
    if (running) return; running = true;
    const started = Date.now();
    try {
      const bal = await ensureGas();
      if (bal < MIN_GAS && !DRY) { log("skipping run, gas wallet has", ethers.formatEther(bal), "ETH (need", ethers.formatEther(MIN_GAS) + ")"); return; }
      const n = Number(await factory.totalTokens());
      const platformTodo = [];
      let pushed = 0, txs = 0, skippedDust = 0;
      for (let i = 0; i < n; i++) {
        const token = await factory.allTokens(i);
        const [L, sym, platform] = await Promise.all([factory.listings(token), erc(token).symbol().catch(() => token.slice(0, 8)), erc(token).platformFees()]);
        if (platform > 0n) platformTodo.push(token);
        const pairUsd = Number(await factory.pairUsdPrice(L.pair)) / 1e8;
        const holders = await holdersOf(token);
        if (holders.length === 0) continue;
        const pend = await pendingOf(token, holders);
        const worth = pend.filter((h) => Number(ethers.formatEther(h.pending)) * pairUsd >= MIN_USD);
        skippedDust += pend.length - worth.length;
        if (worth.length === 0) continue;
        const total = worth.reduce((s, h) => s + h.pending, 0n);
        log(sym, "->", worth.length, "holders,", Number(ethers.formatEther(total)).toFixed(6), "pair units (~$" + (Number(ethers.formatEther(total)) * pairUsd).toFixed(2) + ")");
        for (let j = 0; j < worth.length; j += BATCH) {
          const batch = worth.slice(j, j + BATCH);
          const calls = batch.map((h) => ({ target: token, allowFailure: true, callData: tokenIface.encodeFunctionData("claimFor", [h.address]) }));
          if (DRY) { log("  [dry] would push", batch.length); continue; }
          const tx = await mc.aggregate3(calls, await feeOpts());
          const rc = await tx.wait();
          txs++; pushed += batch.length;
          log("  pushed", batch.length, "tx", tx.hash, "gas", rc.gasUsed.toString());
        }
      }
      if (platformTodo.length && !DRY) {
        const tx = await factory.pushPlatformFees(platformTodo, await feeOpts());
        await tx.wait();
        log("platform fees pushed for", platformTodo.length, "coins tx", tx.hash);
      }
      log("run done:", pushed, "holders paid in", txs, "txs,", skippedDust, "dust skipped,", Math.round((Date.now() - started) / 1000) + "s, gas wallet", ethers.formatEther(await p.getBalance(w.address)), "ETH");
    } catch (e) {
      log("run failed:", e.shortMessage || e.message);
    } finally { running = false; }
  }

  log("on. wallet", w.address, "every", INTERVAL / 60_000, "min, min push $" + MIN_USD, DRY ? "(dry run)" : "");
  void run();
  const timer = setInterval(run, INTERVAL);
  return () => clearInterval(timer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await import("dotenv/config");
  startKeeper();
}
