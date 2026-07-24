import { expect } from "chai";
import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Steadypads dollar-mode e2e on a fresh local chain — the exact stack the
 * Stable (chain 988) deployment ships: WrappedNative (WUSDT0) + our own
 * Uniswap V4 PoolManager + QuiverHook/Factory/Router, with WUSDT0 listed as
 * the sole reward. Verifies a launch, taxed round-trip trading, and that
 * harvest pays holders wrapped dollars directly (no swap hops).
 */

const HOOK_FLAGS = (1n << 6n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

describe("Steadypads dollar rewards (local)", function () {
  this.timeout(600_000);

  async function deployStack() {
    const [admin, trader] = await ethers.getSigners();

    const W = await ethers.getContractFactory("WrappedNative");
    const wnative = await W.deploy("Wrapped USDT0", "WUSDT0");
    await wnative.waitForDeployment();
    const WNATIVE = await wnative.getAddress();

    const art = JSON.parse(
      readFileSync(
        join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"),
        "utf8",
      ),
    );
    const PM = new ethers.ContractFactory(art.abi, art.bytecode.object, admin);
    const pm = await PM.deploy(admin.address);
    await pm.waitForDeployment();
    const POOL_MANAGER = await pm.getAddress();

    const Deployer = await ethers.getContractFactory("HookDeployer");
    const c2 = await Deployer.deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();

    const Hook = await ethers.getContractFactory("QuiverHook");
    const hookArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address"],
      [POOL_MANAGER, admin.address, admin.address, WNATIVE],
    );
    const initCode = ethers.concat([Hook.bytecode, hookArgs]);
    const hash = ethers.keccak256(initCode);
    let salt = "";
    let hookAddr = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) {
        salt = s;
        hookAddr = a;
        break;
      }
    }
    if (!hookAddr) throw new Error("no hook salt found");
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("QuiverHook", hookAddr);

    const Factory = await ethers.getContractFactory("QuiverFactory");
    // Native is a dollar: price8 = $1.00
    const factory = await Factory.deploy(admin.address, admin.address, POOL_MANAGER, hookAddr, WNATIVE, 100_000_000n);
    await factory.waitForDeployment();
    await (await hook.setFactory(await factory.getAddress())).wait();

    // Dollar mode: list WUSDT0 itself; the recorded pool key is never used.
    const zero = ethers.ZeroAddress;
    const [c0, c1] = zero.toLowerCase() < WNATIVE.toLowerCase() ? [zero, WNATIVE] : [WNATIVE, zero];
    await (await factory.listStock(WNATIVE, { currency0: c0, currency1: c1, fee: 0, tickSpacing: 60, hooks: zero })).wait();

    const Router = await ethers.getContractFactory("QuiverRouter");
    const router = await Router.deploy(POOL_MANAGER, WNATIVE, hookAddr);
    await router.waitForDeployment();

    return { admin, trader, wnative, WNATIVE, hook, hookAddr, factory, router };
  }

  async function launchToken(factory: any, signer: any, stock: string) {
    const Token = await ethers.getContractFactory("QuiverToken");
    const factoryAddr = await factory.getAddress();
    const params = { name: "Steady Test", symbol: "STDY", metadataURI: "", stock, taxBps: 300 };
    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["string", "string", "string", "uint256", "address", "address", "uint16", "address"],
      [params.name, params.symbol, params.metadataURI, 10n ** 27n, signer.address, factoryAddr, params.taxBps, params.stock],
    );
    const initCodeHash = ethers.keccak256(ethers.concat([Token.bytecode, args]));
    let salt = "";
    for (let i = 0n; i < 2_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(factoryAddr, s, initCodeHash);
      if ((BigInt(a) & 0xffffn) === 0x4663n) {
        salt = s;
        break;
      }
    }
    if (!salt) throw new Error("no token vanity salt");
    const tx = await factory.connect(signer).launch(params, salt);
    const rc = await tx.wait();
    const ev = rc!.logs
      .map((l: any) => {
        try {
          return factory.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p: any) => p?.name === "Launched");
    return ev!.args.token as string;
  }

  it("launches, trades and pays holders wrapped dollars on harvest", async () => {
    const { admin, trader, wnative, WNATIVE, hook, factory, router } = await deployStack();

    const token = await launchToken(factory, admin, WNATIVE);
    const erc20 = await ethers.getContractAt("QuiverToken", token);
    expect(await erc20.rewardToken()).to.equal(WNATIVE);

    // Trader buys with native (a dollar), then sells a slice to accrue
    // wrapped-native fees for harvest.
    await (await router.connect(trader).buy(token, 0, { value: ethers.parseEther("0.05") })).wait();
    const held = await erc20.balanceOf(trader.address);
    expect(held).to.be.greaterThan(0n);

    await (await erc20.connect(trader).approve(await router.getAddress(), held)).wait();
    await (await router.connect(trader).sell(token, held / 4n, 0)).wait();

    const pending = await hook.wethFees(token);
    expect(pending, "sell tax accrued in WUSDT0").to.be.greaterThan(0n);

    // Harvest — dollar mode: holder share arrives as WUSDT0, no swap hops.
    await (await hook.harvest(token)).wait();

    const distributed = await erc20.totalRewardsDistributed();
    expect(distributed, "WUSDT0 distributed to holders").to.be.greaterThan(0n);
    expect(await wnative.balanceOf(token)).to.be.greaterThanOrEqual(distributed);

    // The trader can claim their dollar rewards to their wallet.
    const before = await wnative.balanceOf(trader.address);
    const claimable = await erc20.pendingRewards(trader.address);
    expect(claimable).to.be.greaterThan(0n);
    await (await erc20.connect(trader).claim()).wait();
    expect(await wnative.balanceOf(trader.address)).to.equal(before + claimable);
  });
});
