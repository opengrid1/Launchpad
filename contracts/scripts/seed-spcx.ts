import { ethers, network } from "hardhat";

/**
 * Rescue for PRINTR v1's reward route: the factory registered the SPCX/USDG
 * fee-3000 pool, which has no in-range liquidity, so harvests revert. This
 * seeds that pool with an SPCX-only range just above spot:
 *
 *   1. deploy LiquiditySeeder
 *   2. wrap ETH, WETH -> USDG (quote pool), USDG -> SPCX (liquid fee-10000)
 *   3. teleport the empty fee-3000 pool price down to spot
 *   4. add a one-sided SPCX range above spot
 *   5. hook.harvest(PRINTR)  — now buys real SPCX for holders
 *   6. claimCreatorFees + sweep leftovers back to the deployer
 *
 * Run with FORK=1 first for a full dry run; DO_IT=1 sends to mainnet.
 */

const PM = ethers.getAddress("0x8366a39cc670b4001a1121b8f6a443a643e40951");
const WETH = ethers.getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const USDG = ethers.getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const SPCX = ethers.getAddress("0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa");
const HOOK = "0x1E8fd8f01C44084E514d872AD27455De5c994044";
const PRINTR = "0x600478629dd470fbf2a4145a24899458aab34663";
const DEPLOYER = "0x7817F4e44a658410C4ADA6a9226ef3d51e5Ea846";

const Q96 = 2n ** 96n;
const MIN_SQRT = 4295128739n + 1n;
const MAX_SQRT = 1461446703485210103287273052203988822378723970342n - 1n;

// quote pool WETH/USDG (WETH < USDG => WETH is currency0)
const quoteKey = { currency0: WETH, currency1: USDG, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };
// liquid SPCX market pool (SPCX < USDG => SPCX is currency0)
const marketKey = { currency0: SPCX, currency1: USDG, fee: 10000, tickSpacing: 200, hooks: ethers.ZeroAddress };
// broken reward pool the renounced factory routes through
const rewardKey = { currency0: SPCX, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };

function poolId(k: typeof quoteKey): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ),
  );
}

async function slot0(k: typeof quoteKey): Promise<{ sqrtP: bigint; tick: number }> {
  const ext = new ethers.Contract(PM, ["function extsload(bytes32) view returns (bytes32)"], ethers.provider);
  const stateSlot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [poolId(k), 6]));
  const raw = BigInt(await ext.extsload(stateSlot));
  const sqrtP = raw & ((1n << 160n) - 1n);
  let tick = Number((raw >> 160n) & ((1n << 24n) - 1n));
  if (tick >= 2 ** 23) tick -= 2 ** 24;
  return { sqrtP, tick };
}

function sqrtFromTick(tick: number): bigint {
  // good-enough float sqrtPrice for limits/liquidity math (padded elsewhere)
  return BigInt(Math.floor(Math.sqrt(1.0001 ** tick) * 2 ** 96));
}

