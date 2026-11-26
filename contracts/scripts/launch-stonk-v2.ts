import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Launches the Estonks main token (STONK) on the v2 factory, paired with ETH,
 * with a fixed rewards basket, then deploys the EstonksDistributor pointed at
 * it and records both in deployments/ethereum-estonks-v2.json. Name, logo,
 * description and links are copied from the first STONK. The admin then sets
 * the factory's fee recipient to the distributor.
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
 *   FIRST_BUY_ETH=0 npx hardhat run scripts/launch-stonk-v2.ts --network robinhood
 */
const V1_STONK = "0x3494c410caa17ad30391DA7F1Eb4554303fbDd99";
// NVDAon, AAPLon, GOOGLon, TSLAon: holders may claim equal parts of these.
const BASKET = [
  "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee",
  "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c",
  "0xba47214edd2bb43099611b208f75e4b42fdcfedc",
  "0xf6b1117ec07684d3958cad8beb1b302bfd21103f",
].map((a) => ethers.getAddress(a));

async function main() {
  const [signer] = await ethers.getSigners();
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const save = () => fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  const factory = await ethers.getContractAt("EstonksFactory", dep.contracts.factory, signer);
  const WETH: string = dep.uniswap.weth;
  const bal0 = await ethers.provider.getBalance(signer.address);
  console.log("signer", signer.address, "balance", ethers.formatEther(bal0), "factory", dep.contracts.factory);

  if (!dep.mainToken) {
    const old = await ethers.getContractAt(["function metadataURI() view returns (string)"], V1_STONK);
    const meta = JSON.parse(await old.metadataURI());
    console.log("metadata from the first STONK:", Object.keys(meta).join(", "), "| logo bytes", String(meta.logo ?? "").length);
    for (const s of BASKET) if (!(await factory.quoteAssets(s)).approved) throw new Error(`basket stock not approved: ${s}`);
    const firstBuy = ethers.parseEther(process.env.FIRST_BUY_ETH ?? "0");
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const params = { name: "Estonks", symbol: "STONK", metadataURI: JSON.stringify(meta), pair: WETH, minPairOut: 0n, basket: BASKET };
    const gas = await factory.launch.estimateGas(params, salt, "0x", { value: firstBuy });
    console.log("launch gas estimate", gas.toString(), "first buy", ethers.formatEther(firstBuy), "ETH");
    const tx = await factory.launch(params, salt, "0x", { value: firstBuy, gasLimit: (gas * 12n) / 10n });
    console.log("launch tx", tx.hash);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l) => { try { return factory.interface.parseLog(l as any); } catch { return null; } }).find((p) => p?.name === "Launched");
    if (!ev) throw new Error("no Launched event");
    Object.assign(dep, { mainToken: ev.args.token as string, mainTokenLaunchTx: tx.hash, mainTokenLaunchBlock: rc!.blockNumber, mainTokenPoolId: ev.args.poolId as string, mainTokenBasket: BASKET });
    save();
    console.log("STONK", dep.mainToken, "pool", ev.args.poolId);
  } else console.log("STONK already launched", dep.mainToken);

  if (!dep.contracts.distributor) {
    const d = await (await ethers.getContractFactory("EstonksDistributor")).deploy(dep.mainToken, WETH, dep.contracts.router);
    console.log("distributor tx", d.deploymentTransaction()?.hash);
    await d.waitForDeployment();
    dep.contracts.distributor = await d.getAddress();
    save();
    console.log("distributor", dep.contracts.distributor);
  } else console.log("distributor already deployed", dep.contracts.distributor);

  const stonk = await ethers.getContractAt("EstonksToken", dep.mainToken);
  console.log("check: symbol", await stonk.symbol(), "| basket", (await stonk.basketAssets()).join(","), "| creator", await stonk.creator(), "| owner", await stonk.owner());
  console.log("next: admin calls factory.setFeeRecipient(" + dep.contracts.distributor + ")");
  console.log("spent", ethers.formatEther(bal0 - (await ethers.provider.getBalance(signer.address))), "ETH");
}

main().catch((e) => { console.error(e); process.exit(1); });
