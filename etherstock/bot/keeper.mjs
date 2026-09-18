/* eslint-disable no-console */
// Burn keeper. Every KEEPER_INTERVAL_MS it walks every coin on the factory and
// fires buybackAndBurn on each coin whose burn reserve is worth at least
// MIN_BURN_USD, batched through Multicall3 (buybackAndBurn is public, the
// keeper only pays gas). The hook fires burns by itself once a reserve reaches
// $25; the keeper sweeps quiet coins whose reserve sits below that for a long
// time. Also pushes the platform share to the fee recipient.
//
// Env: KEEPER_PRIVATE_KEY (gas wallet), ALCHEMY_HTTP, FACTORY, KEEPER_INTERVAL_MS
//      (6 h), KEEPER_MIN_USD (5), BATCH (20), MIN_GAS_ETH (0.003), SELF_FUND_TOKEN
//      (optional coin whose creator fees refill the gas wallet when low),
//      KEEPER_DRY_RUN=1 to only print.
import { ethers } from "ethers";

const FACTORY = process.env.FACTORY;
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const FACTORY_ABI = [
  "function totalTokens() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
  "function listings(address) view returns (address creator, address pair, uint16 taxBps, uint64 createdAt, bytes32 poolId)",
  "function pairUsdPrice(address) view returns (uint256)",
  "function pushPlatformFees(address[] tokens)",
];
const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function burnReserve() view returns (uint256)",
  "function platformFees() view returns (uint256)",
  "function creatorFees() view returns (uint256)",
  "function buybackAndBurn() returns (uint256)",
  "function claimCreatorFees(bool asEth, uint256 minEthOut, bytes route) returns (uint256)",
];
const MC_ABI = ["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])"];

export function startKeeper(opts = {}) {
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) { console.log("keeper: KEEPER_PRIVATE_KEY not set, keeper off"); return; }
  if (!FACTORY) { console.log("keeper: FACTORY not set, keeper off"); return; }
  const rpc = process.env.ALCHEMY_HTTP || process.env.RPC_URL;
  const p = new ethers.JsonRpcProvider(rpc, 1, { staticNetwork: true, batchMaxCount: 1 });
  const w = new ethers.Wallet(key, p);
  const INTERVAL = Number(process.env.KEEPER_INTERVAL_MS ?? 6 * 60 * 60_000);
  const MIN_USD = Number(process.env.KEEPER_MIN_USD ?? "5");
  const BATCH = Number(process.env.BATCH ?? "20");
  const MIN_GAS = ethers.parseEther(process.env.MIN_GAS_ETH ?? "0.003");
  const DRY = process.env.KEEPER_DRY_RUN === "1";
  const SELF_FUND = process.env.SELF_FUND_TOKEN;
  const log = opts.log ?? ((...a) => console.log("keeper:", ...a));
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, w);
  const mc = new ethers.Contract(MULTICALL3, MC_ABI, w);
  const tokenIface = new ethers.Interface(TOKEN_ABI);
  const erc = (a) => new ethers.Contract(a, TOKEN_ABI, w);
  let running = false;

  async function feeOpts() {
    const fd = await p.getFeeData();
    const tip = ethers.parseUnits("0.05", "gwei");
    const base = fd.maxFeePerGas ?? fd.gasPrice ?? ethers.parseUnits("2", "gwei");
    return { maxPriorityFeePerGas: tip, maxFeePerGas: base + tip };
  }

  async function ensureGas() {
    const bal = await p.getBalance(w.address);
    if (bal >= MIN_GAS || !SELF_FUND || DRY) return bal;
    const t = erc(SELF_FUND);
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
      const burnTodo = [];
      let skippedDust = 0;
      for (let i = 0; i < n; i++) {
        const token = await factory.allTokens(i);
        const [L, sym, platform, reserve] = await Promise.all([factory.listings(token), erc(token).symbol().catch(() => token.slice(0, 8)), erc(token).platformFees(), erc(token).burnReserve()]);
        if (platform > 0n) platformTodo.push(token);
        if (reserve === 0n) continue;
        const pairUsd = Number(await factory.pairUsdPrice(L.pair)) / 1e8;
        const worth = Number(ethers.formatEther(reserve)) * pairUsd;
        if (worth < MIN_USD) { skippedDust++; continue; }
        log(sym, "reserve", Number(ethers.formatEther(reserve)).toFixed(6), "pair units (~$" + worth.toFixed(2) + ")");
        burnTodo.push(token);
      }
      let txs = 0, burned = 0;
      for (let j = 0; j < burnTodo.length; j += BATCH) {
        const batch = burnTodo.slice(j, j + BATCH);
        const calls = batch.map((t) => ({ target: t, allowFailure: true, callData: tokenIface.encodeFunctionData("buybackAndBurn", []) }));
        if (DRY) { log("  [dry] would burn", batch.length); continue; }
        const tx = await mc.aggregate3(calls, await feeOpts());
        const rc = await tx.wait();
        txs++; burned += batch.length;
        log("  burned", batch.length, "coins tx", tx.hash, "gas", rc.gasUsed.toString());
      }
      if (platformTodo.length && !DRY) {
        const tx = await factory.pushPlatformFees(platformTodo, await feeOpts());
        await tx.wait();
        log("platform fees pushed for", platformTodo.length, "coins tx", tx.hash);
      }
      log("run done:", burned, "coins burned in", txs, "txs,", skippedDust, "below $" + MIN_USD + ",", Math.round((Date.now() - started) / 1000) + "s, gas wallet", ethers.formatEther(await p.getBalance(w.address)), "ETH");
    } catch (e) {
      log("run failed:", e.shortMessage || e.message);
    } finally { running = false; }
  }

  log("on. wallet", w.address, "every", INTERVAL / 60_000, "min, min burn $" + MIN_USD, DRY ? "(dry run)" : "");
  void run();
  const timer = setInterval(run, INTERVAL);
  return () => clearInterval(timer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await import("dotenv/config");
  startKeeper();
}
