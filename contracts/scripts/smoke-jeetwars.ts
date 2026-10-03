import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Mainnet smoke test for Jeet Wars: launch one small test coin with a tiny
 * first buy, buy and sell through the router, and check the 2% fee landed.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://bsc-dataseed.bnbchain.org ROBINHOOD_CHAIN_ID=56 \
 *   PRIVATE_KEY=... npx hardhat run scripts/smoke-jeetwars.ts --network robinhood
 */
const NAME = process.env.SMOKE_NAME ?? "Jeet Wars Test";
const SYMBOL = process.env.SMOKE_SYMBOL ?? "JWTEST";
const FIRST_BUY = ethers.parseEther(process.env.SMOKE_FIRST_BUY ?? "0.001");
const BUY = ethers.parseEther(process.env.SMOKE_BUY ?? "0.002");

async function main() {
  const [me] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "bsc-jeetwars.json"), "utf8"));
  const arena = await ethers.getContractAt("JeetWarsArena", d.contracts.arena, me);
  const router = await ethers.getContractAt("JeetWarsRouter", d.contracts.router, me);
  const hook = await ethers.getContractAt("JeetWarsHook", d.contracts.hook, me);
  const fmt = ethers.formatEther;
  console.log("wallet", me.address, "BNB", fmt(await ethers.provider.getBalance(me.address)));
  console.log("round now", (await arena.currentRound()).toString());

  const tx = await arena.launch({ name: NAME, symbol: SYMBOL, metadataURI: "", army: 0 }, { value: FIRST_BUY, gasLimit: 3_500_000n });
  const rc = await tx.wait();
  const ev = rc!.logs.map((l: any) => { try { return arena.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Launched");
  const coinAddr: string = ev!.args.coin;
  const coin = await ethers.getContractAt("JeetWarsToken", coinAddr, me);
  const info = await arena.coins(coinAddr);
  console.log("launched", SYMBOL, coinAddr, "round", info.round.toString(), "tx", tx.hash, "gas", rc!.gasUsed.toString());
  console.log("  first buy out", fmt(ev!.args.firstBuyOut), "| pool liquidity", (await arena.liquidityOf(coinAddr)).toString());
  console.log("  bell", new Date(Number(await arena.bellOf(info.round)) * 1000).toISOString(), "| tradable", await hook.tradable(info.poolId));

  // Past the launch-protection blocks.
  const start = await ethers.provider.getBlockNumber();
  while ((await ethers.provider.getBlockNumber()) < start + 4) await new Promise((r) => setTimeout(r, 1500));

  const before = await coin.balanceOf(me.address);
  const b = await router.buy(coinAddr, 0, me.address, { value: BUY, gasLimit: 600_000n });
  await b.wait();
  const got = (await coin.balanceOf(me.address)) - before;
  console.log("bought", fmt(got), SYMBOL, "for", fmt(BUY), "BNB tx", b.hash);

  const half = got / 2n;
  await (await coin.approve(d.contracts.router, half)).wait();
  const s = await router.sell(coinAddr, half, 0, me.address, { gasLimit: 600_000n });
  await s.wait();
  console.log("sold", fmt(half), SYMBOL, "tx", s.hash);

  const fees = (await coin.totalCreatorFees()) + (await coin.totalPlatformFees()) + (await coin.totalHolderRewards());
  console.log("fees in coin", fmt(fees), "BNB | creator", fmt(await coin.creatorFees()), "| platform", fmt(await coin.platformFees()), "| holders", fmt(await coin.totalHolderRewards()));
  console.log("pending rewards (me)", fmt(await coin.pendingRewards(me.address)));
  console.log("wallet BNB left", fmt(await ethers.provider.getBalance(me.address)));

  const outFile = path.join(__dirname, "..", "deployments", "bsc-jeetwars.json");
  d.smokeCoin = { symbol: SYMBOL, address: coinAddr, round: Number(info.round), launchTx: tx.hash };
  fs.writeFileSync(outFile, JSON.stringify(d, null, 2));
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
