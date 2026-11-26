import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Prove a coin is sellable on-chain: buy it with HYPE through the router, then sell everything bought straight back.
 * Works for HYPE pairs and for routed pairs (LIQIO_ROUTE_POOL: the PRJX WHYPE/<pair> pool).
 *
 *   LIQIO_COIN=0x... [LIQIO_ROUTE_POOL=0x...] [LIQIO_HYPE=0.005] npx hardhat run scripts/liqio-roundtrip.ts --network hyperevm
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/liqio-${network.name}.json`), "utf8"));
  const coinAddr = process.env.LIQIO_COIN!;
  if (!coinAddr) throw new Error("LIQIO_COIN is needed");
  const router = await ethers.getContractAt("EquoRouter", dep.contracts.router);
  const coin = await ethers.getContractAt(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function symbol() view returns (string)"], coinAddr);
  const NO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
  const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
  const route = process.env.LIQIO_ROUTE_POOL ? ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[{ dex: 2, pool: ethers.getAddress(process.env.LIQIO_ROUTE_POOL), key: NO_KEY }]]) : "0x";
  const spend = ethers.parseEther(process.env.LIQIO_HYPE ?? "0.005");
  const sym = await coin.symbol();
  const fee = await ethers.provider.getFeeData();
  const gasOpts = { maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice!) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n };

  const before = await coin.balanceOf(me.address);
  const h0 = await ethers.provider.getBalance(me.address);
  const rc1 = await (await router.buy(coinAddr, route, 0, ethers.ZeroAddress, { value: spend, ...gasOpts })).wait();
  const got = (await coin.balanceOf(me.address)) - before;
  console.log(`BUY  ${ethers.formatEther(spend)} HYPE -> ${ethers.formatEther(got)} ${sym}  gas ${rc1!.gasUsed}  tx ${rc1!.hash}`);
  await (await coin.approve(dep.contracts.router, got, gasOpts)).wait();
  const h1 = await ethers.provider.getBalance(me.address);
  const rc2 = await (await router.sell(coinAddr, got, route, 0, ethers.ZeroAddress, gasOpts)).wait();
  const h2 = await ethers.provider.getBalance(me.address);
  const back = h2 - h1 + rc2!.gasUsed * rc2!.gasPrice;
  console.log(`SELL ${ethers.formatEther(got)} ${sym} -> ${ethers.formatEther(back)} HYPE  gas ${rc2!.gasUsed}  tx ${rc2!.hash}`);
  console.log(`round trip returned ${((Number(back) / Number(spend)) * 100).toFixed(1)}% of the HYPE spent (fees and routing slippage take the rest); total gas ${ethers.formatEther(h0 - h2 - spend + back)} HYPE`);
}

main().catch((e) => { console.error(e); process.exit(1); });
