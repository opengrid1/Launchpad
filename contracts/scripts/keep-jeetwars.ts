import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Keeper for one Jeet Wars round: settle it once the bell has rung, then make
 * every merge hit as it comes due (3 minutes apart) until the round finalizes.
 *
 *   ROUND=1 HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://bsc-dataseed.bnbchain.org ROBINHOOD_CHAIN_ID=56 \
 *   PRIVATE_KEY=... npx hardhat run scripts/keep-jeetwars.ts --network robinhood
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [me] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "bsc-jeetwars.json"), "utf8"));
  const arena = await ethers.getContractAt("JeetWarsArena", d.contracts.arena, me);
  const r = Number(process.env.ROUND ?? 0);
  const fmt = ethers.formatEther;
  const coins: string[] = await arena.roundCoins(r);
  const names: Record<string, string> = {};
  for (const c of coins) names[c.toLowerCase()] = await (await ethers.getContractAt("JeetWarsToken", c, me)).symbol();
  console.log(`round ${r}: ${coins.length} coins (${Object.values(names).join(", ")}) | keeper ${me.address} BNB ${fmt(await ethers.provider.getBalance(me.address))}`);

  const bell = Number(await arena.bellOf(r));
  const now = () => Math.floor(Date.now() / 1000);
  if (now() < bell) { console.log(`waiting ${bell - now()}s for the bell`); await sleep((bell - now() + 5) * 1000); }

  let R = await arena.rounds(r);
  if (!R.settled) {
    const tx = await arena.settle(r, { gasLimit: 3_000_000n });
    const rc = await tx.wait();
    R = await arena.rounds(r);
    console.log(`settled tx ${tx.hash} gas ${rc!.gasUsed} | winner ${names[R.winner.toLowerCase()] ?? R.winner} | loot ${fmt(R.loot)} BNB`);
    for (const c of coins) if (c.toLowerCase() !== R.winner.toLowerCase()) console.log(`  K.O. ${names[c.toLowerCase()]}: pool ${fmt(await arena.lootOf(c))} BNB`);
  } else console.log(`already settled | winner ${names[R.winner.toLowerCase()] ?? R.winner}`);

  while (!R.finalized) {
    const due = Math.max(bell + Number(R.hits) * 180, Number(R.hits) > 0 ? Number(R.lastHit) + 180 : 0);
    if (now() < due) await sleep((due - now() + 4) * 1000);
    try {
      const tx = await arena.hit(r, { gasLimit: 1_500_000n });
      await tx.wait();
      R = await arena.rounds(r);
      console.log(`hit ${R.hits}/10 tx ${tx.hash} | spent ${fmt(R.spent)} / ${fmt(R.loot)} BNB | bought ${fmt(R.bought)}`);
    } catch (e: any) {
      console.log("hit not ready:", e.shortMessage ?? e.message);
      await sleep(15_000);
      R = await arena.rounds(r);
    }
  }
  console.log(`finalized round ${r} | winner ${names[R.winner.toLowerCase()] ?? R.winner} | bought ${fmt(R.bought)} | unspent ${fmt(R.loot - R.spent)} BNB | keeper BNB left ${fmt(await ethers.provider.getBalance(me.address))}`);
}

main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
