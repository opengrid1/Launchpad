import { ethers, network, run } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Launch a coin on Estonks v2 through an EstonksCreatorForwarder, so the
 * creator's fee share goes to the team wallet (the Estonks admin) forever.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
 *   COIN_NAME=Uptober COIN_SYMBOL=UPTOBER META_FILE=deployments/estonks-uptober-meta.json \
 *   npx hardhat run scripts/launch-estonks-coin.ts --network robinhood
 */
// NVDAon, AAPLon, GOOGLon, TSLAon: the same reward basket as STONK.
const BASKET = ["0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee", "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c", "0xba47214edd2bb43099611b208f75e4b42fdcfedc", "0xf6b1117ec07684d3958cad8beb1b302bfd21103f"].map((a) => ethers.getAddress(a));

async function main() {
  const [me] = await ethers.getSigners();
  const depFile = path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const name = process.env.COIN_NAME!, symbol = process.env.COIN_SYMBOL!;
  const meta = fs.readFileSync(path.join(__dirname, "..", process.env.META_FILE!), "utf8");
  const to: string = dep.admin;
  const bal0 = await ethers.provider.getBalance(me.address);
  console.log("operator", me.address, "ETH", ethers.formatEther(bal0), "| creator share to", to);

  const fwd = await (await ethers.getContractFactory("EstonksCreatorForwarder", me)).deploy(dep.contracts.factory, to);
  await fwd.waitForDeployment();
  const fwdAddr = await fwd.getAddress();
  console.log("forwarder", fwdAddr);

  const factory = await ethers.getContractAt("EstonksFactory", dep.contracts.factory, me);
  const params = { name, symbol, metadataURI: meta, pair: dep.uniswap.weth, minPairOut: 0n, basket: BASKET };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const gas = await fwd.launch.estimateGas(params, salt, "0x");
  const tx = await fwd.launch(params, salt, "0x", { gasLimit: (gas * 12n) / 10n });
  const rc = await tx.wait();
  const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Launched");
  const token: string = ev!.args.token;
  const coin = await ethers.getContractAt("EstonksToken", token, me);
  console.log("launched", await coin.name(), "$" + (await coin.symbol()), token, "| tx", tx.hash, "gas", rc!.gasUsed.toString());
  console.log("  creator", await coin.creator(), "| pair", await coin.pairAsset(), "| basket", (await coin.basketAssets()).length, "stocks | pool", ev!.args.poolId);
  console.log("  spent", ethers.formatEther(bal0 - (await ethers.provider.getBalance(me.address))), "ETH");

  if (network.name !== "hardhat") {
    try { await run("verify:verify", { address: fwdAddr, constructorArguments: [dep.contracts.factory, to], contract: "contracts/v4/estonks/EstonksCreatorForwarder.sol:EstonksCreatorForwarder" }); } catch (e: any) { console.log("verify:", String(e.message).split("\n")[0]); }
    dep.coins = dep.coins || {};
    dep.coins[symbol] = { name, token, poolId: ev!.args.poolId, forwarder: fwdAddr, launchTx: tx.hash, basket: BASKET };
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  }
}

main().catch((e) => { console.error(e.shortMessage ?? e.message ?? e); process.exit(1); });
