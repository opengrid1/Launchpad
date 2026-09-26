/* eslint-disable no-console */
// Seeds a local mainnet fork with stockpad activity so the site can be checked
// end to end: a WETH-paired coin and an NVDAon-paired coin, each with an ETH
// first buy, then a few router trades from other accounts once the anti-snipe
// window has passed.
//
//   DEPLOY_FILE=<local deployment json> HARDHAT_CONFIG=hardhat.config.size.ts \
//     npx hardhat run scripts/seed-stockpad-local.ts --network localhost
import { ethers, network } from "hardhat";
import fs from "node:fs";

const NVDA = "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [
  ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, USDC]),
  { currency0: NVDA, currency1: USDC, fee: 9000, tickSpacing: 90, hooks: ethers.ZeroAddress },
]);
const LOGO = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1b1b1f"/><circle cx="32" cy="32" r="18" fill="#FF3B30"/></svg>').toString("base64");

async function main() {
  const dep = JSON.parse(fs.readFileSync(process.env.DEPLOY_FILE!, "utf8"));
  const [creator, a, b, c] = await ethers.getSigners();
  const factory = await ethers.getContractAt("StockPadFactory", dep.contracts.factory, creator);
  const router = await ethers.getContractAt("StockPadRouter", dep.contracts.router);
  const salt = (i: number) => ethers.zeroPadValue(ethers.toBeHex(Date.now() + i), 32);

  const launches = [
    { name: "Moon Cat", symbol: "MCAT", pair: WETH, route: "0x", eth: "0.3", desc: "The first cat on the mainnet stockpad. Paired with ETH." },
    { name: "Nvidia Enjoyer", symbol: "NVJ", pair: NVDA, route: NVDA_ROUTE, eth: "0.4", desc: "A coin priced in NVIDIA. Every trade pays holders in NVDAon.", twitter: "https://x.com/stockpad" },
  ];
  const coins: string[] = [];
  for (const [i, l] of launches.entries()) {
    const meta = JSON.stringify({ description: l.desc, logo: LOGO, ...(l.twitter ? { twitter: l.twitter } : {}) });
    const n = Number(await factory.totalTokens());
    await (await factory.launch({ name: l.name, symbol: l.symbol, metadataURI: meta, pair: l.pair }, salt(i), l.route, { value: ethers.parseEther(l.eth) })).wait();
    const coin = await factory.allTokens(n);
    coins.push(coin);
    console.log("launched", l.symbol, coin);
  }

  // Past the anti-snipe window, then a few trades.
  await network.provider.send("evm_increaseTime", [40]);
  for (let i = 0; i < 4; i++) await network.provider.send("evm_mine", []);
  const trades: [any, number, string, string][] = [[a, 0, "0.05", "0x"], [b, 0, "0.02", "0x"], [a, 1, "0.08", NVDA_ROUTE], [c, 1, "0.03", NVDA_ROUTE], [b, 1, "0.01", NVDA_ROUTE]];
  for (const [who, idx, eth, route] of trades) {
    await (await router.connect(who).buy(coins[idx], route, 0, { value: ethers.parseEther(eth) })).wait();
    await network.provider.send("evm_increaseTime", [600]);
    await network.provider.send("evm_mine", []);
  }
  // One sell on each.
  for (const [who, idx, route] of [[a, 0, "0x"], [a, 1, NVDA_ROUTE]] as [any, number, string][]) {
    const coin = await ethers.getContractAt("StockPadToken", coins[idx], who);
    const bal = await coin.balanceOf(who.address);
    await (await coin.approve(dep.contracts.router, bal)).wait();
    await (await router.connect(who).sell(coins[idx], bal / 3n, route, 0)).wait();
    await network.provider.send("evm_increaseTime", [900]);
    await network.provider.send("evm_mine", []);
  }
  for (const coin of coins) {
    const t = await ethers.getContractAt("StockPadToken", coins[0] === coin ? coins[0] : coin);
    console.log(coin, "holder rewards", ethers.formatEther(await t.totalHolderRewards()), "creator", ethers.formatEther(await t.creatorFees()), "platform", ethers.formatEther(await t.platformFees()));
  }
  console.log("seeded", coins.join(" "));
}

main().catch((e) => { console.error(e); process.exit(1); });
