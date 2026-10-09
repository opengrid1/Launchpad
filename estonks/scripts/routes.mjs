// Rescans every Ondo stock's pools on Ethereum mainnet and rewrites the `route`
// of each entry in src/lib/stocks.ts to the deepest one: Uniswap V3 (USDC, USDT
// or WETH at 0.05 / 0.3 / 1%) or a known Uniswap V4 key (deployments/ethereum-ondo-v4-keys.json).
// Depth is the pool's in-range liquidity L, comparable across tiers and versions.
//   node scripts/routes.mjs            (RPC from ROUTES_RPC, default publicnode)
import fs from "node:fs";
import { createPublicClient, http, parseAbi, keccak256, encodeAbiParameters } from "viem";
import { mainnet } from "viem/chains";

const RPC = process.env.ROUTES_RPC ?? "https://ethereum-rpc.publicnode.com";
const pc = createPublicClient({ chain: mainnet, transport: http(RPC, { timeout: 60_000, batch: { wait: 16, batchSize: 40 } }), batch: { multicall: { wait: 24, batchSize: 1024 } } });
const V3F = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const SV = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const STABLE = { USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7", WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" };
const v3fAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi(["function liquidity() view returns (uint128)"]);
const svAbi = parseAbi(["function getLiquidity(bytes32) view returns (uint128)", "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const KEY = [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }];
/** Minimum in-range liquidity to count as a route: below this a $100 buy blows through the range. */
const MIN_L = 10n ** 15n;

const src = fs.readFileSync("src/lib/stocks.ts", "utf8");
const entries = [...src.matchAll(/\{ symbol: "([^"]+)", ticker: "[^"]*", name: "[^"]*", address: "(0x[0-9a-f]{40})"[^\n]*\},?\n/g)].map((m) => ({ line: m[0], symbol: m[1], address: m[2] }));
console.log("stocks in roster:", entries.length);
const v4keys = JSON.parse(fs.readFileSync("../contracts/deployments/ethereum-ondo-v4-keys.json", "utf8"));
const v4ByAddr = new Map();
for (const k of Array.isArray(v4keys) ? v4keys : v4keys.keys ?? []) v4ByAddr.set(String(k.address).toLowerCase(), k);

// V3: every stable x fee, one multicall for pools then one for liquidity.
const combos = [];
for (const e of entries) for (const [via, viaAddr] of Object.entries(STABLE)) for (const fee of [500, 3000, 10000]) combos.push({ e, via, viaAddr, fee });
const pools = await pc.multicall({ allowFailure: true, contracts: combos.map((c) => ({ address: V3F, abi: v3fAbi, functionName: "getPool", args: [c.viaAddr, c.e.address, c.fee] })) });
const live = combos.map((c, i) => ({ ...c, pool: pools[i].status === "success" ? pools[i].result : "0x0000000000000000000000000000000000000000" })).filter((c) => c.pool !== "0x0000000000000000000000000000000000000000");
const liqs = await pc.multicall({ allowFailure: true, contracts: live.map((c) => ({ address: c.pool, abi: poolAbi, functionName: "liquidity" })) });
const best = new Map();
live.forEach((c, i) => { const L = liqs[i].status === "success" ? liqs[i].result : 0n; const cur = best.get(c.e.address); if (L >= MIN_L && (!cur || L > cur.L)) best.set(c.e.address, { L, route: { kind: "v3", via: c.via, fee: c.fee } }); });
// V4 keys from the deployments scan (USDC/USDT/WETH only, hookless), by StateView liquidity.
const v4 = entries.map((e) => ({ e, k: v4ByAddr.get(e.address) })).filter((x) => x.k && ["USDC", "USDT", "WETH"].includes(x.k.other) && /^0x0{40}$/.test(x.k.hooks));
if (v4.length) {
  const ids = v4.map(({ k }) => keccak256(encodeAbiParameters(KEY, [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks])));
  const L4 = await pc.multicall({ allowFailure: true, contracts: ids.map((id) => ({ address: SV, abi: svAbi, functionName: "getLiquidity", args: [id] })) });
  v4.forEach(({ e, k }, i) => { const L = L4[i].status === "success" ? L4[i].result : 0n; const cur = best.get(e.address); if (L >= MIN_L && (!cur || L > cur.L)) best.set(e.address, { L, route: { kind: "v4", via: k.other, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks } }); });
}
let out = src, changed = 0, routed = 0;
for (const e of entries) {
  const b = best.get(e.address);
  const stripped = e.line.replace(/, route: \{[^}]*\}/, "");
  const next = b ? stripped.replace(/ \},?\n$/, (m) => `, route: ${JSON.stringify(b.route)}${m}`) : stripped;
  if (b) routed++;
  if (next !== e.line) { out = out.replace(e.line, next); changed++; }
  console.log(e.symbol.padEnd(9), b ? `${b.route.kind} ${b.route.via} ${b.route.fee}  L=${b.L}` : "no route");
}
fs.writeFileSync("src/lib/stocks.ts", out);
console.log(`routed ${routed}/${entries.length}, ${changed} entries changed`);
