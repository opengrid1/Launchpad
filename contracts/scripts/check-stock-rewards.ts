/* eslint-disable no-console */
// Proves, on a mainnet fork, that every approved stock pair pays rewards
// on-chain: for each quote asset the script launches a coin paired with it,
// buys and sells with the stock through the router, and checks that holder
// rewards, creator fees and platform fees accrue and can be claimed in the
// stock. Stocks with an ETH route are also bought and sold in plain ETH and
// the holder claims as ETH.
//
//   DEPLOY_FILE=<local deployment json> HARDHAT_CONFIG=hardhat.config.size.ts \
//     npx hardhat run scripts/check-stock-rewards.ts --network localhost
//
// Writes deployments/ethereum-stock-rewards-check.json.
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const STABLE: Record<string, string> = { USDC, USDT, WETH };
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const ZERO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"];
// OpenZeppelin ERC-7201 namespaced ERC20 storage: _balances sits at the base slot.
const OZ_ERC20_SLOT = "0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00";

interface Route { kind: "v3" | "v4"; via: "USDC" | "USDT" | "WETH"; fee: number; tickSpacing?: number; hooks?: string }
interface Result {
  symbol: string; address: string; usd: number;
  funded: boolean; slot?: string; launched: boolean; buyPair: boolean; sellPair: boolean;
  holderPending: string; creatorFees: string; platformFees: string;
  claimHolder: boolean; claimCreator: boolean; claimPlatform: boolean;
  ethRoute: boolean; buyEth?: boolean; sellEth?: boolean; claimAsEth?: boolean;
  ok: boolean; error?: string;
}

/** Routes come from the site's stock roster (regex over the generated file). */
function loadRoutes(): Map<string, Route> {
  const file = path.join(__dirname, "..", "..", "stockpad", "src", "lib", "stocks.ts");
  const out = new Map<string, Route>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/address: "(0x[0-9a-fA-F]{40})".*?route: (\{[^}]*\})/);
    if (m) out.set(m[1].toLowerCase(), JSON.parse(m[2]));
  }
  return out;
}

function encodeRoute(pair: string, r: Route): string {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const via = STABLE[r.via];
  if (r.kind === "v3") {
    const path = via === WETH
      ? ethers.solidityPacked(["address", "uint24", "address"], [WETH, r.fee, pair])
      : ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WETH, 500, via, r.fee, pair]);
    return abi.encode(["bytes", KEY_T], [path, ZERO_KEY]);
  }
  const path = via === WETH ? "0x" : ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, via]);
  const [c0, c1] = [via, pair].map((a) => a.toLowerCase()).sort();
  return abi.encode(["bytes", KEY_T], [path, { currency0: c0, currency1: c1, fee: r.fee, tickSpacing: r.tickSpacing ?? 60, hooks: r.hooks ?? ethers.ZeroAddress }]);
}

/** Writes `amount` into the token's balance mapping for `holder`, finding the
 *  mapping slot by probing. Returns the slot used, or null. */
async function fund(token: string, holder: string, amount: bigint, hint?: string): Promise<string | null> {
  const erc = new ethers.Contract(token, ERC20, ethers.provider);
  const candidates = [hint, OZ_ERC20_SLOT, ...Array.from({ length: 60 }, (_, i) => ethers.toBeHex(i, 32))].filter((x): x is string => !!x);
  const value = ethers.zeroPadValue(ethers.toBeHex(amount), 32);
  for (const slot of candidates) {
    const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [holder, slot]));
    const before = await ethers.provider.getStorage(token, key);
    await network.provider.send("hardhat_setStorageAt", [token, key, value]);
    const bal = (await erc.balanceOf(holder)) as bigint;
    if (bal === amount) return slot;
    await network.provider.send("hardhat_setStorageAt", [token, key, before]);
  }
  return null;
}

