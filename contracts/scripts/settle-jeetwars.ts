import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/** Settle a Jeet Wars round (anyone may):  ROUND=0 npx hardhat run scripts/settle-jeetwars.ts --network robinhood */
async function main() {
  const [me] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "bsc-jeetwars.json"), "utf8"));
  const arena = await ethers.getContractAt("JeetWarsArena", d.contracts.arena, me);
  const hook = await ethers.getContractAt("JeetWarsHook", d.contracts.hook, me);
  const r = Number(process.env.ROUND ?? 0);
  const coins: string[] = await arena.roundCoins(r);
  console.log("round", r, "coins", coins, "| bell", new Date(Number(await arena.bellOf(r)) * 1000).toISOString());
  const tx = await arena.settle(r, { gasLimit: 2_000_000n });
  const rc = await tx.wait();
  const R = await arena.rounds(r);
  console.log("settled tx", tx.hash, "gas", rc!.gasUsed.toString());
  console.log("winner", R.winner, "| loot", ethers.formatEther(R.loot), "| finalized", R.finalized, "| hits", R.hits.toString());
  for (const c of coins) {
    const info = await arena.coins(c);
    const p = await hook.pool(info.poolId);
    console.log(" ", c, "status", p.status.toString(), "(1 won, 2 lost) | tradable", await hook.tradable(info.poolId), "| liquidity", (await arena.liquidityOf(c)).toString());
  }
}
main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
