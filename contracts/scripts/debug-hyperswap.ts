import { ethers } from "hardhat";
import UniV3Factory from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";

const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const WHYPE = "0x5555555555555555555555555555555555555555";
const SUPPLY = ethers.parseEther("1000000000");

async function main() {
  const [deployer] = await ethers.getSigners();

  const probe = await (await ethers.getContractFactory("HyperProbe")).deploy(V3_FACTORY);
  await probe.waitForDeployment();
  const probeAddr = await probe.getAddress();

  // Deploy a plain 18-dec token whose entire supply is held by the probe.
  const token = await (await ethers.getContractFactory("InkToken")).deploy("Probe", "PRB", SUPPLY, probeAddr);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();

  const tokenIsToken0 = tokenAddr.toLowerCase() < WHYPE.toLowerCase();
  console.log("token:", tokenAddr, "tokenIsToken0:", tokenIsToken0);

  const [sqrt, tl, tu, liq] = await probe.compute(tokenIsToken0, 200, 3000n * 10n ** 8n, 1n * 10n ** 8n, 18);
  console.log("computed sqrtPriceX96:", sqrt.toString());
  console.log("computed tickLower:", tl.toString(), "tickUpper:", tu.toString());
  console.log("computed liquidity:", liq.toString());

  await (await probe.setPay(false)).wait(); // no-op callback: if pool reverts with M0/M1, the callback was reached
  const tx = await probe.run(tokenAddr, WHYPE, 10000, sqrt, tl, tu, liq, { gasLimit: 90_000_000 });
  const rc = await tx.wait();
  let poolAddr = "";
  for (const log of rc!.logs) {
    try {
      const p = probe.interface.parseLog(log);
      if (p?.name === "Step") {
        console.log(`STEP ${p.args.what}: ok=${p.args.ok} data=${p.args.data}`);
        if (p.args.what === "createPool") poolAddr = ethers.getAddress("0x" + String(p.args.data).slice(-40));
      }
    } catch { /* not a probe event */ }
  }

  if (poolAddr) {
    console.log("\n--- created pool immutables:", poolAddr, "---");
    const pool = new ethers.Contract(poolAddr, [
      "function fee() view returns (uint24)",
      "function tickSpacing() view returns (int24)",
      "function maxLiquidityPerTick() view returns (uint128)",
      "function factory() view returns (address)",
      "function token0() view returns (address)",
      "function token1() view returns (address)",
      "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool unlocked)",
    ], deployer);
    for (const fn of ["fee", "tickSpacing", "maxLiquidityPerTick", "factory", "token0", "token1"]) {
      try { console.log(fn, "=", (await (pool as any)[fn]()).toString()); } catch (e: any) { console.log(fn, "REVERT", e.shortMessage ?? e.message); }
    }
    try { const s = await pool.slot0(); console.log("slot0.tick =", s.tick.toString(), "sqrt =", s.sqrtPriceX96.toString(), "unlocked =", s.unlocked); }
    catch (e: any) { console.log("slot0 REVERT", e.shortMessage ?? e.message); }
  }

  // ---- Control against CANONICAL Uniswap V3 (same fork, same params) ----
  console.log("\n=== CANONICAL Uniswap V3 control ===");
  const canon = await new ethers.ContractFactory(UniV3Factory.abi, UniV3Factory.bytecode, deployer).deploy();
  await canon.waitForDeployment();
  const canonAddr = await canon.getAddress();
  const probe2 = await (await ethers.getContractFactory("HyperProbe")).deploy(canonAddr);
  await probe2.waitForDeployment();
  const token2 = await (await ethers.getContractFactory("InkToken")).deploy("P2", "P2", SUPPLY, await probe2.getAddress());
  await token2.waitForDeployment();
  const t2 = await token2.getAddress();
  const t2is0 = t2.toLowerCase() < WHYPE.toLowerCase();
  const [s2, tl2, tu2, liq2] = await probe2.compute(t2is0, 200, 3000n * 10n ** 8n, 1n * 10n ** 8n, 18);
  console.log("canon tokenIsToken0:", t2is0, "tl", tl2.toString(), "tu", tu2.toString(), "liq", liq2.toString());
  const rc2 = await (await probe2.run(t2, WHYPE, 10000, s2, tl2, tu2, liq2, { gasLimit: 90_000_000 })).wait();
  for (const log of rc2!.logs) {
    try { const p = probe2.interface.parseLog(log); if (p?.name === "Step") console.log(`CANON STEP ${p.args.what}: ok=${p.args.ok} data=${p.args.data}`); } catch {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