async function main() {
  const dep = JSON.parse(fs.readFileSync(process.env.DEPLOY_FILE!, "utf8"));
  const only = process.env.ONLY?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const routes = loadRoutes();
  const [creator, trader, ethTrader] = await ethers.getSigners();
  const factory = await ethers.getContractAt("StockPadFactory", dep.contracts.factory, creator);
  const router = await ethers.getContractAt("StockPadRouter", dep.contracts.router);
  const feeRecipient: string = await factory.feeRecipient();
  const quotes: { symbol: string; address: string; usd: number }[] = dep.quotes.filter((q: { address: string }) => q.address.toLowerCase() !== WETH.toLowerCase());
  const out = path.join(__dirname, "..", "deployments", "ethereum-stock-rewards-check.json");
  // RESUME=1 keeps earlier passes from the output file and re-checks the rest.
  const prior: Result[] = process.env.RESUME === "1" && fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")).results : [];
  const done = new Set(prior.filter((r) => r.ok).map((r) => r.address.toLowerCase()));
  const list = (only ? quotes.filter((q) => only.includes(q.symbol.toLowerCase()) || only.includes(q.address.toLowerCase())) : quotes).filter((q) => !done.has(q.address.toLowerCase()));
  console.log(`checking ${list.length} stock pairs on factory ${dep.contracts.factory}${done.size ? ` (${done.size} already passed)` : ""}`);
  const results: Result[] = prior.filter((r) => r.ok);
  let slotHint: string | undefined;
  const bn = async (v: bigint) => ethers.formatEther(v);

  for (const [i, q] of list.entries()) {
    const r: Result = { symbol: q.symbol, address: q.address, usd: q.usd, funded: false, launched: false, buyPair: false, sellPair: false, holderPending: "0", creatorFees: "0", platformFees: "0", claimHolder: false, claimCreator: false, claimPlatform: false, ethRoute: routes.has(q.address.toLowerCase()), ok: false };
    const stock = new ethers.Contract(q.address, ERC20, trader);
    const step = async <T,>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try { return await fn(); } catch (e) { r.error = r.error ?? `${name}: ${String((e as Error).message ?? e).slice(0, 160)}`; return undefined; }
    };
    try {
      // 1. fund the trader with about $2,000 of the stock (a buy of ~$150 follows).
      const amount = ethers.parseEther(String(Math.max(1, Math.round(2000 / Math.max(q.usd, 0.01)))));
      const slot = await fund(q.address, trader.address, amount, slotHint);
      if (!slot) { r.error = "could not set a balance (unknown storage layout)"; results.push(r); console.log(`${i + 1}/${list.length} ${q.symbol}: NO BALANCE SLOT`); continue; }
      slotHint = slot; r.funded = true; r.slot = slot;

      // 2. launch a coin paired with the stock.
      const n = Number(await factory.totalTokens());
      const salt = ethers.zeroPadValue(ethers.toBeHex(Date.now() + i), 32);
      const launched = await step("launch", async () => { await (await factory.launch({ name: `${q.symbol} Test`, symbol: "T" + q.symbol.replace(/on$/i, "").slice(0, 8), metadataURI: "{}", pair: q.address }, salt, "0x")).wait(); return true; });
      if (!launched) { results.push(r); console.log(`${i + 1}/${list.length} ${q.symbol}: LAUNCH FAILED ${r.error}`); continue; }
      r.launched = true;
      const coinAddr: string = await factory.allTokens(n);
      const coin = await ethers.getContractAt("StockPadToken", coinAddr, trader);
      // past the anti-snipe window: 3 protected blocks, 20 s fee decay.
      await network.provider.send("evm_increaseTime", [30]);
      for (let k = 0; k < 4; k++) await network.provider.send("evm_mine", []);

      // 3. buy with the stock, then check accruals.
      const buyIn = ethers.parseEther(String(Math.max(0.0001, 150 / Math.max(q.usd, 0.01)).toFixed(6)));
      await step("approve", async () => (await stock.approve(await router.getAddress(), ethers.MaxUint256)).wait());
      r.buyPair = !!(await step("buyWithPair", async () => { await (await router.connect(trader).buyWithPair(coinAddr, buyIn, 0)).wait(); return true; }));
      if (r.buyPair) {
        // 4. sell half back for the stock. Holder rewards come from other
        //    people's trades, so the sell is what credits the trader.
        await step("approve coin", async () => (await coin.approve(await router.getAddress(), ethers.MaxUint256)).wait());
        const half = ((await coin.balanceOf(trader.address)) as bigint) / 2n;
        r.sellPair = !!(await step("sellForPair", async () => { await (await router.connect(trader).sellForPair(coinAddr, half, 0)).wait(); return true; }));
        r.holderPending = await bn(await coin.pendingRewards(trader.address));
        r.creatorFees = await bn(await coin.creatorFees());
        r.platformFees = await bn(await coin.platformFees());
        // 5. claims, each measured as a balance change in the stock.
        const balT = (await stock.balanceOf(trader.address)) as bigint;
        r.claimHolder = !!(await step("claimRewards", async () => { await (await coin.claimRewards()).wait(); return ((await stock.balanceOf(trader.address)) as bigint) > balT; }));
        const balC = (await stock.balanceOf(creator.address)) as bigint;
        r.claimCreator = !!(await step("claimCreatorFees", async () => { await (await coin.connect(creator).claimCreatorFees(false, 0, "0x")).wait(); return ((await stock.balanceOf(creator.address)) as bigint) > balC; }));
        const balP = (await stock.balanceOf(feeRecipient)) as bigint;
        r.claimPlatform = !!(await step("claimPlatformFees", async () => { await (await coin.claimPlatformFees()).wait(); return ((await stock.balanceOf(feeRecipient)) as bigint) > balP; }));
      }

      // 6. ETH route, when the stock has one: buy and sell in ETH, claim as ETH.
      const route = routes.get(q.address.toLowerCase());
      if (route) {
        const enc = encodeRoute(q.address, route);
        r.buyEth = !!(await step("buy(eth)", async () => { await (await router.connect(ethTrader).buy(coinAddr, enc, 0, { value: ethers.parseEther("0.05") })).wait(); return true; }));
        if (r.buyEth) {
          await step("approve coin (eth)", async () => (await coin.connect(ethTrader).approve(await router.getAddress(), ethers.MaxUint256)).wait());
          const half = ((await coin.balanceOf(ethTrader.address)) as bigint) / 2n;
          r.sellEth = !!(await step("sell(eth)", async () => { await (await router.connect(ethTrader).sell(coinAddr, half, enc, 0)).wait(); return true; }));
          const pending = (await coin.pendingRewards(ethTrader.address)) as bigint;
          const ethBefore = await ethers.provider.getBalance(ethTrader.address);
          r.claimAsEth = pending > 0n && !!(await step("claimRewardsAsEth", async () => { const tx = await coin.connect(ethTrader).claimRewardsAsEth(0, enc); const rc = await tx.wait(); const gas = rc!.gasUsed * rc!.gasPrice; return (await ethers.provider.getBalance(ethTrader.address)) + gas > ethBefore; }));
        }
      }
      r.ok = r.launched && r.buyPair && r.sellPair && Number(r.holderPending) > 0 && Number(r.creatorFees) > 0 && Number(r.platformFees) > 0 && r.claimHolder && r.claimCreator && r.claimPlatform && (!route || (!!r.buyEth && !!r.sellEth && !!r.claimAsEth));
    } catch (e) {
      r.error = r.error ?? String((e as Error).message ?? e).slice(0, 200);
    }
    results.push(r);
    console.log(`${i + 1}/${list.length} ${q.symbol.padEnd(9)} ${r.ok ? "OK " : "BAD"} holder=${Number(r.holderPending).toPrecision(3)} creator=${Number(r.creatorFees).toPrecision(3)} platform=${Number(r.platformFees).toPrecision(3)}${r.ethRoute ? ` eth:${r.buyEth ? "buy" : "-"}/${r.sellEth ? "sell" : "-"}/${r.claimAsEth ? "claim" : "-"}` : ""}${r.error ? `  ${r.error}` : ""}`);
  }

  fs.writeFileSync(out, JSON.stringify({ checkedAt: new Date().toISOString(), factory: dep.contracts.factory, total: results.length, ok: results.filter((r) => r.ok).length, results }, null, 1));
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length - bad.length}/${results.length} pairs pay rewards end to end. ${bad.length ? "Failures:" : ""}`);
  for (const b of bad) console.log(`  ${b.symbol} ${b.address}: ${b.error ?? "accrual or claim came back empty"}`);
  console.log("wrote", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
