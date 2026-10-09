// Adds liquidity to a coin's Etherhook pool through Uniswap V4's PositionManager, over the coin's
// launch range, from the configured wallet (DEPLOYER_ENV). The position NFT goes to that wallet.
//   TOKEN=0x.. COIN_AMOUNT=<whole coins> PAIR_AMOUNT=<WETH> [DRY=1] \
//   npx hardhat --config hardhat.config.backstop.ts run scripts/readd-liquidity-backstop.ts --network mainnet
import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-backstop.json"), "utf8"));
const POSM = "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e";
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const STATE_VIEW = "0x7fFE42C4a5DEeA5b0feC41C94C136Cf115597227";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const Q96 = 1n << 96n;
const MINT_POSITION = 0x02, SETTLE_PAIR = 0x0d;

// Uniswap TickMath.getSqrtRatioAtTick
function sqrtAt(tick: number): bigint {
  const abs = BigInt(Math.abs(tick));
  let r = (abs & 1n) ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const m: [bigint, bigint][] = [[0x2n, 0xfff97272373d413259a46990580e213an], [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn], [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n], [0x10n, 0xffcb9843d60f6159c9db58835c926644n], [0x20n, 0xff973b41fa98c081472e6896dfb254c0n], [0x40n, 0xff2ea16466c96a3843ec78b326b52861n], [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n], [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n], [0x200n, 0xf987a7253ac413176f2b074cf7815e54n], [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n], [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n], [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n], [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n], [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n], [0x8000n, 0x31be135f97d08fd981231505542fcfa6n], [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n], [0x20000n, 0x5d6af8dedb81196699c329225ee604n], [0x40000n, 0x2216e584f5fa1ea926041bedfe98n], [0x80000n, 0x48a170391f7dc42444e8fa2n]];
  for (const [bit, mul] of m) if (abs & bit) r = (r * mul) >> 128n;
  if (tick > 0) r = ((1n << 256n) - 1n) / r;
  return (r >> 32n) + ((r % (1n << 32n)) === 0n ? 0n : 1n);
}

async function main() {
  const [me] = await ethers.getSigners();
  const token = ethers.getAddress(process.env.TOKEN!);
  const factory = await ethers.getContractAt("BackstopFactory", dep.contracts.factory, me);
  const [c0, c1] = token.toLowerCase() < WETH.toLowerCase() ? [token, WETH] : [WETH, token];
  const key = { currency0: c0, currency1: c1, fee: 0, tickSpacing: 60, hooks: dep.contracts.hook };
  const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [c0, c1, 0, 60, dep.contracts.hook]));
  const sv = new ethers.Contract(STATE_VIEW, ["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"], me);
  const [sqrtP, tick] = await sv.getSlot0(poolId);
  const pos = await factory.positions(token);
  const lower = Number(pos.tickLower), upper = Number(pos.tickUpper);
  const sa = sqrtAt(lower), sb = sqrtAt(upper);
  if (!(sqrtP > sa && sqrtP < sb)) throw new Error("price is outside the launch range");

  const coinAmt = ethers.parseEther(process.env.COIN_AMOUNT!);
  const pairAmt = ethers.parseEther(process.env.PAIR_AMOUNT!);
  const [amt0, amt1] = c0 === token ? [coinAmt, pairAmt] : [pairAmt, coinAmt];
  const L0 = (amt0 * ((sqrtP * sb) / Q96)) / (sb - sqrtP);
  const L1 = (amt1 * Q96) / (sqrtP - sa);
  const L = ((L0 < L1 ? L0 : L1) * 999n) / 1000n; // a hair under, for rounding
  console.log(`pool ${poolId} tick ${tick} range ${lower}..${upper}`);
  console.log(`liquidity ${L} (from coin ${L0}, from WETH ${L1})`);

  const erc = (a: string) => new ethers.Contract(a, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"], me);
  const permit2 = new ethers.Contract(PERMIT2, ["function approve(address token,address spender,uint160 amount,uint48 expiration)", "function allowance(address,address,address) view returns (uint160,uint48,uint48)"], me);
  const posm = new ethers.Contract(POSM, ["function modifyLiquidities(bytes unlockData,uint256 deadline) payable", "function nextTokenId() view returns (uint256)"], me);
  for (const [a, need] of [[c0, amt0], [c1, amt1]] as [string, bigint][]) {
    const bal = await erc(a).balanceOf(me.address);
    if (bal < need) throw new Error(`not enough of ${a}: have ${bal}, need ${need}`);
  }

  const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const mint = coder.encode([KEY_T, "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"], [key, lower, upper, L, amt0, amt1, me.address, "0x"]);
  const settle = coder.encode(["address", "address"], [c0, c1]);
  const unlockData = coder.encode(["bytes", "bytes[]"], [ethers.solidityPacked(["uint8", "uint8"], [MINT_POSITION, SETTLE_PAIR]), [mint, settle]]);
  const deadline = Math.floor(Date.now() / 1000) + 1800;
  const fee = await ethers.provider.getFeeData();
  const o = { gasPrice: fee.gasPrice! };

  if (process.env.DRY) { console.log("dry run: approvals and mint not sent"); return; }
  for (const a of [c0, c1]) {
    if ((await erc(a).allowance(me.address, PERMIT2)) < ethers.MaxUint256 / 2n) { const tx = await erc(a).approve(PERMIT2, ethers.MaxUint256, o); console.log("approve Permit2", a, tx.hash); await tx.wait(); }
    const [amt] = await permit2.allowance(me.address, a, POSM);
    if (amt < (1n << 159n)) { const tx = await permit2.approve(a, POSM, (1n << 160n) - 1n, 2n ** 48n - 1n, o); console.log("Permit2 -> PositionManager", a, tx.hash); await tx.wait(); }
  }
  await posm.modifyLiquidities.staticCall(unlockData, deadline);
  const id = await posm.nextTokenId();
  const tx = await posm.modifyLiquidities(unlockData, deadline, o);
  console.log("mint", tx.hash);
  const rc = await tx.wait();
  console.log(`added: position #${id} owned by ${me.address}, gasUsed ${rc!.gasUsed}`);
}

main().catch(e => { console.error(e); process.exitCode = 1; });
