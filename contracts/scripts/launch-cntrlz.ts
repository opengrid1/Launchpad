/* eslint-disable no-console */
// Launches a cntrl-z coin from the deployer wallet on mainnet (or a fork):
//   NAME="Ctrl Z Test" SYMBOL=CZT DESC="..." DEV_ETH=0.003 [PAIR=0x..] [IMAGE=data:image/webp;base64,...] [WEB=.. X=.. TG=..]
//   npx hardhat --config hardhat.config.cntrlz.ts run scripts/launch-cntrlz.ts --network mainnet
// A non-WETH pair needs the ETH route for the first buy; this script finds it from the oracle's source (V2/V3 pools).
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", network.name === "mainnet" ? "eth-cntrlz.json" : "eth-cntrlz-fork.json"), "utf8"));
  const c = dep.contracts;
  const [me] = await ethers.getSigners();
  const factory = await ethers.getContractAt("CtrlzFactory", c.factory);
  const pair = process.env.PAIR || WETH;
  const devEth = ethers.parseEther(process.env.DEV_ETH || "0");
  const meta: any = { description: process.env.DESC || "" };
  if (process.env.IMAGE) meta.image = process.env.IMAGE;
  if (process.env.WEB) meta.website = process.env.WEB;
  if (process.env.X) meta.x = process.env.X;
  if (process.env.TG) meta.telegram = process.env.TG;
  const params = { name: process.env.NAME || "Ctrl Z Test", symbol: process.env.SYMBOL || "CZT", metadataURI: JSON.stringify(meta), pair, minPairOut: 0 };
  let route = "0x";
  if (pair !== WETH && devEth > 0n) {
    const oracle = await ethers.getContractAt(["function sources(address) view returns (uint8 dex,address pool,address anchor,int24 slowTick,uint64 updatedAt,bytes32 v4Id,uint256 cumA,uint32 timeA,uint256 cumB,uint32 timeB)"], dep.oracle);
    const s = await oracle.sources(pair);
    if (Number(s.dex) !== 1 && Number(s.dex) !== 2) throw new Error("pair needs a V2/V3 ETH route; use the site for this pair");
    if (s.anchor !== WETH && s.anchor !== ethers.ZeroAddress) throw new Error("pair is anchored to a stablecoin; use the site for this pair");
    route = ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[{ dex: Number(s.dex), pool: s.pool, key: EMPTY_KEY }]]);
  }
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const fee: any = {};
  if (network.name === "mainnet") { const base = (await ethers.provider.getBlock("latest"))!.baseFeePerGas ?? 0n; const tip = ethers.parseUnits(process.env.TIP_GWEI ?? "0.05", "gwei"); fee.maxPriorityFeePerGas = tip; fee.maxFeePerGas = (base * 115n) / 100n + tip; }
  const bal = await ethers.provider.getBalance(me.address);
  const gas = await factory.launch.estimateGas(params, salt, route, { value: devEth });
  console.log("deployer", me.address, "balance", ethers.formatEther(bal), "ETH; launch gas", gas.toString(), "at", ethers.formatUnits(fee.maxFeePerGas ?? 0n, "gwei"), "gwei max");
  const tx = await factory.launch(params, salt, route, { value: devEth, gasLimit: (gas * 105n) / 100n, ...fee });
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  const topic = factory.interface.getEvent("Launched")!.topicHash;
  const log = rc!.logs.find((l) => l.topics[0] === topic)!;
  const token = ethers.getAddress("0x" + log.topics[1].slice(26));
  console.log("token", token, "gas used", rc!.gasUsed.toString(), "cost", ethers.formatEther(rc!.gasUsed * rc!.gasPrice), "ETH");
  console.log("left", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH");
  console.log(`https://www.cntrl-z.fun/coin/${token.toLowerCase()}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
