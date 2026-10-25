import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Equo (v3 of the OneHook design) on a fresh local chain with a real Uniswap V4 PoolManager.
 *
 * What this proves, on top of the v2 invariants (swap-only hook, permanent liquidity):
 *   - cashback comes only out of the platform's part of a fee and is claimable; there are no referrals;
 *   - launches pick a start cap from the admin's presets;
 *   - a creator can edit metadata, transfer the role in two steps, and is paid on the way out;
 *   - a community takeover needs an idle creator and a stake, can be cancelled, and executes after the delay.
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ETH_USD_18 = 3000n * 10n ** 18n;
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const STAKE = SUPPLY / 20n;
const DAY = 86_400;

const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };

describe("Equo: cashback, presets, creator transfer, takeover (local)", function () {
  this.timeout(600_000);

  async function deployStack() {
    const [admin, creator, trader, feeWallet, , outsider, newCreator] = await ethers.getSigners();
    let weth = await (await ethers.getContractFactory("WETH9")).deploy();
    // like every real wrapped native, WETH must sit above the coin address ceiling (0x1000…)
    while (BigInt(await weth.getAddress()) < 2n ** 156n) weth = await (await ethers.getContractFactory("WETH9")).deploy();
    const WETH = await weth.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    const POOL_MANAGER = await pm.getAddress();

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
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
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoHook", hookAddr);

    const endpoint = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(30101);
    const tokenDeployer = await (await ethers.getContractFactory("EquoTokenDeployer")).deploy(admin.address, admin.address);
    await (await tokenDeployer.setEndpoint(await endpoint.getAddress())).wait();
    const TD = await tokenDeployer.getAddress();
    const plainCreator = await (await ethers.getContractFactory("EquoTokenCreator")).deploy(TD);
    const divCreator = await (await ethers.getContractFactory("EquoDivTokenCreator")).deploy(TD);
    await (await tokenDeployer.setCreators(await plainCreator.getAddress(), await divCreator.getAddress())).wait();
    const oracle = await (await ethers.getContractFactory("MockOneOracle")).deploy();
    await (await oracle.set(WETH, ETH_USD_18)).wait();
    const rules = await (await ethers.getContractFactory("EquoLaunchRules")).deploy();
    const factory = await (await ethers.getContractFactory("EquoFactory", { libraries: { EquoLaunchRules: await rules.getAddress() } })).deploy(
      admin.address, admin.address, POOL_MANAGER, hookAddr, await tokenDeployer.getAddress(), WETH, await oracle.getAddress(), feeWallet.address, ethers.parseEther("0.001"),
    );
    const FACTORY = await factory.getAddress();
    const router = await (await ethers.getContractFactory("EquoRouter")).deploy(POOL_MANAGER, FACTORY, WETH);
    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    await (await factory.setConverter(await router.getAddress())).wait();
    return { admin, creator, trader, feeWallet, outsider, newCreator, weth, WETH, pm, hook, hookAddr, factory, FACTORY, router };
  }

  async function launch(factory: any, creator: any, genes: any, value: bigint, tag = "A", capPreset = 0) {
    const p = { name: `Coin ${tag}`, symbol: `C${tag}`, metadataURI: "ipfs://x", pair: ethers.ZeroAddress, minPairOut: 0, capPreset, genes, stages: [] as any[], split: 1 };
    // every launch opens with at least the factory's minimum first buy (0.001 ETH in these tests)
    const rc = await (await factory.connect(creator).launch(p, ethers.id(`salt-${tag}`), "0x", "0x", { value: value < MIN_FIRST_BUY ? MIN_FIRST_BUY : value })).wait();
    const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    return ev!.args.token as string;
  }
  const MIN_FIRST_BUY = ethers.parseEther("0.001");

  function feeOf(rc: any, hook: any): bigint {
    const ev = rc.logs.map((l: any) => { try { return hook.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "FeeTaken");
    return ev ? (ev.args.fee as bigint) : 0n;
  }

  it("keeps the v2 invariants: swap-only hook, no coins in the hook, router wired to the hook", async () => {
    const { hook, hookAddr, factory, creator, router } = await deployStack();
    expect(BigInt(hookAddr) & FLAG_MASK).to.equal(HOOK_FLAGS);
    const perms = await hook.getHookPermissions();
    expect(perms.beforeAddLiquidity).to.equal(false);
    expect(perms.beforeRemoveLiquidity).to.equal(false);
    expect(await hook.router()).to.equal(await router.getAddress());
    const token = await launch(factory, creator, FLAT, ethers.parseEther("0.1"));
    const coin = await ethers.getContractAt("EquoToken", token);
    expect(await coin.balanceOf(hookAddr)).to.equal(0n);
    expect((await factory.positionOf(token)).liquidity).to.be.gt(0n);
    expect(await factory.capOf(token)).to.equal(3_000n * 10n ** 8n);
  });

  it("pays cashback out of the platform part only, has no referrals, and lets traders claim", async () => {
    const { admin, hook, factory, creator, trader, router, WETH } = await deployStack();
    await (await factory.connect(admin).setCashback(2_500)).wait();
    await expect(factory.connect(admin).setCashback(5_001)).to.be.reverted;
    await expect(hook.setCashback(1)).to.be.revertedWithCustomError(hook, "NotFactory");
    // there is no referral surface left on the hook
    expect(hook.interface.getFunction("referrerOf" as any)).to.equal(null);
    expect(hook.interface.getFunction("referralBps" as any)).to.equal(null);
    const token = await launch(factory, creator, FLAT, 0n);

    const c0 = await hook.creatorOwed(token), p0 = await hook.platformOwed(token);
    const rc = await (await router.connect(trader).buy(token, "0x", 0, { value: ethers.parseEther("1") })).wait();
    const fee = feeOf(rc, hook);
    expect(fee).to.be.gt(0n);
    // creator 70%, platform 30% of what is left after the pots; cashback comes out of the platform's 30%
    expect(await hook.CREATOR_SPLIT_BPS()).to.equal(7_000);
    const creatorPart = (fee * 7_000n) / 10_000n, platformPart = fee - creatorPart;
    const cb = (platformPart * 2_500n) / 10_000n;
    expect((await hook.creatorOwed(token)) - c0).to.equal(creatorPart);
    expect((await hook.platformOwed(token)) - p0).to.equal(platformPart - cb);
    expect(await hook.rewardsOwed(trader.address, WETH)).to.equal(cb);
    const ev = rc!.logs.map((l: any) => { try { return hook.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "CashbackCredited");
    expect(ev!.args.trader).to.equal(trader.address);
    expect(ev!.args.amount).to.equal(cb);

    // claims pay ETH on a WETH pair and zero the balance
    const owed = await hook.rewardsOwed(trader.address, WETH);
    const before = await ethers.provider.getBalance(trader.address);
    const crc = await (await hook.connect(trader).claimRewards([WETH])).wait();
    const gas = crc!.gasUsed * crc!.gasPrice;
    expect((await ethers.provider.getBalance(trader.address)) + gas - before).to.equal(owed);
    expect(await hook.rewardsOwed(trader.address, WETH)).to.equal(0n);
    // claiming nothing is a no-op
    await (await hook.connect(trader).claimRewards([WETH])).wait();

    // sells through the router pay the trader cashback too
    const coin = await ethers.getContractAt("EquoToken", token);
    const bal = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), bal)).wait();
    await (await router.connect(trader).sell(token, bal / 2n, "0x", 0)).wait();
    expect(await hook.rewardsOwed(trader.address, WETH)).to.be.gt(0n);
  });

  it("buyFor: a payment from another chain buys for the trader, who gets the coins and the cashback", async () => {
    const { admin, hook, factory, creator, trader, outsider, router, WETH } = await deployStack();
    await (await factory.connect(admin).setCashback(2_500)).wait();
    const token = await launch(factory, creator, FLAT, 0n);
    const coin = await ethers.getContractAt("EquoToken", token);
    // `outsider` stands in for the cross-chain executor: it pays, the trader receives
    await (await router.connect(outsider).buyFor(token, "0x", 0, trader.address, { value: ethers.parseEther("0.5") })).wait();
    expect(await coin.balanceOf(trader.address)).to.be.gt(0n);
    expect(await coin.balanceOf(outsider.address)).to.equal(0n);
    expect(await coin.balanceOf(await router.getAddress())).to.equal(0n);
    expect(await hook.rewardsOwed(trader.address, WETH)).to.be.gt(0n); // cashback is the trader's
    expect(await hook.rewardsOwed(outsider.address, WETH)).to.equal(0n);
    await expect(router.connect(outsider).buyFor(token, "0x", 0, ethers.ZeroAddress, { value: 1n })).to.be.revertedWithCustomError(router, "ZeroAddress");
    await expect(router.connect(outsider).buyFor(token, "0x", ethers.MaxUint256, trader.address, { value: ethers.parseEther("0.01") })).to.be.revertedWithCustomError(router, "Slippage");
  });

  it("sellWithSig: the trader signs once with no ETH, a relayer submits, payTo gets the proceeds less a capped fee; no replay", async () => {
    const { admin, hook, factory, creator, trader, outsider, newCreator, router, WETH } = await deployStack();
    await (await factory.connect(admin).setCashback(2_500)).wait();
    const token = await launch(factory, creator, FLAT, 0n);
    const coin = await ethers.getContractAt("EquoToken", token);
    await (await router.connect(outsider).buyFor(token, "0x", 0, trader.address, { value: ethers.parseEther("0.5") })).wait();
    const amount = (await coin.balanceOf(trader.address)) / 2n;
    const ROUTER = await router.getAddress();
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3600);
    // EIP-2612 permit for the router, so the trader needs no approve transaction either
    const pSig = ethers.Signature.from(await trader.signTypedData(
      { name: await coin.name(), version: "1", chainId, verifyingContract: token },
      { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
      { owner: trader.address, spender: ROUTER, value: amount, nonce: await coin.nonces(trader.address), deadline },
    ));
    const permit = { deadline, v: pSig.v, r: pSig.r, s: pSig.s };
    const types = { SellIntent: [{ name: "owner", type: "address" }, { name: "coin", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "minEthOut", type: "uint256" }, { name: "maxFee", type: "uint256" }, { name: "payTo", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
    const domain = { name: "EquoRouter", version: "1", chainId, verifyingContract: ROUTER };
    // `newCreator` stands in for the payout address (the trader, or a cross-chain deposit address)
    const it_ = { owner: trader.address, coin: token, amountIn: amount, minEthOut: ethers.parseEther("0.1"), maxFee: ethers.parseEther("0.002"), payTo: newCreator.address, nonce: 0n, deadline };
    const sig = await trader.signTypedData(domain, types, it_);
    const fee = ethers.parseEther("0.0015");
    // a fee above the signed cap is refused
    await expect(router.connect(outsider).sellWithSig(it_, "0x", ethers.parseEther("0.003"), sig, permit)).to.be.revertedWithCustomError(router, "FeeTooHigh");
    // someone else's signature is refused
    const bad = await outsider.signTypedData(domain, types, it_);
    await expect(router.connect(outsider).sellWithSig(it_, "0x", fee, bad, permit)).to.be.revertedWithCustomError(router, "BadSignature");
    const payBefore = await ethers.provider.getBalance(newCreator.address), relBefore = await ethers.provider.getBalance(outsider.address);
    const cb0 = await hook.rewardsOwed(trader.address, WETH);
    const rc = await (await router.connect(outsider).sellWithSig(it_, "0x", fee, sig, permit)).wait();
    const ev = rc!.logs.map((l: any) => { try { return router.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "SoldWithSig");
    expect(ev!.args.fee).to.equal(fee);
    const paid = (await ethers.provider.getBalance(newCreator.address)) - payBefore;
    expect(paid).to.equal(ev!.args.ethOut - fee);
    expect(paid).to.be.gte(it_.minEthOut);
    const gas = rc!.gasUsed * rc!.gasPrice;
    expect((await ethers.provider.getBalance(outsider.address)) - relBefore + gas).to.equal(fee); // the relayer is repaid exactly the fee
    expect(await coin.balanceOf(trader.address)).to.equal(amount); // the other half is untouched
    expect(await hook.rewardsOwed(trader.address, WETH)).to.be.gt(cb0); // the sell's cashback is the trader's
    expect(await router.sellNonces(trader.address)).to.equal(1n);
    // the same signature never works twice
    await expect(router.connect(outsider).sellWithSig(it_, "0x", fee, sig, { deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash })).to.be.revertedWithCustomError(router, "BadSignature");
    // an expired intent is refused
    const late = { ...it_, nonce: 1n, deadline: 1n };
    await expect(router.connect(outsider).sellWithSig(late, "0x", 0n, await trader.signTypedData(domain, types, late), { deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash })).to.be.revertedWithCustomError(router, "Expired");
    // a minimum the pool cannot meet is refused and nothing moves
    const greedy = { ...it_, nonce: 1n, amountIn: 1000n * 10n ** 18n, minEthOut: ethers.parseEther("100") };
    await (await coin.connect(trader).approve(ROUTER, ethers.MaxUint256)).wait();
    await expect(router.connect(outsider).sellWithSig(greedy, "0x", 0n, await trader.signTypedData(domain, types, greedy), { deadline: 0n, v: 0, r: ethers.ZeroHash, s: ethers.ZeroHash })).to.be.revertedWithCustomError(router, "Slippage");
    expect(await router.sellNonces(trader.address)).to.equal(1n);
  });

  it("gives the creator cashback on their first buy, and nothing with zero cashback", async () => {
    const { admin, hook, factory, creator, WETH } = await deployStack();
    const t0 = await launch(factory, creator, FLAT, ethers.parseEther("0.5"), "Z");
    expect(await hook.rewardsOwed(creator.address, WETH)).to.equal(0n);
    await (await factory.connect(admin).setCashback(3_000)).wait();
    await launch(factory, creator, FLAT, ethers.parseEther("0.5"), "Y");
    expect(await hook.rewardsOwed(creator.address, WETH)).to.be.gt(0n);
    expect(t0).to.not.equal(ethers.ZeroAddress);
  });

  it("launches at the start cap preset the creator picks", async () => {
    const { admin, factory, creator } = await deployStack();
    await expect(factory.connect(creator).setCapPresets([1_000n * 10n ** 8n])).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(creator).setCashback(1)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(admin).setCapPresets([])).to.be.reverted;
    await expect(factory.connect(admin).setCapPresets([999n * 10n ** 8n])).to.be.reverted;
    await (await factory.connect(admin).setCapPresets([5_000n * 10n ** 8n, 12_500n * 10n ** 8n, 25_000n * 10n ** 8n])).wait();
    expect((await factory.capPresets()).length).to.equal(3);
    const a = await launch(factory, creator, FLAT, 0n, "P0", 0);
    const b = await launch(factory, creator, FLAT, 0n, "P2", 2);
    expect(await factory.capOf(a)).to.equal(5_000n * 10n ** 8n);
    expect(await factory.capOf(b)).to.equal(25_000n * 10n ** 8n);
    await expect(launch(factory, creator, FLAT, 0n, "P9", 3)).to.be.revertedWithCustomError(factory, "InvalidParams");
  });

  it("lets the creator edit metadata, with the admin override still winning", async () => {
    const { admin, factory, creator, outsider } = await deployStack();
    const token = await launch(factory, creator, FLAT, 0n);
    expect(await factory.metadataOf(token)).to.equal("ipfs://x");
    await expect(factory.connect(outsider).setCreatorMetadata(token, "nope")).to.be.revertedWithCustomError(factory, "NotCreator");
    await (await factory.connect(creator).setCreatorMetadata(token, "{\"description\":\"new\"}")).wait();
    expect(await factory.metadataOf(token)).to.equal("{\"description\":\"new\"}");
    await (await factory.connect(admin).setCoinMetadata(token, "moderated")).wait();
    expect(await factory.metadataOf(token)).to.equal("moderated");
  });

  it("transfers the creator role in two steps and pays the old creator first", async () => {
    const { hook, factory, creator, trader, newCreator, outsider, router } = await deployStack();
    const token = await launch(factory, creator, FLAT, 0n);
    await (await router.connect(trader).buy(token, "0x", 0, { value: ethers.parseEther("1") })).wait();
    const owed = await hook.creatorOwed(token);
    expect(owed).to.be.gt(0n);

    await expect(factory.connect(outsider).transferCreator(token, newCreator.address)).to.be.revertedWithCustomError(factory, "NotCreator");
    await (await factory.connect(creator).transferCreator(token, newCreator.address)).wait();
    expect(await hook.creatorOf(token)).to.equal(creator.address);
    await expect(factory.connect(outsider).acceptCreator(token)).to.be.revertedWithCustomError(factory, "NotCreator");

    const before = await ethers.provider.getBalance(creator.address);
    await (await factory.connect(newCreator).acceptCreator(token)).wait();
    expect(await hook.creatorOf(token)).to.equal(newCreator.address);
    expect(await hook.creatorOwed(token)).to.equal(0n);
    expect((await ethers.provider.getBalance(creator.address)) - before).to.equal(owed);
    expect(await factory.pendingCreator(token)).to.equal(ethers.ZeroAddress);

    // the old creator lost the role; the new one has it
    await expect(factory.connect(creator).poke(token)).to.be.revertedWithCustomError(factory, "NotCreator");
    await (await factory.connect(newCreator).poke(token)).wait();
    // only the factory can move the role in the hook
    await expect(hook.connect(outsider).setCreator(token, outsider.address)).to.be.revertedWithCustomError(hook, "NotFactory");
  });

  it("runs a community takeover: idle check, stake, cancel, delay, execute", async () => {
    const { hook, factory, creator, trader, newCreator, router, FACTORY } = await deployStack();
    const token = await launch(factory, creator, FLAT, 0n);
    const coin = await ethers.getContractAt("EquoToken", token);
    await (await router.connect(trader).buy(token, "0x", 0, { value: ethers.parseEther("2") })).wait();
    expect(await coin.balanceOf(trader.address)).to.be.gt(STAKE * 2n);
    await (await coin.connect(trader).approve(FACTORY, STAKE * 3n)).wait();

    // too early: the creator is not idle yet
    await expect(factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).to.be.revertedWithCustomError(factory, "TakeoverClosed");
    await time.increase(30 * DAY + 1);

    // propose locks the stake; the creator cancels and gets their clock reset
    const bal0 = await coin.balanceOf(trader.address);
    await (await factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).wait();
    expect(await coin.balanceOf(trader.address)).to.equal(bal0 - STAKE);
    await expect(factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).to.be.revertedWithCustomError(factory, "TakeoverClosed");
    await (await factory.connect(creator).cancelTakeover(token)).wait();
    expect(await coin.balanceOf(trader.address)).to.equal(bal0);
    await expect(factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).to.be.revertedWithCustomError(factory, "TakeoverClosed");

    // idle again; the proposer can withdraw their own proposal
    await time.increase(30 * DAY + 1);
    await (await factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).wait();
    await (await factory.connect(trader).cancelTakeover(token)).wait();
    expect(await coin.balanceOf(trader.address)).to.equal(bal0);

    // propose, wait out the delay, execute: role moves, stake returns, old creator is paid
    await (await factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).wait();
    await expect(factory.executeTakeover(token)).to.be.revertedWithCustomError(factory, "TakeoverClosed");
    await time.increase(7 * DAY + 1);
    const owed = await hook.creatorOwed(token);
    const before = await ethers.provider.getBalance(creator.address);
    await (await factory.connect(trader).executeTakeover(token)).wait();
    expect(await hook.creatorOf(token)).to.equal(newCreator.address);
    expect(await coin.balanceOf(trader.address)).to.equal(bal0);
    expect((await ethers.provider.getBalance(creator.address)) - before).to.equal(owed);
    expect((await factory.takeovers(token)).proposer).to.equal(ethers.ZeroAddress);
  });

  it("lets a bigger stake replace a running proposal and returns the earlier stake", async () => {
    const { factory, creator, trader, outsider, newCreator, router, FACTORY, hook } = await deployStack();
    const token = await launch(factory, creator, FLAT, 0n);
    const coin = await ethers.getContractAt("EquoToken", token);
    await (await router.connect(trader).buy(token, "0x", 0, { value: ethers.parseEther("2") })).wait();
    await (await router.connect(outsider).buy(token, "0x", 0, { value: ethers.parseEther("3") })).wait();
    await (await coin.connect(trader).approve(FACTORY, STAKE)).wait();
    await (await coin.connect(outsider).approve(FACTORY, STAKE * 2n)).wait();
    await time.increase(30 * DAY + 1);
    await expect(factory.connect(trader).proposeTakeover(token, trader.address, STAKE - 1n)).to.be.revertedWithCustomError(factory, "InvalidParams");
    const t0 = await coin.balanceOf(trader.address);
    await (await factory.connect(trader).proposeTakeover(token, trader.address, STAKE)).wait();
    await time.increase(6 * DAY);
    // equal stake cannot replace; a bigger one can, and restarts the clock
    await expect(factory.connect(outsider).proposeTakeover(token, newCreator.address, STAKE)).to.be.revertedWithCustomError(factory, "TakeoverClosed");
    await (await factory.connect(outsider).proposeTakeover(token, newCreator.address, STAKE * 2n)).wait();
    expect(await coin.balanceOf(trader.address)).to.equal(t0);
    await time.increase(2 * DAY);
    await expect(factory.executeTakeover(token)).to.be.revertedWithCustomError(factory, "TakeoverClosed");
    await time.increase(5 * DAY + 1);
    const o0 = await coin.balanceOf(outsider.address);
    await (await factory.executeTakeover(token)).wait();
    expect(await hook.creatorOf(token)).to.equal(newCreator.address);
    expect(await coin.balanceOf(outsider.address)).to.equal(o0 + STAKE * 2n);
  });

  it("keeps OneHook's admin levers 1:1: collect and setStartCap", async () => {
    const { admin, hook, factory, creator, trader, outsider, router, weth, WETH } = await deployStack();
    const token = await launch(factory, creator, FLAT, 0n);
    await (await router.connect(trader).buy(token, "0x", 0, { value: ethers.parseEther("1") })).wait();
    const coin = await ethers.getContractAt("EquoToken", token);

    // collect: admin only, takes a share of the launch position to the recipient, logs Collected
    await expect(factory.connect(outsider).collect(token, 5_000, outsider.address)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(admin).collect(token, 0, admin.address)).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(factory.connect(admin).collect(token, 10_001, admin.address)).to.be.revertedWithCustomError(factory, "InvalidParams");
    const liq0 = (await factory.positionOf(token)).liquidity;
    const owed0 = await hook.creatorOwed(token), plat0 = await hook.platformOwed(token);
    const c0 = await coin.balanceOf(outsider.address), w0 = await weth.balanceOf(outsider.address);
    await expect(factory.connect(admin).collect(token, 5_000, outsider.address)).to.emit(factory, "Collected");
    expect((await factory.positionOf(token)).liquidity).to.equal(liq0 - liq0 / 2n);
    expect(await coin.balanceOf(outsider.address)).to.be.gt(c0);
    expect(await weth.balanceOf(outsider.address)).to.be.gt(w0);
    // fee pots are untouched
    expect(await hook.creatorOwed(token)).to.equal(owed0);
    expect(await hook.platformOwed(token)).to.equal(plat0);
    // the rest can be collected too
    await (await factory.connect(admin).collect(token, 10_000, outsider.address)).wait();
    expect((await factory.positionOf(token)).liquidity).to.equal(0n);
    await expect(factory.connect(admin).collect(token, 10_000, outsider.address)).to.be.revertedWithCustomError(factory, "InvalidParams");

    // setStartCap: admin only, $1,000 to $100,000, sets the default preset
    await expect(factory.connect(outsider).setStartCap(2_000n * 10n ** 8n)).to.be.revertedWithCustomError(factory, "NotAdmin");
    await expect(factory.connect(admin).setStartCap(999n * 10n ** 8n)).to.be.revertedWithCustomError(factory, "InvalidParams");
    await expect(factory.connect(admin).setStartCap(100_001n * 10n ** 8n)).to.be.revertedWithCustomError(factory, "InvalidParams");
    await (await factory.connect(admin).setStartCap(7_500n * 10n ** 8n)).wait();
    expect(await factory.startCapUsd8()).to.equal(7_500n * 10n ** 8n);
    const t2 = await launch(factory, creator, FLAT, 0n, "SC");
    expect(await factory.capOf(t2)).to.equal(7_500n * 10n ** 8n);
    expect(WETH).to.not.equal(ethers.ZeroAddress);
  });

  it("blocks a takeover when the creator shows up during the delay", async () => {
    const { factory, creator, trader, newCreator, router, FACTORY, hook } = await deployStack();
    const token = await launch(factory, creator, FLAT, 0n);
    const coin = await ethers.getContractAt("EquoToken", token);
    await (await router.connect(trader).buy(token, "0x", 0, { value: ethers.parseEther("2") })).wait();
    await (await coin.connect(trader).approve(FACTORY, STAKE)).wait();
    await time.increase(30 * DAY + 1);
    await (await factory.connect(trader).proposeTakeover(token, newCreator.address, STAKE)).wait();
    await time.increase(DAY);
    await (await factory.connect(creator).poke(token)).wait();
    await time.increase(7 * DAY);
    await expect(factory.executeTakeover(token)).to.be.revertedWithCustomError(factory, "TakeoverClosed");
    expect(await hook.creatorOf(token)).to.equal(creator.address);
    await (await factory.connect(trader).cancelTakeover(token)).wait();
  });
});
