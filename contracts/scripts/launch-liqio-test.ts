import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Launch one test coin on the deployed Liqio contracts from the deployer, with a small dev buy, and read it back.
 * Proves the live stack end to end (clone, pool, oracle price, hook registration, dev buy) and gives the site
 * its first coin.
 *
 *   LIQIO_TEST_NAME="Liqio Test" LIQIO_TEST_SYMBOL=LQT LIQIO_DEV_HYPE=0.02 npx hardhat run scripts/launch-liqio-test.ts --network hyperevm
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/liqio-${network.name}.json`), "utf8"));
  const factory = await ethers.getContractAt("LiqioFactory", dep.contracts.factory);
  const hook = await ethers.getContractAt("EquoHook", dep.contracts.hook);
  const name = process.env.LIQIO_TEST_NAME ?? "Liqio Test";
  const symbol = process.env.LIQIO_TEST_SYMBOL ?? "LQT";
  const dev = ethers.parseEther(process.env.LIQIO_DEV_HYPE ?? "0.02");
  // optional instincts: LIQIO_DIV_BPS (holder rewards share), LIQIO_BB_BPS and LIQIO_BB_THRESHOLD_HYPE (buyback share and trigger)
  const divShareBps = Number(process.env.LIQIO_DIV_BPS ?? 0), buybackShareBps = Number(process.env.LIQIO_BB_BPS ?? 0);
  const buybackThreshold = buybackShareBps ? ethers.parseEther(process.env.LIQIO_BB_THRESHOLD_HYPE ?? "0.05") : 0n;
  const genes = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps, divShareBps, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold };
  const meta = JSON.stringify({ description: process.env.LIQIO_TEST_DESC ?? "First coin on Liqio: a plain HYPE-paired test launch from the deployer." });
  const p = { name, symbol, metadataURI: meta, pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [] as any[] };
  const salt = ethers.id(`liqio-test-${Date.now()}`);
  const before = await ethers.provider.getBalance(deployer.address);
  console.log(`launching ${name} (${symbol}) on ${network.name} from ${deployer.address}, dev buy ${ethers.formatEther(dev)} HYPE`);
  const gas = await factory.launch.estimateGas(p, salt, "0x", "0x", { value: dev });
  console.log("estimated gas", gas.toString());
  const rc = await (await factory.launch(p, salt, "0x", "0x", { value: dev, gasLimit: (gas * 12n) / 10n })).wait();
  const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
  const token = ev!.args.token as string;
  console.log(`launched ${token} in block ${rc!.blockNumber}, gas used ${rc!.gasUsed}, pair price $${ethers.formatUnits(ev!.args.pairUsdPrice, 18)}`);
  const coin = await ethers.getContractAt(divShareBps ? "LiqioDivToken" : "LiqioToken", token);
  console.log("name/symbol", await coin.name(), await coin.symbol(), "supply", ethers.formatEther(await coin.totalSupply()));
  console.log("creator holds", ethers.formatEther(await coin.balanceOf(deployer.address)), "cap", (await factory.capOf(token)).toString(), "creator", await hook.creatorOf(token));
  console.log("position liquidity", (await factory.positionOf(token)).liquidity.toString(), "total coins", (await factory.totalTokens()).toString());
  console.log(`spent ${ethers.formatEther(before - (await ethers.provider.getBalance(deployer.address)))} HYPE including the dev buy`);
  console.log(`explorer: https://hyperevmscan.io/address/${token}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
