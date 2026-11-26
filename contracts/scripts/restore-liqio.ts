import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Put a collected launch position back into its pool through LiqioPermanentLiquidity (no owner, no remove path).
 * Run from the wallet that holds the coins and the pair token (approve is done here).
 *
 *   LIQIO_COIN=0x... LIQIO_LIQUIDITY=<launch liquidity> npx hardhat run scripts/restore-liqio.ts --network hyperevm
 *   LIQIO_PERMANENT=0x...   reuse an already deployed LiqioPermanentLiquidity instead of deploying one
 *   LIQIO_TICKS=lower,upper the position range (default: read from the factory's Collected record is not possible,
 *                           so pass the launch range; LIQIO's is -170790,887270)
 *
 * The liquidity is trimmed down in small steps until the caller's balances cover the deposit (the PoolManager
 * rounds deposits up by a wei), so the position comes back as close to the original as the balances allow.
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/liqio-${network.name}.json`), "utf8"));
  const coinAddr = process.env.LIQIO_COIN!;
  let liquidity = BigInt(process.env.LIQIO_LIQUIDITY ?? "0");
  const [lower, upper] = (process.env.LIQIO_TICKS ?? "-170790,887270").split(",").map((v) => Number(v));
  if (!coinAddr || liquidity === 0n) throw new Error("LIQIO_COIN and LIQIO_LIQUIDITY are needed");
  const factory = await ethers.getContractAt("LiqioFactory", dep.contracts.factory);
  const key = await factory.poolKeyOf(coinAddr);
  const k = { currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks };
  const erc20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function symbol() view returns (string)"];
  const c0 = await ethers.getContractAt(erc20, k.currency0), c1 = await ethers.getContractAt(erc20, k.currency1);
  const [s0, s1, b0, b1] = await Promise.all([c0.symbol(), c1.symbol(), c0.balanceOf(me.address), c1.balanceOf(me.address)]);
  const f = (v: bigint) => ethers.formatEther(v);
  console.log(`${me.address} holds ${f(b0)} ${s0} and ${f(b1)} ${s1}; range [${lower}, ${upper}]`);
  const fee = await ethers.provider.getFeeData();
  const gasOpts = { maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice!) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n };

  let perm;
  if (process.env.LIQIO_PERMANENT) perm = await ethers.getContractAt("LiqioPermanentLiquidity", process.env.LIQIO_PERMANENT);
  else {
    perm = await (await ethers.getContractFactory("LiqioPermanentLiquidity")).deploy(dep.contracts.poolManager, gasOpts);
    await perm.waitForDeployment();
    console.log("LiqioPermanentLiquidity:", await perm.getAddress(), `(verify: npx hardhat verify --network ${network.name} ${await perm.getAddress()} ${dep.contracts.poolManager})`);
  }
  const permAddr = await perm.getAddress();
  for (const [c, b, s] of [[c0, b0, s0], [c1, b1, s1]] as const) {
    if ((await c.allowance(me.address, permAddr)) < b) { await (await c.approve(permAddr, ethers.MaxUint256, gasOpts)).wait(); console.log(`approved ${s}`); }
  }
  // trim until the deposit fits the balances
  let need0 = 0n, need1 = 0n;
  for (let i = 0; i < 200; i++) {
    [need0, need1] = await perm.add.staticCall(k, lower, upper, liquidity).catch(() => [b0 + 1n, b1 + 1n]) as [bigint, bigint];
    if (need0 <= b0 && need1 <= b1) break;
    liquidity -= liquidity / 100_000_000n + 1n; // one part in 1e8 per step
  }
  if (need0 > b0 || need1 > b1) throw new Error(`balances too small: need ${f(need0)} ${s0} and ${f(need1)} ${s1}`);
  console.log(`adding liquidity ${liquidity}: ${f(need0)} ${s0} + ${f(need1)} ${s1}`);
  const rc = await (await perm.add(k, lower, upper, liquidity, gasOpts)).wait();
  console.log(`restored in block ${rc!.blockNumber}, gas ${rc!.gasUsed}, tx ${rc!.hash}`);
  console.log(`left: ${f(await c0.balanceOf(me.address))} ${s0}, ${f(await c1.balanceOf(me.address))} ${s1}`);
  console.log(`explorer: https://hyperevmscan.io/tx/${rc!.hash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
