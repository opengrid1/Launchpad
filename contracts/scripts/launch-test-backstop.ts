// Launches one coin on the live Etherhook factory from the configured wallet (DEPLOYER_ENV).
// DRY=1 only estimates gas and cost. Optional DEV_BUY_ETH buys at launch.
//   DRY=1 npx hardhat --config hardhat.config.backstop.ts run scripts/launch-test-backstop.ts --network mainnet
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-backstop.json"), "utf8"));
const NAME = process.env.COIN_NAME ?? "Hook Test";
const SYMBOL = process.env.COIN_SYMBOL ?? "HOOKT";
const DESC = process.env.COIN_DESC ?? "Test launch on Etherhook.";
const IMAGE = process.env.COIN_IMAGE_FILE ? fs.readFileSync(process.env.COIN_IMAGE_FILE, "utf8").trim() : (process.env.COIN_IMAGE ?? "");
const WEBSITE = process.env.COIN_WEBSITE ?? "";
const X = process.env.COIN_X ?? "https://x.com/etherhook_fun";
// defaults: the site's "Strategy" preset at 2.5% tax (0.3% creator, 0.7% vault, 0.5% dip buyback, +1% platform)
const TAX = Number(process.env.TAX_BPS ?? 250);
const DYN_MAX = Number(process.env.DYN_MAX_BPS ?? 0); // 0 = flat tax; else tax rises with trade size up to this
const SPLIT = JSON.parse(process.env.SPLIT ?? '{"creator":30,"holders":0,"vault":70,"buyback":50,"lp":0,"burn":0}');
const OPTIONS = JSON.parse(process.env.OPTIONS ?? '{"tpBps":5000,"redeemable":false,"vestSecs":0,"payout":0}');

async function main() {
  const [me] = await ethers.getSigners();
  const factory = await ethers.getContractAt("BackstopFactory", dep.contracts.factory, me);
  const devBuy = ethers.parseEther(process.env.DEV_BUY_ETH ?? "0");
  const params = {
    name: NAME, symbol: SYMBOL,
    metadataURI: JSON.stringify({ description: DESC, image: IMAGE, website: WEBSITE, x: X, telegram: "" }),
    pair: ethers.ZeroAddress, minPairOut: 0,
    rules: { taxBps: TAX, dynMaxBps: DYN_MAX, snipeBps: 9000, snipeSecs: 60, maxTxBps: 0, mev: true },
    split: SPLIT,
    options: OPTIONS,
    basket: [], sources: [],
  };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const bal = await ethers.provider.getBalance(me.address);
  const fee = await ethers.provider.getFeeData();
  const gas = await factory.launch.estimateGas(params, salt, "0x", { value: devBuy });
  const price = fee.gasPrice!;
  console.log(`wallet ${me.address} balance ${ethers.formatEther(bal)} ETH`);
  console.log(`gas ${gas} at ${ethers.formatUnits(price, "gwei")} gwei = ${ethers.formatEther(gas * price)} ETH (+ dev buy ${ethers.formatEther(devBuy)})`);
  if (process.env.DRY) return;
  const gasLimit = (gas * 12n) / 10n;
  if (bal < gasLimit * price + devBuy) throw new Error("not enough ETH for gas");
  const tx = await factory.launch(params, salt, "0x", { value: devBuy, gasLimit, gasPrice: price });
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  const ev = rc!.logs.map(l => { try { return factory.interface.parseLog(l); } catch { return null; } }).find(e => e && e.name === "Launched");
  console.log(`launched ${SYMBOL} token ${ev!.args.token} strategy ${ev!.args.strategy} gasUsed ${rc!.gasUsed}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
