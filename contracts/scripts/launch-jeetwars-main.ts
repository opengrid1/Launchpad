import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Launch $JEETWARS ("Jeetwars.fun") in the Jeet Wars arena through a
 * JeetWarsCreatorForwarder, so the creator's 0.7% share and the first-buy
 * coins go to the team wallet (TO) forever.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://bsc-dataseed.bnbchain.org ROBINHOOD_CHAIN_ID=56 \
 *   PRIVATE_KEY=... TO=0x... [FIRST_BUY_BNB=0.003] npx hardhat run scripts/launch-jeetwars-main.ts --network robinhood
 */
async function main() {
  const [me] = await ethers.getSigners();
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "bsc-jeetwars.json"), "utf8"));
  const to = process.env.TO;
  if (!to || !ethers.isAddress(to)) throw new Error("set TO to the team wallet");
  const firstBuy = ethers.parseEther(process.env.FIRST_BUY_BNB ?? "0.003");
  const meta = fs.readFileSync(path.join(__dirname, "..", "deployments", "jeetwars-official-meta.json"), "utf8");
  console.log("operator", me.address, "BNB", ethers.formatEther(await ethers.provider.getBalance(me.address)), "| team wallet", to);

  const fwd = await (await ethers.getContractFactory("JeetWarsCreatorForwarder", me)).deploy(d.contracts.arena, to);
  await fwd.waitForDeployment();
  const fwdAddr = await fwd.getAddress();
  console.log("forwarder", fwdAddr);

  const arena = await ethers.getContractAt("JeetWarsArena", d.contracts.arena, me);
  const tx = await fwd.launch({ name: "Jeetwars.fun", symbol: "JEETWARS", metadataURI: meta, army: 0 }, { value: firstBuy, gasLimit: 6_000_000n });
  const rc = await tx.wait();
  const ev = rc!.logs.map((l: any) => { try { return arena.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Launched");
  const coin: string = ev!.args.coin;
  const info = await arena.coins(coin);
  const token = await ethers.getContractAt("JeetWarsToken", coin, me);
  console.log("launched", await token.name(), "$" + (await token.symbol()), coin);
  console.log("  tx", tx.hash, "gas", rc!.gasUsed.toString());
  console.log("  creator", info.creator, "| round", info.round.toString(), "| bell", new Date(Number(await arena.bellOf(info.round)) * 1000).toISOString());
  console.log("  first buy coins to team wallet", ethers.formatEther(await token.balanceOf(to)), "| forwarder holds", ethers.formatEther(await token.balanceOf(fwdAddr)));
  console.log("  pool liquidity", (await arena.liquidityOf(coin)).toString());

  if (network.name !== "hardhat") {
    try { await run("verify:verify", { address: fwdAddr, constructorArguments: [d.contracts.arena, to], contract: "contracts/jeetwars/JeetWarsCreatorForwarder.sol:JeetWarsCreatorForwarder" }); } catch (e: any) { console.log("verify:", String(e.message).split("\n")[0]); }
    d.officialToken = { name: "Jeetwars.fun", symbol: "JEETWARS", address: coin, round: Number(info.round), forwarder: fwdAddr, launchTx: tx.hash };
    fs.writeFileSync(path.join(__dirname, "..", "deployments", "bsc-jeetwars.json"), JSON.stringify(d, null, 2));
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
