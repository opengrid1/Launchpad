/* eslint-disable no-console */
// Registers the Ondo tokenized stocks that have a deep enough Uniswap pool as
// Etherhook backing tokens (oracle.register is open to anyone). Resumable: skips
// tokens that already have a source. Pools come from ondo-sources.json, checked
// against the live oracle on a fork first.
//   GAS_PRICE_GWEI=0.32 npx hardhat --config hardhat.config.backstop.ts run scripts/register-ondo-backstop.ts --network mainnet
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const DEP = path.join(__dirname, "..", "deployments", "eth-backstop.json");
const SRC = path.join(__dirname, "..", "deployments", "ondo-sources.json");
const Z = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEP, "utf8"));
  const list: any[] = JSON.parse(fs.readFileSync(SRC, "utf8")).sources;
  const oracle = await ethers.getContractAt("BackstopOracle", dep.contracts.oracle);
  dep.sources = dep.sources ?? {};
  for (const s of list) {
    const cur = await oracle.sources(s.token);
    if (Number(cur.dex) !== 0) { console.log(`${s.symbol}: already registered`); dep.sources[s.symbol] = dep.sources[s.symbol] ?? (s.pool !== ethers.ZeroAddress ? s.pool : s.v4Id); continue; }
    try {
      const tx = await oracle.register({ dex: s.dex, pool: s.pool, key: s.key ?? Z });
      const rc = await tx.wait();
      dep.sources[s.symbol] = s.dex === 3 ? s.v4Id : s.pool;
      fs.writeFileSync(DEP, JSON.stringify(dep, null, 2));
      console.log(`${s.symbol}: registered (${rc!.gasUsed} gas) $${(Number(await oracle.price(s.token)) / 1e18).toFixed(2)}`);
    } catch (e: any) { console.log(`${s.symbol}: not registered (${(e.shortMessage ?? e.message).slice(0, 90)})`); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
