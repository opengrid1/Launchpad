/* eslint-disable no-console */
// Launch a coin on Inkypump (Ink) from the deployer wallet. Parameters come from the environment:
//   NAME, SYMBOL, DESC, PAIR (ETH or a stock symbol), BASKET (comma-separated stock symbols, empty for none),
//   REWARDS (1/0), IMAGE, WEBSITE, X, TELEGRAM, DEV_BUY (ETH, default 0)
//
//   NAME="Ink Inu" SYMBOL=INU BASKET=NVDAx,SPYx REWARDS=1 HARDHAT_CONFIG=hardhat.config.size.ts \
//   ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com ROBINHOOD_CHAIN_ID=57073 npx hardhat run scripts/launch-token-ink.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const NO_ROUTE = "0x";
const retry = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 0; i < 8; i++) { try { return await fn(); } catch { await new Promise(r => setTimeout(r, 1500)); } } return fn(); };

async function main() {
  const [me] = await ethers.getSigners();
  const file = path.join(__dirname, "..", "deployments", "ink-inkypump.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const stocks: Record<string, string> = Object.fromEntries((dep.quotes || []).filter((q: any) => q.symbol).flatMap((q: any) => [[q.symbol, q.address], [q.symbol.replace(/^w/, ""), q.address]]));
  const name = process.env.NAME!, symbol = process.env.SYMBOL!;
  if (!name || !symbol) throw new Error("NAME and SYMBOL are required");
  const rewards = process.env.REWARDS !== "0";
  const basketSyms = (process.env.BASKET || "").split(",").map(s => s.trim()).filter(Boolean);
  const basket = basketSyms.map(s => { const a = stocks[s]; if (!a) throw new Error("unknown stock " + s + " (known: " + Object.keys(stocks).join(", ") + ")"); return a; });
  const pairSym = process.env.PAIR || "ETH"; const pair = pairSym === "ETH" ? WETH : stocks[pairSym]; if (!pair) throw new Error("unknown pair " + pairSym);
  const meta: Record<string, string> = {}; for (const [k, env] of [["description", "DESC"], ["image", "IMAGE"], ["website", "WEBSITE"], ["x", "X"], ["telegram", "TELEGRAM"]]) if (process.env[env]) meta[k] = process.env[env]!;
  const devBuy = ethers.parseEther(process.env.DEV_BUY || "0");
  const factory = await ethers.getContractAt("InkypumpFactory", dep.contracts.factory, me);
  console.log("launching", name, symbol, "pair", pairSym, "rewards", rewards, "basket", basketSyms.join(",") || "none", "dev buy", ethers.formatEther(devBuy), "ETH from", me.address);
  const n = Number(await factory.totalTokens());
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const tx = await factory.launch({ name, symbol, metadataURI: JSON.stringify(meta), pair, minPairOut: 0, basket, holderRewards: rewards }, salt, NO_ROUTE, { value: devBuy });
  const rc = await tx.wait();
  const token = await retry(() => factory.allTokens(n));
  const coin = await ethers.getContractAt("InkypumpToken", token, me);
  console.log("launched", token, "tx", rc!.hash, "block", rc!.blockNumber);
  console.log("name", await coin.name(), "symbol", await coin.symbol(), "creatorBps", (await coin.creatorBps()).toString(), "holderBps", (await coin.holderBps()).toString(), "basket", await coin.basketAssets());
  dep.launches = dep.launches || []; dep.launches.push({ token, name, symbol, launchTx: rc!.hash, block: rc!.blockNumber, creator: me.address, pair: pairSym, basket: basketSyms, rewards });
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
