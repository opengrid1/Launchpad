import { expect } from "chai";
import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * OneHook, factory-held liquidity model, on a fresh local chain with a real
 * Uniswap V4 PoolManager.
 *
 * What this proves:
 *   - the hook is swap-only: its address encodes exactly the four swap flags,
 *     it has no collect/position surface, and it never holds the coin;
 *   - the factory seeds and holds the launch position and is the only
 *     contract with `collect` (admin-only, event-logged);
 *   - trading, fee routing, creator payout, buyback-burn and dividends still
 *     work end to end through the real PoolManager;
 *   - the hook enforces the constitution's fee caps itself in registerPool.
 */

// beforeSwap | afterSwap | beforeSwapReturnDelta | afterSwapReturnDelta
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ETH_USD_18 = 3000n * 10n ** 18n;
const SUPPLY = 1_000_000_000n * 10n ** 18n;

const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };

describe("Equo: v2 invariants carried over (local)", function () {
  this.timeout(600_000);

  async function deployStack() {
    const [admin, creator, trader, feeWallet, outsider] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("WETH9")).deploy();
    await weth.waitForDeployment();
    const WETH = await weth.getAddress();

    const art = JSON.parse(
      readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"),
    );
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    await pm.waitForDeployment();
    const POOL_MANAGER = await pm.getAddress();

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();

    const Hook = await ethers.getContractFactory("EquoHook");
    const initCode = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, WETH])]);
    const hash = ethers.keccak256(initCode);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
    }
    if (!hookAddr) throw new Error("no hook salt found");
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoHook", hookAddr);

    const endpoint = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(30101);
    const tokenDeployer = await (await ethers.getContractFactory("EquoTokenDeployer")).deploy(admin.address, await endpoint.getAddress());
    const TD = await tokenDeployer.getAddress();
    const plainCreator = await (await ethers.getContractFactory("EquoTokenCreator")).deploy(TD);
    const divCreator = await (await ethers.getContractFactory("EquoDivTokenCreator")).deploy(TD);
    await (await tokenDeployer.setCreators(await plainCreator.getAddress(), await divCreator.getAddress())).wait();
    await tokenDeployer.waitForDeployment();
    const oracle = await (await ethers.getContractFactory("MockOneOracle")).deploy();
    await oracle.waitForDeployment();
    await (await oracle.set(WETH, ETH_USD_18)).wait();

    const factory = await (await ethers.getContractFactory("EquoFactory")).deploy(
      admin.address, admin.address, POOL_MANAGER, hookAddr, await tokenDeployer.getAddress(), WETH, await oracle.getAddress(), feeWallet.address, ethers.parseEther("0.001"),
    );
    await factory.waitForDeployment();
    const FACTORY = await factory.getAddress();

    const router = await (await ethers.getContractFactory("EquoRouter")).deploy(POOL_MANAGER, FACTORY, WETH);
    await router.waitForDeployment();

    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    await (await factory.setConverter(await router.getAddress())).wait();

    return { admin, creator, trader, feeWallet, outsider, weth, WETH, pm, POOL_MANAGER, hook, hookAddr, factory, FACTORY, router };
  }

  async function launch(factory: any, creator: any, genes: any, value: bigint, tag = "A") {
    const p = { name: `Coin ${tag}`, symbol: `C${tag}`, metadataURI: "ipfs://x", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [] as any[] };
    const MIN_FIRST_BUY = ethers.parseEther("0.001"); // the factory refuses a launch under its minimum first buy
    const tx = await factory.connect(creator).launch(p, ethers.id(`salt-${tag}`), "0x", "0x", { value: value < MIN_FIRST_BUY ? MIN_FIRST_BUY : value });
    const rc = await tx.wait();
    const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    return ev!.args.token as string;
  }

  it("hook is swap-only: four flags, no liquidity surface, holds no coins", async () => {
    const { hook, hookAddr, factory, creator, weth } = await deployStack();

    expect(BigInt(hookAddr) & FLAG_MASK).to.equal(HOOK_FLAGS);
    const perms = await hook.getHookPermissions();
    expect(perms.beforeSwap).to.equal(true);
    expect(perms.afterSwap).to.equal(true);
    expect(perms.beforeSwapReturnDelta).to.equal(true);
    expect(perms.afterSwapReturnDelta).to.equal(true);
    expect(perms.beforeInitialize).to.equal(false);
    expect(perms.beforeAddLiquidity).to.equal(false);
    expect(perms.beforeRemoveLiquidity).to.equal(false);
    expect(perms.afterAddLiquidity).to.equal(false);
    expect(perms.afterRemoveLiquidity).to.equal(false);
    expect(perms.beforeDonate).to.equal(false);

    const names = hook.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(names).to.not.include("collect");
    expect(names).to.not.include("positionOf");

    const token = await launch(factory, creator, FLAT, ethers.parseEther("1"));
    const coin = await ethers.getContractAt("EquoToken", token);
    expect(await coin.balanceOf(hookAddr)).to.equal(0n);
    expect(await weth.balanceOf(hookAddr)).to.equal(0n);

    // the factory holds the launch position; the coin sits in the PoolManager
    const pos = await factory.positionOf(token);
    expect(pos.liquidity).to.be.gt(0n);
    expect(await coin.balanceOf(await factory.poolManager())).to.be.gt(SUPPLY / 2n);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n); // dev buy landed
  });

  it("trades through the hook, routes fees, and pays the creator", async () => {
    const { hook, factory, creator, trader, outsider, router } = await deployStack();
    const token = await launch(factory, creator, FLAT, ethers.parseEther("0.5"));
    const coin = await ethers.getContractAt("EquoToken", token);

    await expect(router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).to.emit(hook, "FeeTaken");
    const bought = await coin.balanceOf(trader.address);
    expect(bought).to.be.gt(0n);
    const owedAfterBuy = await hook.creatorOwed(token);
    expect(owedAfterBuy).to.be.gt(0n);
    expect(await hook.platformOwed(token)).to.be.gt(0n);

    await (await coin.connect(trader).approve(await router.getAddress(), bought)).wait();
    await expect(router.connect(trader).sell(token, bought / 2n, "0x", 0, ethers.ZeroAddress)).to.emit(hook, "FeeTaken");
    expect(await hook.creatorOwed(token)).to.be.gt(owedAfterBuy);

    const before = await ethers.provider.getBalance(creator.address);
    await (await hook.connect(outsider).payCreator(token)).wait();
    expect(await ethers.provider.getBalance(creator.address)).to.be.gt(before);
    expect(await hook.creatorOwed(token)).to.equal(0n);
  });

  it("only the admin's disclosed collect touches liquidity (as on OneHook's deployed factory); the hook has none; trading never moves it", async () => {
    const { factory, hook, admin, creator, trader, router, pm, FACTORY } = await deployStack();
    const token = await launch(factory, creator, FLAT, ethers.parseEther("1"));
    await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("2") })).wait();

    // the hook has no withdraw surface; the factory's only one is the admin's collect, logged as Collected
    const hookNames = hook.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    for (const n of ["collect", "unwindPosition", "removeLiquidity"]) expect(hookNames).to.not.include(n);
    const facNames = factory.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
    expect(facNames).to.include("collect");
    for (const n of ["unwindPosition", "removeLiquidity"]) expect(facNames).to.not.include(n);
    expect(factory.interface.fragments.some((f: any) => f.type === "event" && f.name === "Collected")).to.equal(true);
    await expect(factory.connect(trader).collect(token, 10_000, trader.address)).to.be.revertedWithCustomError(factory, "NotAdmin");

    // the recorded position never changes: trading moves price, not liquidity
    const pos = await factory.positionOf(token);
    expect(pos.liquidity).to.be.gt(0n);
    await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.5") })).wait();
    expect((await factory.positionOf(token)).liquidity).to.equal(pos.liquidity);
    expect(FACTORY).to.equal(await factory.getAddress());

    // nobody can call the factory's unlock callback directly: a direct unlock from the admin reverts
    await expect(pm.connect(admin).unlock(ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "bytes"], [2, "0x"]))).to.be.reverted;
    // and the hook still taxes trades on the untouched pool
    await expect(router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("0.1") })).to.emit(hook, "FeeTaken");
  });

  it("buyback-burn and dividends still run from the hook", async () => {
    const { factory, hook, creator, trader, router } = await deployStack();
    const genes = { ...FLAT, buybackShareBps: 2_000, buybackThreshold: 1_000n, divShareBps: 3_000 };
    const token = await launch(factory, creator, genes, ethers.parseEther("1"), "B");
    const coin = await ethers.getContractAt("EquoDivToken", token);
    const supplyBefore = await coin.totalSupply();

    // the first taxed buy tips the pot past its 1000-wei threshold: an automatic buy-and-burn
    await expect(router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).to.emit(hook, "BuybackBurned");
    expect(await coin.totalSupply()).to.be.lt(supplyBefore);

    await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).wait();
    expect(await hook.dividendPot(token)).to.be.gt(0n);
    await expect(hook.pushDividends(token)).to.emit(hook, "DividendsPushed");
    expect(await coin.withdrawableDividends(trader.address)).to.be.gt(0n);
    const before = await ethers.provider.getBalance(trader.address);
    const rc = await (await coin.connect(trader).claimDividends()).wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    expect(await ethers.provider.getBalance(trader.address)).to.be.gt(before - gas);
  });

  it("the hook itself rejects genes above the constitution's caps", async () => {
    const { factory, hook, hookAddr, WETH, FACTORY } = await deployStack();
    await expect(launch(factory, (await ethers.getSigners())[1], { ...FLAT, feeBps: 400 }, 0n, "X")).to.be.revertedWithCustomError(factory, "BadGenes");

    // even a (hypothetical) factory that skipped its own checks cannot register an over-cap fee
    await network.provider.send("hardhat_impersonateAccount", [FACTORY]);
    await network.provider.send("hardhat_setBalance", [FACTORY, "0x1000000000000000000"]);
    const asFactory = await ethers.getSigner(FACTORY);
    const dummyToken = "0x0000000000000000000000000000000000000001";
    const key = { currency0: dummyToken, currency1: WETH, fee: 0, tickSpacing: 10, hooks: hookAddr };
    const stage = (g: any) => [{ sqrtThreshold: 0, mcapUsd8: 0, genes: g }];
    await expect(hook.connect(asFactory).registerPool(key, dummyToken, WETH, asFactory.address, stage({ ...FLAT, feeBps: 400 }))).to.be.revertedWithCustomError(hook, "BadGenes");
    await expect(hook.connect(asFactory).registerPool(key, dummyToken, WETH, asFactory.address, stage({ ...FLAT, snipeBps: 3_500, snipeBlocks: 10 }))).to.be.revertedWithCustomError(hook, "BadGenes");
    await expect(hook.connect(asFactory).registerPool(key, dummyToken, WETH, asFactory.address, stage({ ...FLAT, buybackShareBps: 5_000, divShareBps: 5_000, buybackThreshold: 1_000n }))).to.be.revertedWithCustomError(hook, "BadGenes");
    await network.provider.send("hardhat_stopImpersonatingAccount", [FACTORY]);
  });
});
