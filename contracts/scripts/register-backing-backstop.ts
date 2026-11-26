/* eslint-disable no-console */
// Registers backing tokens on the Etherhook oracle from their Uniswap pools (open to anyone).
// For each token, candidates are tried in order (V3 first, it has a built-in 30-minute average);
// the first the oracle accepts wins. Skips tokens that already have a price. Input: CANDS json
// [{symbol, token, cands: [{dex, pool, label, depth}]}].
//   fork:    FORK=1 CANDS=... npx hardhat --config hardhat.config.backstop.ts run scripts/register-backing-backstop.ts
//   mainnet: DEPLOYER_ENV=.env.backstop-admin GAS_PRICE_GWEI=0.4 CANDS=... npx hardhat ... --network mainnet
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const DEP = path.join(__dirname, "..", "deployments", "eth-backstop.json");
const Z = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };

async function main() {
  const dep = JSON.parse(fs.readFileSync(DEP, "utf8"));
  const list: any[] = JSON.parse(fs.readFileSync(process.env.CANDS!, "utf8"));
  const [me] = await ethers.getSigners();
  const oracle = await ethers.getContractAt("BackstopOracle", dep.contracts.oracle, me);
  console.log(`network ${network.name}, sender ${me.address}, balance ${ethers.formatEther(await ethers.provider.getBalance(me.address))} ETH`);
  dep.sources = dep.sources ?? {};
  for (const t of list) {
    const [l, s] = await Promise.all([oracle.listed(t.token), oracle.sources(t.token)]);
    if (l.listed || Number(s.dex) !== 0) { console.log(`${t.symbol}: already priced`); continue; }
    // V3 counts five times its depth (its 30-minute average is built in), so a much deeper V2 pair still wins
    const score = (c: any) => c.depth * (c.dex === 2 ? 5 : 1);
    const order = [...t.cands].filter((c: any) => c.depth >= 20000).sort((a: any, b: any) => score(b) - score(a));
    let done = false;
    for (const c of order) {
      try { await oracle.register.staticCall({ dex: c.dex, pool: c.pool, key: Z }); } catch (e: any) { console.log(`  ${t.symbol} ${c.label}: ${(e.shortMessage ?? e.message).slice(0, 60)}`); continue; }
      const tx = await oracle.register({ dex: c.dex, pool: c.pool, key: Z }); const rc = await tx.wait();
      dep.sources[t.symbol] = c.pool; if (network.name === "mainnet") fs.writeFileSync(DEP, JSON.stringify(dep, null, 2));
      let px = "?"; try { px = (Number(await oracle.price(t.token)) / 1e18).toPrecision(6); } catch {}
      console.log(`${t.symbol}: registered ${c.label} (${rc!.gasUsed} gas), price per 1e18 units $${px}`); done = true; break;
    }
    if (!done) console.log(`${t.symbol}: no pool accepted`);
  }
}
main().catch((e) => { console.error(e.shortMessage ?? e.message); process.exit(1); });
