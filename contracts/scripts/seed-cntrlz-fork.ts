/* eslint-disable no-console */
// Seeds a local mainnet fork (npx hardhat node, forked) with cntrl-z activity against the
// deployed mainnet contracts, so the site can be tried end to end:
//   FORK=1 npx hardhat node --config hardhat.config.cntrlz.ts
//   npx hardhat --config hardhat.config.cntrlz.ts run scripts/seed-cntrlz-fork.ts --network localhost
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const UNI_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const E = ethers.parseEther;
const mins = async (m: number) => { await network.provider.send("evm_increaseTime", [Math.round(m * 60)]); await network.provider.send("evm_mine", []); };

async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-cntrlz.json"), "utf8"));
  const c = dep.contracts;
  const [, creator, alice, bob, carol] = await ethers.getSigners();
  const factory = await ethers.getContractAt("CtrlzFactory", c.factory);
  const router = await ethers.getContractAt("CtrlzRouter", c.router);
  const hook = await ethers.getContractAt("CtrlzHook", c.hook);
  const v2 = await ethers.getContractAt(["function getPair(address,address) view returns (address)"], UNI_V2_FACTORY);
  const paxgRoute = ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[{ dex: 1, pool: await v2.getPair(PAXG, WETH), key: EMPTY_KEY }]]);
  const salt = () => ethers.hexlify(ethers.randomBytes(32));
  const img = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="20" fill="#1d4ed8"/><text x="48" y="62" font-size="44" text-anchor="middle" fill="#fff" font-family="sans-serif">Z</text></svg>').toString("base64");

  const n0 = Number(await factory.totalTokens());
  console.log("fork block", await ethers.provider.getBlockNumber(), "coins before", n0);
  if (process.env.CZT) return cont(process.env.CZT, process.env.GOLDH!);
  await (await factory.connect(creator).launch({ name: "Ctrl Z Test", symbol: "CZT", metadataURI: JSON.stringify({ description: "Fork test coin paired with ETH. Every buy can be undone.", image: img, website: "https://cntrl-z.fun", x: "https://x.com/cntrlz_fun" }), pair: WETH, minPairOut: 0 }, salt(), "0x", { value: E("0.02") })).wait();
  const czt = await factory.allTokens(n0);
  await (await factory.connect(creator).launch({ name: "Gold Hands", symbol: "GOLDH", metadataURI: JSON.stringify({ description: "Paired with tokenized gold (PAXG)." }), pair: PAXG, minPairOut: 0 }, salt(), paxgRoute, { value: E("0.01") })).wait();
  const goldh = await factory.allTokens(n0 + 1);
  console.log("CZT", czt, "GOLDH", goldh);
  await mins(2);
  await (await router.connect(alice).buy(czt, "0x", 0, { value: E("0.1") })).wait();
  await (await router.connect(alice).buyWithWindow(czt, "0x", 6 * 3600, 0, { value: E("0.5") })).wait();
  await (await router.connect(bob).buyWithWindow(czt, "0x", 3600, 0, { value: E("0.3") })).wait();
  await mins(1);
  await (await hook.connect(bob).keep(czt, 1)).wait();
  await cont(czt, goldh);
}
// the second half, rerunnable on a fork that already has the coins: CZT=0x.. GOLDH=0x..
async function cont(czt: string, goldh: string) {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-cntrlz.json"), "utf8"));
  const c = dep.contracts;
  const [, , alice, bob, carol] = await ethers.getSigners();
  const router = await ethers.getContractAt("CtrlzRouter", c.router);
  const hook = await ethers.getContractAt("CtrlzHook", c.hook);
  const v2 = await ethers.getContractAt(["function getPair(address,address) view returns (address)"], UNI_V2_FACTORY);
  const paxgRoute = ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[{ dex: 1, pool: await v2.getPair(PAXG, WETH), key: EMPTY_KEY }]]);
  // a 24h window costs 0.2 ETH, so the buy must cost at least 0.667 ETH
  const wid = Number(await hook.windowCount(czt));
  await (await router.connect(carol).buyWithWindow(czt, "0x", 24 * 3600, 0, { value: E("1") })).wait();
  await mins(1);
  await (await hook.connect(carol).cancel(czt, wid)).wait();
  await (await router.connect(bob).buy(czt, "0x", 0, { value: E("0.05") })).wait();
  const coin = await ethers.getContractAt("CtrlzToken", czt);
  const bal = await coin.balanceOf(bob.address);
  await (await coin.connect(bob).approve(c.router, bal / 2n)).wait();
  await (await router.connect(bob).sell(czt, bal / 2n, "0x", 0)).wait();
  await (await router.connect(alice).buyWithWindow(goldh, paxgRoute, 6 * 3600, 0, { value: E("0.5") })).wait();
  await (await router.connect(bob).buy(goldh, paxgRoute, 0, { value: E("0.05") })).wait();
  console.log("seeded: windows on CZT", await hook.windowCount(czt), "on GOLDH", await hook.windowCount(goldh), "block", await ethers.provider.getBlockNumber());
}
main().catch((e) => { console.error(e); process.exit(1); });
