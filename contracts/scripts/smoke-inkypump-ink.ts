/* eslint-disable no-console */
// Mainnet smoke test for Inkypump on Ink: launch a small test coin with a tiny
// first buy, buy and sell through the router, claim holder rewards, pay the
// creator and the platform. Uses the deployer key and the deployment record.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com \
//   ROBINHOOD_CHAIN_ID=57073 npx hardhat run scripts/smoke-inkypump-ink.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0x4200000000000000000000000000000000000006";
const NVDA = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5";
const SPY = "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540";
const NO_ROUTE = "0x";
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"];

// the public RPC is load-balanced and a fresh read can hit a node that has not seen the last block yet
const retry = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 0; i < 8; i++) { try { return await fn(); } catch { await new Promise(r => setTimeout(r, 1500)); } } return fn(); };

async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ink-inkypump.json"), "utf8"));
  const factory = await ethers.getContractAt("InkypumpFactory", dep.contracts.factory, me);
  const router = await ethers.getContractAt("InkypumpRouter", dep.contracts.router, me);
  const ledger = await ethers.getContractAt("InkypumpLedger", dep.contracts.ledger, me);
  const weth = await ethers.getContractAt(ERC20, WETH, me);
  const bal0 = await ethers.provider.getBalance(me.address);
  console.log("deployer", me.address, "bal", ethers.formatEther(bal0), "factory", dep.contracts.factory);

  const n = Number(await factory.totalTokens());
  let token: string;
  if (dep.smoke?.token) {
    token = dep.smoke.token;
    console.log("reusing smoke token", token);
  } else {
    const devBuy = ethers.parseEther(process.env.DEV_BUY ?? "0.0005");
    const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
    const tx = await factory.launch(
      { name: "Inkypump Test", symbol: "INKT", metadataURI: '{"description":"deployment smoke test, not a real launch"}', pair: WETH, minPairOut: 0, basket: [NVDA, SPY], holderRewards: true },
      salt, NO_ROUTE, { value: devBuy },
    );
    const rc = await tx.wait();
    token = await retry(() => factory.allTokens(n));
    dep.smoke = { token, launchTx: rc!.hash, devBuy: devBuy.toString() };
    fs.writeFileSync(path.join(__dirname, "..", "deployments", "ink-inkypump.json"), JSON.stringify(dep, null, 2));
    console.log("launched", token, "tx", rc!.hash, "gas", rc!.gasUsed.toString());
  }
  const coin = await ethers.getContractAt("InkypumpToken", token, me);
  console.log("coin balance after first buy", ethers.formatEther(await coin.balanceOf(me.address)), "basket", await coin.basketAssets(), "holderBps", (await coin.holderBps()).toString());

  // wait out the anti-snipe window so the buy pays the base fee
  const listing = await factory.listings(token);
  const launchTs = Number(listing.createdAt);
  const now = Math.floor(Date.now() / 1000);
  if (now - launchTs < 25) { const w = 25 - (now - launchTs); console.log("waiting", w, "s for the anti-snipe window"); await new Promise(r => setTimeout(r, w * 1000)); }

  // buy
  const buyEth = ethers.parseEther(process.env.BUY ?? "0.0005");
  let rc = await (await router.buy(token, NO_ROUTE, 0, { value: buyEth })).wait();
  const got = await retry(() => coin.balanceOf(me.address));
  console.log("buy ok", rc!.hash, "coins now", ethers.formatEther(got));
  // sell half
  await (await coin.approve(await router.getAddress(), got)).wait();
  rc = await (await router.sell(token, got / 2n, NO_ROUTE, 0)).wait();
  console.log("sell ok", rc!.hash);

  // fee split visible in the coin
  console.log("holder rewards", ethers.formatEther(await coin.totalHolderRewards()), "creator", ethers.formatEther(await coin.totalCreatorFees()), "platform", ethers.formatEther(await coin.totalPlatformFees()), "WETH");
  const pending = await retry(() => coin.pendingRewards(me.address));
  console.log("pending for deployer", ethers.formatEther(pending), "WETH");
  if (pending > 0n) { rc = await (await coin.claimRewards()).wait(); console.log("claimed in WETH", rc!.hash, "weth bal", ethers.formatEther(await weth.balanceOf(me.address))); }
  rc = await (await coin.payCreator()).wait(); console.log("creator paid", rc!.hash);
  rc = await (await factory.pushPlatformFees([token])).wait(); console.log("platform paid to treasury", rc!.hash);

  const epoch = await ledger.currentEpoch();
  const st = await ledger.stats(epoch, me.address);
  console.log("ledger epoch", epoch.toString(), "trades", st.trades.toString(), "volume $" + (Number(st.volume) / 1e8).toFixed(2), "fees $" + (Number(st.fees) / 1e8).toFixed(4), "pnl $" + (Number(st.pnl) / 1e8).toFixed(4));
  const bal1 = await ethers.provider.getBalance(me.address);
  console.log("spent", ethers.formatEther(bal0 - bal1), "ETH total (buys included) | left", ethers.formatEther(bal1));
}

main().catch((e) => { console.error(e); process.exit(1); });
