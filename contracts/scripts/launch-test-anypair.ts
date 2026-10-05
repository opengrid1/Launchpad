/* eslint-disable no-console */
// Launches one clearly-labelled test coin on the live Anypair factory, so the
// site has a real coin to try trading, charts and claims against.
//
//   DEPLOYER_ENV=.env.anypair-deployer HARDHAT_CONFIG=hardhat.config.size.ts \
//   ROBINHOOD_RPC_URL=https://mainnet.base.org ROBINHOOD_CHAIN_ID=8453 GAS_PRICE_WEI=20000000 \
//     npx hardhat run scripts/launch-test-anypair.ts --network robinhood
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
// optional: PAIR, BASKET (comma list), SOURCES and HOPS (JSON, as the launch form builds them), SIMULATE=1 for a dry call

async function main() {
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "base-anypair.json"), "utf8"));
  const [me] = await ethers.getSigners();
  const factory = await ethers.getContractAt("AnypairFactory", dep.contracts.factory);
  const buy = ethers.parseEther(process.env.BUY_ETH ?? "0.001");
  const meta = JSON.stringify({
    description: "Test coin for checking Anypair on Base: launch, trading, charts and holder rewards. Not an investment.",
    image: "https://www.anypair.world/img/logo-512.png",
    x: "https://x.com/anypair_world", website: "https://www.anypair.world", telegram: "",
  });
  const pair = process.env.PAIR ?? WETH;
  const basket = process.env.BASKET ? process.env.BASKET.split(",") : [];
  const sources = process.env.SOURCES ? JSON.parse(process.env.SOURCES) : [];
  const route = process.env.HOPS ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [JSON.parse(process.env.HOPS)]) : "0x";
  const p = { name: process.env.NAME ?? "Anypair Test", symbol: process.env.SYMBOL ?? "APTEST", metadataURI: meta, pair, minPairOut: 0, basket, holderRewards: true, sources };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  if (process.env.SIMULATE === "1") {
    const [token] = await factory.launch.staticCall(p, salt, route, { value: buy });
    const gas = await factory.launch.estimateGas(p, salt, route, { value: buy });
    console.log("simulation ok: would launch", token, "gas", gas.toString());
    return;
  }
  console.log("launcher", me.address, "bal", ethers.formatEther(await ethers.provider.getBalance(me.address)), "first buy", ethers.formatEther(buy), "ETH");
  // the new coin comes from the receipt's Launched event: a read right after the
  // tx can hit an RPC node that hasn't seen the block yet (and a blind retry
  // would launch a second coin)
  const tx = await factory.launch(p, salt, route, { value: buy });
  console.log("sent", tx.hash);
  const rc = await tx.wait(2);
  const ev = rc!.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Launched");
  const token: string = ev!.args.token;
  const coin = await ethers.getContractAt("AnypairToken", token);
  console.log("launched", p.symbol, token, "tx", rc!.hash, "block", rc!.blockNumber);
  try { console.log("creator holds", ethers.formatEther(await coin.balanceOf(me.address)), "of", ethers.formatEther(await coin.totalSupply())); } catch { /* lagging node */ }
  if (network.name === "hardhat") return; // fork rehearsal: keep the record clean
  dep.testCoins = [...(dep.testCoins ?? []), { token, symbol: p.symbol, tx: rc!.hash }];
  fs.writeFileSync(path.join(__dirname, "..", "deployments", "base-anypair.json"), JSON.stringify(dep, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
