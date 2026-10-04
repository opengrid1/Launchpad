/* eslint-disable no-console */
// Local development only: fills an Anypair deployment on a Base fork with coins on
// different pairs and DEXes, reward baskets, and a few hours of trading, so the
// site has realistic data. Never run against mainnet.
//
//   DEPLOY_FILE=... LOGOS=.../logos.json HARDHAT_CONFIG=hardhat.config.size.ts \
//     npx hardhat run scripts/dev-seed-anypair.ts --network localhost
import { ethers, network } from "hardhat";
import fs from "node:fs";

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CBBTC = "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf";
const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const VIRTUAL = "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b";
const BRETT = "0x532f27101965dd16442E59d40670FaF5eBB142E4";
const CAKE = "0x3055913c90Fcc1A6CE9a358911721eEb942013A1";
const BLOOB = "0x960fc5E59BC6055c825846cF2c41A124209b321b";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const HOP: Record<string, { dex: number; pool: string; key: typeof EMPTY_KEY }> = {
  [USDC]: { dex: 1, pool: "0xd0b53D9277642d899DF5C87A3966A349A798F224", key: EMPTY_KEY },
  [CBBTC]: { dex: 1, pool: "0x7AeA2E8A3843516afa07293a10Ac8E49906dabD1", key: EMPTY_KEY },
  [AERO]: { dex: 4, pool: "0x7f670f78B17dEC44d5Ef68a48740b6f8849cc2e6", key: EMPTY_KEY },
  [VIRTUAL]: { dex: 4, pool: "0x21594b992F68495dD28d605834b58889d0a727c7", key: EMPTY_KEY },
  [BRETT]: { dex: 3, pool: "0x4e829F8A5213c42535AB84AA40BD4aDCCE9cBa02", key: EMPTY_KEY },
  [CAKE]: { dex: 2, pool: "0x03C33a2fC0D444a5B61E573f9e1A285357a694fc", key: EMPTY_KEY },
  [BLOOB]: { dex: 5, pool: ethers.ZeroAddress, key: { currency0: ethers.ZeroAddress, currency1: BLOOB, fee: 30000, tickSpacing: 200, hooks: ethers.ZeroAddress } },
};
const route = (t: string) => (t === WETH ? "0x" : ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[HOP[t]]]));

async function main() {
  if (network.name === "mainnet" || (await ethers.provider.getNetwork()).chainId === 8453n && network.name !== "localhost") throw new Error("local fork only");
  const dep = JSON.parse(fs.readFileSync(process.env.DEPLOY_FILE!, "utf8"));
  const logos = process.env.LOGOS ? JSON.parse(fs.readFileSync(process.env.LOGOS, "utf8")) : {};
  const signers = await ethers.getSigners();
  const factory = await ethers.getContractAt("AnypairFactory", dep.contracts.factory);
  const router = await ethers.getContractAt("AnypairRouter", dep.contracts.router);
  const COINS = [
    { name: "Pairwise", symbol: "PAIR", pair: WETH, basket: [CBBTC, AERO], rewards: true, desc: "The first coin on Anypair. Paired with ETH, pays holders in cbBTC and AERO.", x: "https://x.com/anypair" },
    { name: "Blue Cheese", symbol: "CHEESE", pair: USDC, basket: [], rewards: true, desc: "Stable pair, stinky coin. Holders earn USDC on every trade." },
    { name: "Satoshi Frog", symbol: "SFROG", pair: CBBTC, basket: [CBBTC], rewards: true, desc: "Paired with cbBTC. Holders stack sats." },
    { name: "Aero Ape", symbol: "AAPE", pair: AERO, basket: [AERO, VIRTUAL], rewards: true, desc: "Lives on Aerodrome liquidity. Rewards in AERO and VIRTUAL." },
    { name: "Brett Jr", symbol: "BRETTJR", pair: BRETT, basket: [], rewards: false, desc: "Brett's little brother. Creator keeps the full 1.2%." },
    { name: "Bloob Cult", symbol: "CULT", pair: BLOOB, basket: [BLOOB], rewards: true, desc: "Paired with a Uniswap V4 coin." },
    { name: "Cake Walk", symbol: "WALK", pair: CAKE, basket: [CAKE, USDC], rewards: true, desc: "Priced from PancakeSwap. Rewards in CAKE and USDC." },
  ];
  const coins: string[] = [];
  for (let i = 0; i < COINS.length; i++) {
    const c = COINS[i];
    const creator = signers[1 + (i % 3)];
    const meta = JSON.stringify({ description: c.desc, image: logos[c.symbol] || "", x: c.x || "", website: "", telegram: "" });
    const sources = [c.pair, ...c.basket].filter((t) => HOP[t] && t !== USDC).map((t) => HOP[t]);
    const n = Number(await factory.totalTokens());
    await (await factory.connect(creator).launch(
      { name: c.name, symbol: c.symbol, metadataURI: meta, pair: c.pair, minPairOut: 0, basket: c.basket, holderRewards: c.rewards, sources },
      ethers.hexlify(ethers.randomBytes(32)), route(c.pair), { value: ethers.parseEther("0.01") },
    )).wait();
    const t = await factory.allTokens(n);
    coins.push(t);
    console.log("launched", c.symbol, t);
    await network.provider.send("evm_increaseTime", [600 + i * 300]);
    await network.provider.send("evm_mine", []);
  }
  // a few hours of trading: random buys and sells from eight wallets
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
  for (let step = 0; step < 90; step++) {
    const i = Math.floor(rnd() * coins.length);
    const w = signers[4 + Math.floor(rnd() * 8)];
    const coin = await ethers.getContractAt("AnypairToken", coins[i]);
    const pair = COINS[i].pair;
    const bal = await coin.balanceOf(w.address);
    try {
      if (bal > 0n && rnd() < 0.35) {
        await (await coin.connect(w).approve(await router.getAddress(), ethers.MaxUint256)).wait();
        await (await router.connect(w).sell(coins[i], (bal * BigInt(20 + Math.floor(rnd() * 60))) / 100n, route(pair), 0)).wait();
      } else {
        const eth = ethers.parseEther((0.005 + rnd() * (i === 0 ? 0.4 : 0.12)).toFixed(4));
        await (await router.connect(w).buy(coins[i], route(pair), 0, { value: eth })).wait();
      }
    } catch (e: any) { console.log("  skip", COINS[i].symbol, String(e.shortMessage || e.message).slice(0, 80)); }
    await network.provider.send("evm_increaseTime", [60 + Math.floor(rnd() * 420)]);
    await network.provider.send("evm_mine", []);
  }
  dep.seed = coins;
  fs.writeFileSync(process.env.DEPLOY_FILE!, JSON.stringify(dep, null, 2));
  console.log("seeded", coins.length, "coins; block", await ethers.provider.getBlockNumber());
}

main().catch((e) => { console.error(e); process.exit(1); });
