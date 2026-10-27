import { expect } from "chai";
import { ethers, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Equo windows on HyperEVM, on a fresh local chain with a real Uniswap v4 PoolManager and HyperCore's price
 * precompile mocked at its address.
 *
 * What this proves:
 *   - a launch opens at $3,000 single-sided, with or without a launch buy, inside HyperEVM's small block;
 *   - a window takes coins out of the pool without moving the price, and keeps its HYPE out of the pool: no seller
 *     can reach it, whatever the price does;
 *   - undo pays back every wei spent on coins, before or after the price passes the hole; keep sends the coins to
 *     the buyer and the HYPE into the pool; the premium is burned in coins either way; only the buyer can undo,
 *     anyone can keep after expiry;
 *   - the admin's collect works across a fragmented liquidity list, in one call or page by page, and never touches
 *     what open windows hold, which can still be undone in full afterwards;
 *   - a long random run of buys, sells, opens, undos and keeps leaves every window closable and the books exact.
 */

const HOOK_FLAGS = (1n << 13n) | (1n << 11n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ORACLE_PX = "0x0000000000000000000000000000000000000807";
const E18 = 10n ** 18n;
const SUPPLY = 1_000_000_000n * E18;
const HYPE_IDX = 159, HYPE_SZ = 2, HYPE_RAW = 400_000n; // $40.00 with 6 - 2 = 4 decimals
const SMALL_BLOCK_GAS = 2_000_000n;
const DAY = 86_400n;

describe("Equo windows on HyperEVM (local)", function () {
  this.timeout(900_000);

  async function deploy() {
    const [admin, creator, alice, bob, carol, feeWallet, outsider] = await ethers.getSigners();
    const whype = await (await ethers.getContractFactory("WETH9")).deploy();
    const WHYPE = await whype.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    const PM = await pm.getAddress();

    const coreImpl = await (await ethers.getContractFactory("MockHyperCore")).deploy();
    await network.provider.send("hardhat_setCode", [ORACLE_PX, await ethers.provider.getCode(await coreImpl.getAddress())]);
    const core = await ethers.getContractAt("MockHyperCore", ORACLE_PX);
    await (await core.set(HYPE_IDX, HYPE_RAW)).wait();
    const oracle = await (await ethers.getContractFactory("LiqioOracle")).deploy(admin.address);
    await (await oracle.setCore(WHYPE, HYPE_IDX, HYPE_SZ, E18, false)).wait();

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EquoWindowHook");
    const initCode = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [PM, WHYPE])]);
    const hash = ethers.keccak256(initCode);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
    }
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoWindowHook", hookAddr);
    const windows = await (await ethers.getContractFactory("EquoWindows")).deploy(PM, hookAddr, WHYPE);
    const WIN = await windows.getAddress();
    const tokenDeployer = await (await ethers.getContractFactory("LiqioTokenDeployer")).deploy(admin.address);
    const factory = await (await ethers.getContractFactory("EquoWindowFactory")).deploy(
      admin.address, PM, hookAddr, WIN, await tokenDeployer.getAddress(), await oracle.getAddress(), WHYPE, feeWallet.address,
    );
    const FACTORY = await factory.getAddress();
    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.wire(FACTORY, WIN)).wait();
    await (await windows.setFactory(FACTORY)).wait();
    const router = await (await ethers.getContractFactory("EquoWindowRouter")).deploy(PM, WIN, WHYPE);
    return { admin, creator, alice, bob, carol, feeWallet, outsider, whype, WHYPE, pm, PM, core, oracle, hook, windows, WIN, factory, router };
  }

  type Stack = Awaited<ReturnType<typeof deploy>>;

  async function launch(s: Stack, value = 0n, feeBps = 100, tag = "A") {
    const rc = await (await s.factory.connect(s.creator).launch(`Coin ${tag}`, `C${tag}`, "ipfs://x", feeBps, ethers.id(tag), { value })).wait();
    const ev = rc!.logs.map((l: any) => { try { return s.factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l?.name === "Launched");
    const token = await ethers.getContractAt("LiqioToken", ev!.args.token);
    return { token, addr: ev!.args.token as string, gas: rc!.gasUsed as bigint };
  }

  const deadline = async () => BigInt(await time.latest()) + 3600n;
  async function buy(s: Stack, who: any, addr: string, hype: bigint) {
    const t = await ethers.getContractAt("LiqioToken", addr);
    const before = await t.balanceOf(who.address);
    await (await s.router.connect(who).buy(addr, 0, await deadline(), { value: hype })).wait();
    return (await t.balanceOf(who.address)) - before;
  }
  async function sell(s: Stack, who: any, addr: string, amount: bigint) {
    const t = await ethers.getContractAt("LiqioToken", addr);
    await (await t.connect(who).approve(await s.router.getAddress(), amount)).wait();
    const before = await ethers.provider.getBalance(who.address);
    const rc = await (await s.router.connect(who).sell(addr, amount, 0, await deadline())).wait();
    return (await ethers.provider.getBalance(who.address)) - before + rc!.gasUsed * rc!.gasPrice;
  }
  const hintOf = async (s: Stack, addr: string) => {
    const [, tick] = await s.windows.priceOf(addr);
    return s.windows.segmentAt(addr, tick);
  };
  /** Open a window: `spend` on coins, a premium for `secs` of window, the coin's fee on top. */
  async function open(s: Stack, who: any, addr: string, spend: bigint, secs: bigint, feeBps = 100n) {
    const premium = await s.windows.premiumFor(spend, secs);
    const fee = (spend * feeBps) / 10_000n;
    const value = spend + fee + premium + 1n; // +1: the contract rounds the spend down
    const rc = await (await s.windows.connect(who).openWindow(addr, premium, 0, await hintOf(s, addr), { value })).wait();
    const ev = rc!.logs.map((l: any) => { try { return s.windows.interface.parseLog(l); } catch { return null; } }).find((l: any) => l?.name === "WindowOpened");
    return { id: ev!.args.id as bigint, coins: ev!.args.coins as bigint, spent: ev!.args.spent as bigint, premium: ev!.args.premium as bigint, expiry: ev!.args.expiry as bigint, gas: rc!.gasUsed as bigint };
  }
  const poolWhype = async (s: Stack) => s.whype.balanceOf(s.PM);
  const mcapUsd = async (s: Stack, addr: string) => {
    const [sqrtP] = await s.windows.priceOf(addr);
    const p = Number(sqrtP) / 2 ** 96;
    return p * p * 1e9 * 40; // HYPE per coin x 1B coins x $40
  };

  it("launches at $3,000 single-sided, with or without a launch buy, in a small block", async function () {
    const s = await deploy();
    const a = await launch(s, 0n, 100, "A");
    expect(a.gas).to.be.lessThan(SMALL_BLOCK_GAS);
    const m = await mcapUsd(s, a.addr);
    expect(m).to.be.within(3000, 3000 * 1.0011);
    expect(await poolWhype(s)).to.equal(0n);
    expect(await a.token.balanceOf(s.PM)).to.be.greaterThan(SUPPLY - 10n ** 13n);
    const b = await launch(s, ethers.parseEther("10"), 100, "B");
    expect(b.gas).to.be.lessThan(SMALL_BLOCK_GAS);
    // 10 HYPE ($400) into a $3,000 curve buys about 400/3400 of the coins, fee-free
    const got = await b.token.balanceOf(s.creator.address);
    expect(Number(got) / Number(SUPPLY)).to.be.within(0.1170, 0.1177);
  });

  it("a window takes coins out without moving the price and keeps its HYPE out of the pool", async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, 0n);
    await buy(s, s.bob, addr, ethers.parseEther("5"));
    // what a plain swap would buy now with the same HYPE on coins (the swap takes its 1% fee from what it is sent)
    const snap = await network.provider.send("evm_snapshot");
    const direct = await buy(s, s.carol, addr, ethers.parseEther("10.102"));
    await network.provider.send("evm_revert", [snap]);
    const [p0] = await s.windows.priceOf(addr);
    const poolBefore = await poolWhype(s);
    const preview = await s.windows.previewWindow(addr, ethers.parseEther("10"), await hintOf(s, addr));
    const w = await open(s, s.alice, addr, ethers.parseEther("10"), 6n * 3600n);
    expect(w.gas).to.be.lessThan(SMALL_BLOCK_GAS);
    const [p1] = await s.windows.priceOf(addr);
    expect(p1).to.equal(p0);
    expect(w.coins).to.be.closeTo(preview, preview / 10n ** 9n + 10n);
    // the pool gained only the fee (as the hook's claims) and a few wei of rounding, not the 10 HYPE
    expect((await poolWhype(s)) - poolBefore).to.be.closeTo(ethers.parseEther("10") / 100n, 10n);
    expect(await token.balanceOf(s.WIN)).to.be.greaterThanOrEqual(w.coins);
    expect(await s.windows.heldWhype()).to.equal(w.spent + w.premium);
    // 6 hours at 4% a day is 1% of the spend
    expect(w.premium).to.be.closeTo(ethers.parseEther("0.1"), 10n ** 12n);
    expect(w.expiry - BigInt(await time.latest())).to.be.closeTo(6n * 3600n, 5n);
    // the swap bought a little more: the window skips the step at the price
    expect(direct).to.be.greaterThan(w.coins);
    expect(Number(w.coins) / Number(direct)).to.be.greaterThan(0.99);
    // the creator and platform split the fee on the spend
    const fee = ethers.parseEther("10") / 100n;
    expect((await s.hook.creatorOwed(addr)) + (await s.hook.platformOwed(addr))).to.be.greaterThanOrEqual(fee);
  });

  it("undo before the price moves: every wei back, the pool exactly as it was, the premium burned", async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, 0n);
    await buy(s, s.bob, addr, ethers.parseEther("5"));
    const segsBefore = await s.windows.segmentsOf(addr, -887272, 50);
    const poolCoins = await token.balanceOf(s.PM);
    const w = await open(s, s.alice, addr, ethers.parseEther("20"), DAY);
    const bal = await ethers.provider.getBalance(s.alice.address);
    const supply = await token.totalSupply();
    const rc = await (await s.windows.connect(s.alice).undo(w.id, await hintOf(s, addr))).wait();
    expect(rc!.gasUsed).to.be.lessThan(SMALL_BLOCK_GAS);
    const back = (await ethers.provider.getBalance(s.alice.address)) - bal + rc!.gasUsed * rc!.gasPrice;
    expect(back).to.equal(w.spent);
    // the liquidity list merged back to what it was
    const segsAfter = await s.windows.segmentsOf(addr, -887272, 50);
    expect(segsAfter[0].length).to.equal(segsBefore[0].length);
    for (let i = 0; i < segsAfter[0].length; i++) {
      expect(segsAfter[0][i]).to.equal(segsBefore[0][i]);
      expect(segsAfter[2][i]).to.equal(segsBefore[2][i]);
    }
    // the premium bought coins that are gone for good
    expect(await token.totalSupply()).to.be.lessThan(supply);
    expect(await token.balanceOf(s.PM)).to.be.lessThan(poolCoins);
    expect(await s.windows.heldWhype()).to.equal(0n);
    expect(await s.windows.heldCoins(addr)).to.equal(0n);
    // it can only happen once, and only by the buyer
    await expect(s.windows.connect(s.alice).undo(w.id, 0)).to.be.revertedWithCustomError(s.windows, "NotOpen");
    const w2 = await open(s, s.alice, addr, ethers.parseEther("1"), DAY);
    await expect(s.windows.connect(s.bob).undo(w2.id, 0)).to.be.revertedWithCustomError(s.windows, "NotOwner");
  });

  it("sellers never reach a window's HYPE, and undo still pays it all back after the price passes the hole", async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, 0n);
    const w = await open(s, s.alice, addr, ethers.parseEther("30"), 2n * DAY);
    // others buy through the hole and dump everything
    const b = await buy(s, s.bob, addr, ethers.parseEther("50"));
    const c = await buy(s, s.carol, addr, ethers.parseEther("20"));
    await sell(s, s.bob, addr, b);
    await sell(s, s.carol, addr, c);
    // the pool paid sellers only what buyers left in it
    expect(await s.whype.balanceOf(s.WIN)).to.be.greaterThanOrEqual(w.spent + w.premium);
    // price went up through the hole: undo puts the coins just above the price, and pays the HYPE back
    const b2 = await buy(s, s.bob, addr, ethers.parseEther("60"));
    const [, tickNow] = await s.windows.priceOf(addr);
    const [, , , , bottom] = await s.windows.windows(w.id);
    expect(tickNow).to.be.greaterThanOrEqual(bottom);
    const bal = await ethers.provider.getBalance(s.alice.address);
    const rc = await (await s.windows.connect(s.alice).undo(w.id, await hintOf(s, addr))).wait();
    expect((await ethers.provider.getBalance(s.alice.address)) - bal + rc!.gasUsed * rc!.gasPrice).to.equal(w.spent);
    // and everyone can still sell out
    await sell(s, s.bob, addr, b2);
    expect(await s.windows.heldWhype()).to.equal(0n);
    void token;
  });

  it("keep: coins to the buyer, HYPE into the pool; anyone can keep after expiry", async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, 0n);
    await buy(s, s.bob, addr, ethers.parseEther("5"));
    const w = await open(s, s.alice, addr, ethers.parseEther("10"), 3600n);
    await expect(s.windows.connect(s.bob).keep(w.id, 0)).to.be.revertedWithCustomError(s.windows, "NotExpired");
    // the price has not reached the hole: keep completes the purchase as a plain swap, no hole left
    const poolBefore = await poolWhype(s);
    const rc = await (await s.windows.connect(s.alice).keep(w.id, await hintOf(s, addr))).wait();
    expect(rc!.gasUsed).to.be.lessThan(SMALL_BLOCK_GAS);
    const got = await token.balanceOf(s.alice.address);
    expect(got).to.equal(w.coins);
    expect((await poolWhype(s)) - poolBefore).to.be.closeTo(w.spent + w.premium, 10n ** 10n);
    const [, tk] = await s.windows.priceOf(addr);
    const sg = await s.windows.segmentsOf(addr, -887272, 50);
    for (let i = 0; i < sg[0].length; i++) if (sg[1][i] > tk) expect(sg[2][i]).to.be.greaterThan(0n);
    // and a seller gets back about what was paid, less the fees and the price impact both ways
    const hype = await sell(s, s.alice, addr, got);
    expect(hype).to.be.within(ethers.parseEther("9.3"), ethers.parseEther("10"));

    // the price has passed the hole: the buyer gets the window's coins, the HYPE becomes support below the price
    const w3 = await open(s, s.alice, addr, ethers.parseEther("3"), 3600n);
    await buy(s, s.bob, addr, ethers.parseEther("20"));
    const before3 = await token.balanceOf(s.alice.address);
    await (await s.windows.connect(s.alice).keep(w3.id, await hintOf(s, addr))).wait();
    expect((await token.balanceOf(s.alice.address)) - before3).to.equal(w3.coins);

    const w2 = await open(s, s.carol, addr, ethers.parseEther("2"), 3600n);
    await time.increase(3601);
    await expect(s.windows.connect(s.carol).undo(w2.id, 0)).to.be.revertedWithCustomError(s.windows, "Expired");
    await (await s.windows.connect(s.outsider).keep(w2.id, 0)).wait();
    expect(await token.balanceOf(s.carol.address)).to.equal(w2.coins);
    expect(await token.balanceOf(s.outsider.address)).to.equal(0n);
  });

  it("pushing the price up before someone else's keep does not pay: the HYPE lands no higher than the hole", async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, 0n);
    await buy(s, s.bob, addr, ethers.parseEther("5"));
    const w = await open(s, s.alice, addr, ethers.parseEther("20"), 3600n);
    const piecesOf = await s.windows.piecesOf(w.id);
    const holeTop = piecesOf[piecesOf.length - 1][1];
    await time.increase(3601);
    // the attacker pumps far past the hole, keeps alice's window, and dumps
    const hypeBefore = await ethers.provider.getBalance(s.carol.address);
    const got = await buy(s, s.carol, addr, ethers.parseEther("200"));
    await (await s.windows.connect(s.carol).keep(w.id, await hintOf(s, addr))).wait();
    expect(await token.balanceOf(s.alice.address)).to.equal(w.coins);
    // alice's HYPE refilled her hole (all below the pumped price): nothing new sits above the hole's top
    const sg = await s.windows.segmentsOf(addr, -887272, 100);
    let above = 0n;
    for (let i = 0; i < sg[0].length; i++) if (sg[0][i] >= holeTop) above += sg[2][i];
    const base = sg[2][sg[2].length - 1];
    expect(above).to.be.lessThanOrEqual(base * BigInt(sg[0].length));
    // and the round trip loses the attacker money
    await sell(s, s.carol, addr, got);
    expect(await ethers.provider.getBalance(s.carol.address)).to.be.lessThan(hypeBefore);
  });

  it("premiums: too little refused, past 7 days refunded", async function () {
    const s = await deploy();
    const { addr } = await launch(s, 0n);
    const spend = ethers.parseEther("10");
    const short = await s.windows.premiumFor(spend, 1200n);
    await expect(s.windows.connect(s.alice).openWindow(addr, short, 0, 0, { value: spend + spend / 100n + short + 1n })).to.be.revertedWithCustomError(s.windows, "WindowTooShort");
    const big = ethers.parseEther("5");
    const bal = await ethers.provider.getBalance(s.alice.address);
    const rc = await (await s.windows.connect(s.alice).openWindow(addr, big, 0, 0, { value: spend + spend / 100n + big + 1n })).wait();
    const ev = rc!.logs.map((l: any) => { try { return s.windows.interface.parseLog(l); } catch { return null; } }).find((l: any) => l?.name === "WindowOpened");
    expect(ev!.args.expiry - BigInt((await ethers.provider.getBlock(rc!.blockNumber))!.timestamp)).to.equal(7n * DAY);
    // 7 days at 4% a day: 28% of the spend; the rest of the 5 HYPE came back
    expect(ev!.args.premium).to.be.closeTo(ethers.parseEther("2.8"), 10n ** 10n);
    const paid = bal - (await ethers.provider.getBalance(s.alice.address)) - rc!.gasUsed * rc!.gasPrice;
    expect(paid).to.be.closeTo(spend + spend / 100n + ethers.parseEther("2.8"), 10n ** 10n);
  });

  it("admin collect works across a fragmented list, in pages, and never touches open windows", async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, 0n);
    // fragment the list: windows opened at different prices, some kept, some left open
    const open1 = await open(s, s.alice, addr, ethers.parseEther("8"), DAY);
    await buy(s, s.bob, addr, ethers.parseEther("15"));
    const kept = await open(s, s.carol, addr, ethers.parseEther("6"), DAY);
    await (await s.windows.connect(s.carol).keep(kept.id, await hintOf(s, addr))).wait();
    await buy(s, s.bob, addr, ethers.parseEther("10"));
    const open2 = await open(s, s.alice, addr, ethers.parseEther("5"), DAY);
    const before = await s.windows.segmentsOf(addr, -887272, 200);
    expect(before[0].length).to.be.greaterThan(4);
    const total = before[2].reduce((a: bigint, b: bigint) => a + b, 0n);

    await expect(s.factory.connect(s.alice).collect(addr, 5000, s.alice.address, -887272, 100)).to.be.revertedWithCustomError(s.factory, "NotAdmin");
    // page by page, two segments at a time
    const coins0 = await token.balanceOf(s.admin.address), whype0 = await s.whype.balanceOf(s.admin.address);
    let from = -887272n, pages = 0;
    const top = (await s.windows.books(addr))[2];
    while (from !== top) {
      const next = await s.factory.connect(s.admin).collect.staticCall(addr, 5000, s.admin.address, from, 2);
      await (await s.factory.connect(s.admin).collect(addr, 5000, s.admin.address, from, 2)).wait();
      from = next[0];
      pages++;
    }
    expect(pages).to.equal(Math.ceil(before[0].length / 2));
    const after = await s.windows.segmentsOf(addr, -887272, 200);
    for (let i = 0; i < after[0].length; i++) expect(after[2][i]).to.equal(before[2][i] - (before[2][i] * 5000n) / 10_000n);
    expect(await token.balanceOf(s.admin.address)).to.be.greaterThan(coins0);
    expect(await s.whype.balanceOf(s.admin.address)).to.be.greaterThan(whype0);
    // open windows untouched: both undo in full
    for (const w of [open1, open2]) {
      const bal = await ethers.provider.getBalance(s.alice.address);
      const rc = await (await s.windows.connect(s.alice).undo(w.id, await hintOf(s, addr))).wait();
      expect((await ethers.provider.getBalance(s.alice.address)) - bal + rc!.gasUsed * rc!.gasPrice).to.equal(w.spent);
    }
    // and the rest in one call
    const rc = await (await s.factory.connect(s.admin).collect(addr, 10_000, s.admin.address, -887272, 1000)).wait();
    expect(rc!.gasUsed).to.be.lessThan(30_000_000n);
    const gone = await s.windows.segmentsOf(addr, -887272, 200);
    for (const l of gone[2]) expect(l).to.equal(0n);
    void total;
  });

  for (const runSeed of [12345, 777, 4242]) it(`a long random run (seed ${runSeed}) with a paged admin collect leaves every window closable and the books exact`, async function () {
    const s = await deploy();
    const { addr, token } = await launch(s, ethers.parseEther("2"));
    const traders = [s.alice, s.bob, s.carol];
    const holding = new Map<string, bigint>();
    const openIds: { id: bigint; who: any; spent: bigint; expiry: bigint }[] = [];
    let seed = runSeed;
    let maxGas = 0n;
    const track = (g: bigint) => { if (g > maxGas) maxGas = g; };
    // mulberry32
    const rnd = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return (((x ^ (x >>> 14)) >>> 0) % n);
    };
    const counts = [0, 0, 0, 0, 0, 0];
    let refused = 0;
    for (let step = 0; step < 150; step++) {
      const who = traders[rnd(3)];
      const action = rnd(6);
      counts[action]++;
      const amt = ethers.parseEther(String(1 + rnd(20)));
      if (action <= 1) {
        const got = await buy(s, who, addr, amt);
        holding.set(who.address, (holding.get(who.address) ?? 0n) + got);
      } else if (action === 2) {
        const h = holding.get(who.address) ?? 0n;
        if (h > 0n) { await sell(s, who, addr, h / 2n); holding.set(who.address, h - h / 2n); }
      } else if (action === 3) {
        let w: any;
        try { w = await open(s, who, addr, amt, 3600n * BigInt(1 + rnd(48))); } catch (e: any) {
          // a window spanning too many liquidity segments is refused; the app then offers a smaller one
          if (!String(e.message).includes("TooFragmented")) throw e;
          refused++;
          continue;
        }
        track(w.gas);
        openIds.push({ id: w.id, who, spent: w.spent, expiry: w.expiry });
      } else if (openIds.length > 0) {
        const k = openIds.splice(rnd(openIds.length), 1)[0];
        const now = BigInt(await time.latest());
        if (action === 4 && now < k.expiry) {
          const bal = await ethers.provider.getBalance(k.who.address);
          const rc = await (await s.windows.connect(k.who).undo(k.id, await hintOf(s, addr))).wait();
          track(rc!.gasUsed);
          expect((await ethers.provider.getBalance(k.who.address)) - bal + rc!.gasUsed * rc!.gasPrice).to.equal(k.spent);
        } else {
          const before = await token.balanceOf(k.who.address);
          track((await (await s.windows.connect(k.who).keep(k.id, await hintOf(s, addr))).wait())!.gasUsed);
          holding.set(k.who.address, (holding.get(k.who.address) ?? 0n) + (await token.balanceOf(k.who.address)) - before);
        }
      }
      if (rnd(4) === 0) await time.increase(1800 + rnd(7200));
    }
    // the admin collects 30% in pages of 5 segments, with windows still open
    const heldBefore = await s.windows.heldWhype();
    const top = (await s.windows.books(addr))[2];
    let from = -887272n, pages = 0;
    while (from !== top) {
      const next = await s.factory.connect(s.admin).collect.staticCall(addr, 3000, s.admin.address, from, 5);
      const rc = await (await s.factory.connect(s.admin).collect(addr, 3000, s.admin.address, from, 5)).wait();
      expect(rc!.gasUsed).to.be.lessThan(SMALL_BLOCK_GAS);
      from = next[0];
      pages++;
    }
    expect(await s.windows.heldWhype()).to.equal(heldBefore);
    console.log(`      collect: ${pages} pages, ${openIds.length} windows open`);
    // every open window still closes: undo (in full) where possible, keep otherwise
    for (const k of openIds) {
      const now = BigInt(await time.latest());
      if (now < k.expiry) {
        const bal = await ethers.provider.getBalance(k.who.address);
        const rc = await (await s.windows.connect(k.who).undo(k.id, await hintOf(s, addr))).wait();
        expect((await ethers.provider.getBalance(k.who.address)) - bal + rc!.gasUsed * rc!.gasPrice).to.equal(k.spent);
      } else await (await s.windows.connect(k.who).keep(k.id, await hintOf(s, addr))).wait();
    }
    expect(await s.windows.heldWhype()).to.equal(0n);
    expect(await s.windows.heldCoins(addr)).to.equal(0n);
    // everyone can sell everything they hold
    for (const t of traders) {
      const h = await token.balanceOf(t.address);
      if (h > 0n) await sell(s, t, addr, h);
    }
    const segs = await s.windows.segmentsOf(addr, -887272, 500);
    expect(maxGas).to.be.lessThan(SMALL_BLOCK_GAS);
    console.log(`      actions ${counts.join("/")}, ${refused} windows refused, max window gas ${maxGas}, ${segs[0].length} segments after the run`);
    expect(counts[3] - refused).to.be.greaterThan(10);
    expect(refused * 5).to.be.lessThan(counts[3]);
  });
});
