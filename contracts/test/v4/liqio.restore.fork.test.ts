import { expect } from "chai";
import { ethers, network } from "hardhat";

/**
 * Restoring the liqio.fun (LIQIO) launch position on a HyperEVM fork: the collected coins and WHYPE sit in the
 * admin wallet; LiqioPermanentLiquidity puts the same liquidity back over the same range, and trading works
 * again. Impersonates the admin wallet and a holder.
 *
 *   HYPEREVM_FORK=1 npx hardhat test test/v4/liqio.restore.fork.test.ts
 */
const ON = process.env.HYPEREVM_FORK === "1";
const POOL_MANAGER = "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F";
const QUOTER = "0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e";
const FACTORY = "0x749261Bf054389a380FD0e24D9aCf25538A60313";
const ROUTER = "0x6D02009F27a69efeC5b523439fAc684D6e89Ed52";
const WHYPE = "0x5555555555555555555555555555555555555555";
const LIQIO = "0x04A208834CC5A8682537A266E0B38C4e5E159422";
const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
const POOL_ID = "0xb9aa00d3f0d2d46a7faf3f67508316c9e5c613835819f85ede52f3b0525b2a40";
const TICK_LOWER = -170790, TICK_UPPER = 887270;
const LIQUIDITY = 195671553178154058298855n;

(ON ? describe : describe.skip)("LIQIO liquidity restore on a HyperEVM fork", function () {
  this.timeout(900_000);
  const erc20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];

  async function poolLiquidity(): Promise<bigint> {
    const slot = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [POOL_ID, 6n]));
    const pm = await ethers.getContractAt(["function extsload(bytes32) view returns (bytes32)"], POOL_MANAGER);
    return BigInt(await pm.extsload(ethers.toBeHex(BigInt(slot) + 3n, 32)));
  }

  it("puts the collected position back and trading resumes", async () => {
    expect((await ethers.provider.getNetwork()).chainId).to.equal(999n);
    const [deployer] = await ethers.getSigners();
    // deploy first: a transaction mines a local block, so the view calls below run on local state rather than
    // on the fork block itself (which hardhat refuses without a hardfork history for the remote chain)
    const perm = await (await ethers.getContractFactory("LiqioPermanentLiquidity")).deploy(POOL_MANAGER);
    const permAddr = await perm.getAddress();
    const coin = await ethers.getContractAt(erc20, LIQIO), whype = await ethers.getContractAt(erc20, WHYPE);
    const factory = await ethers.getContractAt("LiqioFactory", FACTORY);
    const key = await factory.poolKeyOf(LIQIO);
    const k = { currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks };
    expect(await poolLiquidity()).to.equal(0n, "pool is empty after the collect");

    // the contract exposes nothing that moves liquidity out
    const names = perm.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(names.sort()).to.deep.equal(["add", "poolManager"]);

    await network.provider.send("hardhat_impersonateAccount", [ADMIN]);
    await network.provider.send("hardhat_setBalance", [ADMIN, "0x8AC7230489E80000"]);
    const admin = await ethers.getSigner(ADMIN);
    const coins = await coin.balanceOf(ADMIN), hype = await whype.balanceOf(ADMIN);
    console.log(`      admin holds ${ethers.formatEther(coins)} LIQIO and ${ethers.formatEther(hype)} WHYPE`);
    expect(coins).to.be.gt(600_000_000n * 10n ** 18n);

    // what the add would cost at the current price
    await (await coin.connect(admin).approve(permAddr, ethers.MaxUint256)).wait();
    await (await whype.connect(admin).approve(permAddr, ethers.MaxUint256)).wait();
    const [need0, need1] = await perm.connect(admin).add.staticCall(k, TICK_LOWER, TICK_UPPER, LIQUIDITY);
    console.log(`      restore needs ${ethers.formatEther(need0)} LIQIO and ${ethers.formatEther(need1)} WHYPE`);
    expect(need0).to.be.lte(coins); expect(need1).to.be.lte(hype);
    const rc = await (await perm.connect(admin).add(k, TICK_LOWER, TICK_UPPER, LIQUIDITY)).wait();
    console.log(`      gas ${rc!.gasUsed}`);
    expect(await poolLiquidity()).to.equal(LIQUIDITY, "pool liquidity back to the launch amount");
    expect(coins - (await coin.balanceOf(ADMIN))).to.equal(need0);
    expect(hype - (await whype.balanceOf(ADMIN))).to.equal(need1);

    // a holder can sell again, a buyer can buy
    await network.provider.send("evm_mine");
    const quoter = await ethers.getContractAt(["function quoteExactInputSingle((( address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns (uint256 amountOut,uint256 gasEstimate)"], QUOTER);
    const sellQ = await quoter.quoteExactInputSingle.staticCall({ poolKey: k, zeroForOne: true, exactAmount: ethers.parseEther("1000000"), hookData: "0x" });
    console.log(`      1M LIQIO sells for ${ethers.formatEther(sellQ.amountOut)} HYPE`);
    expect(sellQ.amountOut).to.be.gt(0n);
    const router = await ethers.getContractAt("EquoRouter", ROUTER);
    const before = await coin.balanceOf(deployer.address);
    await (await router.connect(deployer).buy(LIQIO, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.1") })).wait();
    const got = (await coin.balanceOf(deployer.address)) - before;
    console.log(`      0.1 HYPE buys ${ethers.formatEther(got)} LIQIO`);
    expect(got).to.be.gt(0n);
    await (await coin.connect(deployer).approve(ROUTER, got)).wait();
    const hb = await ethers.provider.getBalance(deployer.address);
    await (await router.connect(deployer).sell(LIQIO, got, "0x", 0, ethers.ZeroAddress)).wait();
    expect(await ethers.provider.getBalance(deployer.address)).to.be.gt(hb - ethers.parseEther("0.01"), "sell paid out HYPE");
    // and the position cannot be touched by anyone: the factory's own position record is empty and the new one belongs to perm
    expect((await factory.positionOf(LIQIO)).liquidity).to.equal(0n);
  });
});
