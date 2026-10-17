import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Launches the Estonks main token (STONK) through the live factory, paired with
 * ETH, then deploys the ChipDistributor pointed at it and records both in
 * deployments/ethereum-estonks.json. The admin then sets the factory's fee
 * recipient to the distributor (admin page or setFeeRecipient).
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
 *   FIRST_BUY_ETH=0.02 LOGO_FILE=/path/to/data-uri.txt npx hardhat run scripts/launch-stonk.ts --network robinhood
 */
async function main() {
  const [signer] = await ethers.getSigners();
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks.json");
  const dep = JSON.parse(fs.readFileSync(depFile, "utf8"));
  const factory = await ethers.getContractAt("StockPadFactory", dep.contracts.factory, signer);
  const WETH: string = dep.uniswap.weth;
  console.log("signer", signer.address, "balance", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "factory", dep.contracts.factory);

  if (!dep.mainToken) {
    const logo = process.env.LOGO_FILE ? fs.readFileSync(process.env.LOGO_FILE, "utf8").trim() : "";
    const meta = {
      description: "The Estonks main token. Hold STONK and you earn the platform share of every trade on every coin, paid in ETH. No staking, no lockup.",
      website: "https://estonks.fun",
      twitter: "https://x.com/estonks_fun",
      ...(logo ? { logo } : {}),
    };
    const firstBuy = ethers.parseEther(process.env.FIRST_BUY_ETH ?? "0");
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const params = { name: "Estonks", symbol: "STONK", metadataURI: JSON.stringify(meta), pair: WETH };
    const gas = await factory.launch.estimateGas(params, salt, "0x", { value: firstBuy });
    console.log("launch gas estimate", gas.toString(), "first buy", ethers.formatEther(firstBuy), "ETH");
    const tx = await factory.launch(params, salt, "0x", { value: firstBuy, gasLimit: (gas * 12n) / 10n });
    console.log("launch tx", tx.hash);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l) => { try { return factory.interface.parseLog(l as any); } catch { return null; } }).find((p) => p?.name === "Launched");
    if (!ev) throw new Error("no Launched event");
    dep.mainToken = ev.args.token as string;
    dep.mainTokenLaunchTx = tx.hash;
    dep.mainTokenLaunchBlock = rc!.blockNumber;
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
    console.log("STONK", dep.mainToken, "pool", ev.args.poolId);
  } else console.log("STONK already launched", dep.mainToken);

  if (!dep.contracts.distributor) {
    const D = await ethers.getContractFactory("ChipDistributor");
    const d = await D.deploy(dep.mainToken, WETH, dep.contracts.router);
    console.log("distributor tx", d.deploymentTransaction()?.hash);
    await d.waitForDeployment();
    dep.contracts.distributor = await d.getAddress();
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
    console.log("distributor", dep.contracts.distributor);
  } else console.log("distributor already deployed", dep.contracts.distributor);

  console.log("next: admin calls factory.setFeeRecipient(" + dep.contracts.distributor + ")");
  console.log("balance after", ethers.formatEther(await ethers.provider.getBalance(signer.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