async function main() {
  const onFork = network.name === "hardhat";
  if (!onFork && process.env.DO_IT !== "1") throw new Error("refusing mainnet without DO_IT=1");
  let signer;
  if (onFork) {
    await network.provider.send("hardhat_mine", ["0x1"]);
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [DEPLOYER] });
    signer = await ethers.getSigner(DEPLOYER);
  } else {
    [signer] = await ethers.getSigners();
  }
  console.log("signer:", signer.address, "ETH:", ethers.formatEther(await ethers.provider.getBalance(signer.address)));

  // 1. deploy seeder
  const seeder = await (await ethers.getContractFactory("LiquiditySeeder", signer)).deploy(PM);
  await seeder.waitForDeployment();
  const seederAddr = await seeder.getAddress();
  console.log("seeder:", seederAddr);

  // 2. fund: wrap 0.035 ETH -> WETH -> seeder
  const weth = new ethers.Contract(WETH, [
    "function deposit() payable", "function transfer(address,uint256) returns (bool)",
    "function balanceOf(address) view returns (uint256)",
  ], signer);
  const FUND = ethers.parseEther("0.035");
  await (await weth.deposit({ value: FUND })).wait();
  await (await weth.transfer(seederAddr, FUND)).wait();
  console.log("funded seeder with", ethers.formatEther(FUND), "WETH");

  const bal = (t: string, who = seederAddr) =>
    new ethers.Contract(t, ["function balanceOf(address) view returns (uint256)"], ethers.provider).balanceOf(who);

  // WETH -> USDG
  await (await seeder.swap(quoteKey, true, FUND, MIN_SQRT, { gasLimit: 600_000 })).wait();
  const usdgBal: bigint = await bal(USDG);
  console.log("USDG:", ethers.formatUnits(usdgBal, 6));

  // USDG -> SPCX on the liquid market pool (currency1 in => price up => limit MAX)
  await (await seeder.swap(marketKey, false, usdgBal, MAX_SQRT, { gasLimit: 600_000 })).wait();
  const spcxBal: bigint = await bal(SPCX);
  console.log("SPCX:", ethers.formatEther(spcxBal));
  if (spcxBal === 0n) throw new Error("market swap returned no SPCX");

  // 3. teleport reward pool price down to just under market spot
  const market = await slot0(marketKey);
  const before = await slot0(rewardKey);
  console.log("reward pool tick:", before.tick, "market tick:", market.tick);
  if (before.sqrtP > market.sqrtP) {
    await (await seeder.swap(rewardKey, true, 1n, market.sqrtP - 1n, { gasLimit: 600_000 })).wait();
  }
  const now = await slot0(rewardKey);
  console.log("reward pool tick after teleport:", now.tick);

  // 4. one-sided SPCX range from just above current tick to ~+45% price
  const spacing = 60;
  const tickLower = Math.ceil((now.tick + 1) / spacing) * spacing;
  const tickUpper = tickLower + Math.ceil(3700 / spacing) * spacing; // ~+45%
  const sqrtA = sqrtFromTick(tickLower);
  const sqrtB = sqrtFromTick(tickUpper);
  const amt0 = (spcxBal * 99n) / 100n; // pad for rounding
  const L = (amt0 * sqrtA / Q96) * sqrtB / (sqrtB - sqrtA);
  console.log("range ticks:", tickLower, tickUpper, "liquidity:", L.toString());
  await (await seeder.modifyLiquidity(rewardKey, tickLower, tickUpper, L, { gasLimit: 800_000 })).wait();
  console.log("liquidity added ✅");

  // 5. harvest PRINTR
  const hook = new ethers.Contract(HOOK, [
    "function harvest(address)",
    "function creatorClaimable(address) view returns (uint256)",
    "function claimCreatorFees(address) returns (uint256)",
    "function wethFees(address) view returns (uint256)",
    "function tokenFees(address) view returns (uint256)",
  ], signer);
  await (await hook.harvest(PRINTR, { gasLimit: 3_000_000 })).wait();
  const token = new ethers.Contract(PRINTR, [
    "function totalRewardsDistributed() view returns (uint256)",
  ], ethers.provider);
  console.log("harvest OK ✅ SPCX distributed:", ethers.formatEther(await token.totalRewardsDistributed()));
  console.log("creator fee claimable (WETH):", ethers.formatEther(await hook.creatorClaimable(PRINTR)));

  // 6. claim creator fees (PRINTR + QVR residual) and sweep leftovers
  await (await hook.claimCreatorFees(PRINTR)).wait();
  const QVR = "0xf898dFbb47B0938F94d3F57120d8fB85e72d4663";
  if ((await hook.creatorClaimable(QVR)) > 0n) await (await hook.claimCreatorFees(QVR)).wait();
  for (const t of [WETH, USDG, SPCX]) {
    if ((await bal(t)) > 0n) await (await seeder.sweep(t)).wait();
  }
  console.log("creator fees claimed + sweep done ✅");
  console.log("deployer WETH:", ethers.formatEther(await bal(WETH, DEPLOYER)));
  console.log("residual fees — weth:", ethers.formatEther(await hook.wethFees(PRINTR)),
    "token:", ethers.formatEther(await hook.tokenFees(PRINTR)));
}

main().catch((e) => { console.error(e); process.exit(1); });
