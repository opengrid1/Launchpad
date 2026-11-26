/* eslint-disable no-console */
// Launch the official Inkypump coin on Ink: Inkypump.fun (INKY), paired with ETH,
// holder rewards off (the 1.2% creator share goes to the creator wallet), no dev buy.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com \
//   ROBINHOOD_CHAIN_ID=57073 npx hardhat run scripts/launch-inky-ink.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const NO_ROUTE = "0x";
const META = {
  description: "The official coin of Inkypump, the memecoin launchpad on Ink. Paired with ETH on a Uniswap V4 pool whose liquidity is locked forever.",
  image: "https://www.inkypump.fun/img/pfp.png",
  website: "https://www.inkypump.fun",
  x: "https://x.com/inkypump_ink",
};
const retry = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 0; i < 8; i++) { try { return await fn(); } catch { await new Promise(r => setTimeout(r, 1500)); } } return fn(); };

async function main() {
  const [me] = await ethers.getSigners();
  const file = path.join(__dirname, "..", "deployments", "ink-inkypump.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  if (dep.official?.token) { console.log("already launched", dep.official.token); return; }
  const factory = await ethers.getContractAt("InkypumpFactory", dep.contracts.factory, me);
  console.log("creator", me.address, "bal", ethers.formatEther(await ethers.provider.getBalance(me.address)));
  const n = Number(await factory.totalTokens());
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const tx = await factory.launch(
    { name: "Inkypump.fun", symbol: "INKY", metadataURI: JSON.stringify(META), pair: WETH, minPairOut: 0, basket: [], holderRewards: false },
    salt, NO_ROUTE, { value: 0 },
  );
  const rc = await tx.wait();
  const token = await retry(() => factory.allTokens(n));
  const coin = await ethers.getContractAt("InkypumpToken", token, me);
  console.log("launched", token, "tx", rc!.hash, "block", rc!.blockNumber, "gas", rc!.gasUsed.toString());
  console.log("name", await coin.name(), "symbol", await coin.symbol(), "creatorBps", (await coin.creatorBps()).toString(), "holderBps", (await coin.holderBps()).toString(), "pair", await coin.pairAsset());
  dep.official = { token, launchTx: rc!.hash, block: rc!.blockNumber, creator: me.address, name: "Inkypump.fun", symbol: "INKY" };
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
