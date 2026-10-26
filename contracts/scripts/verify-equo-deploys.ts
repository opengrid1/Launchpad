// Reads every deployments/equo-<network>.json and checks the live contracts against it:
// admin, fee recipient, wiring, cashback, cap presets, minimum first buy, MEV band,
// 70/30 split, and that the deployer gave up its setup rights.
//   npx ts-node scripts/verify-equo-deploys.ts   (or: npx hardhat run scripts/verify-equo-deploys.ts)
import { ethers } from "ethers";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const RPC: Record<string, string> = {
  mainnet: "https://ethereum-rpc.publicnode.com",
  base: "https://mainnet.base.org",
  bsc: "https://bsc-dataseed.bnbchain.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  hyperevm: "https://rpc.hyperliquid.xyz/evm",
  monad: "https://rpc.monad.xyz",
  megaeth: "https://mainnet.megaeth.com/rpc",
  unichain: "https://unichain-rpc.publicnode.com",
};
const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
const F = [
  "function admin() view returns (address)", "function owner() view returns (address)", "function feeRecipient() view returns (address)",
  "function hook() view returns (address)", "function converter() view returns (address)", "function minFirstBuy() view returns (uint256)",
  "function capPresets() view returns (uint64[])", "function poolManager() view returns (address)", "function weth() view returns (address)",
];
const H = [
  "function factory() view returns (address)", "function router() view returns (address)", "function cashbackBps() view returns (uint16)",
  "function CREATOR_SPLIT_BPS() view returns (uint16)", "function MEV_FREE_PRIORITY() view returns (uint256)", "function MEV_PRIORITY_UNIT() view returns (uint256)",
];
const T = ["function factory() view returns (address)", "function endpoint() view returns (address)", "function setupBy() view returns (address)", "function tokenCreator() view returns (address)"];

async function main() {
  const dir = join(__dirname, "../deployments");
  const only = process.argv.slice(2);
  let bad = 0;
  for (const f of readdirSync(dir).filter((f) => /^equo-[a-z]+\.json$/.test(f))) {
    const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!RPC[d.network] || (only.length && !only.includes(d.network))) continue;
    if (!d.mevBand) continue; // deployments from before this release
    const p = new ethers.JsonRpcProvider(RPC[d.network], d.chainId, { staticNetwork: true });
    const c = d.contracts;
    const fac = new ethers.Contract(c.factory, F, p), hook = new ethers.Contract(c.hook, H, p), td = new ethers.Contract(c.tokenDeployer, T, p);
    const checks: [string, any, any][] = [
      ["factory.admin", await fac.admin(), ADMIN],
      ["factory.feeRecipient", await fac.feeRecipient(), ADMIN],
      ["factory.owner (renounced)", await fac.owner(), ethers.ZeroAddress],
      ["factory.hook", await fac.hook(), c.hook],
      ["factory.converter", await fac.converter(), c.router],
      ["factory.poolManager", await fac.poolManager(), c.poolManager],
      ["factory.weth", await fac.weth(), c.weth],
      ["factory.minFirstBuy", (await fac.minFirstBuy()).toString(), d.minFirstBuy],
      ["factory.capPresets", (await fac.capPresets()).map((v: bigint) => Number(v / 10n ** 8n)).join(","), "5000,12500,25000"],
      ["hook.factory", await hook.factory(), c.factory],
      ["hook.router", await hook.router(), c.router],
      ["hook.cashbackBps", Number(await hook.cashbackBps()), 2500],
      ["hook.CREATOR_SPLIT_BPS", Number(await hook.CREATOR_SPLIT_BPS()), 7000],
      ["hook.MEV band", `${await hook.MEV_FREE_PRIORITY()}/${await hook.MEV_PRIORITY_UNIT()}`, `${ethers.parseUnits(d.mevBand.freePriorityGwei, "gwei")}/${ethers.parseUnits(d.mevBand.priorityUnitGwei, "gwei")}`],
      ["tokenDeployer.factory", await td.factory(), c.factory],
      ["tokenDeployer.endpoint", await td.endpoint(), c.lzEndpoint],
      ["tokenDeployer.setupBy (ended)", await td.setupBy(), ethers.ZeroAddress],
      ["tokenDeployer.tokenCreator", await td.tokenCreator(), c.tokenCreator],
    ];
    const fails = checks.filter(([, got, want]) => String(got).toLowerCase() !== String(want).toLowerCase());
    console.log(`${d.network.padEnd(9)} factory ${c.factory}  ${fails.length ? "FAIL" : "ok"} (${checks.length - fails.length}/${checks.length})`);
    for (const [k, got, want] of fails) console.log(`   ${k}: got ${got}, want ${want}`);
    bad += fails.length;
  }
  if (bad) process.exitCode = 1;
}
main();
