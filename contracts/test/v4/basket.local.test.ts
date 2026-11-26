import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Basket launchpad end to end on a fresh local chain: our own Uniswap v4
 * PoolManager, a WETH9, a mock B-20 factory (real B-20s are precompiles), a
 * mock tokenized stock and a mock Slipstream router. Covers the admin model,
 * launch rules, the pair-only fee engine in all four swap shapes, graduation,
 * holder rewards, creator mode, the revenue split, and the Basket NFT pot.
 */

// beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta | afterSwapReturnsDelta
const HOOK_FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

const E = ethers.parseEther;
const START_MCAP = E("3.9");
const GRAD_MCAP = E("29");
const MIN_OPENING_BUY = E("0.005");
const LAUNCH_FEE = E("0.0005");
const MINT_PRICE = E("0.03");
const SUPPLY = E("1000000000");

const coder = ethers.AbiCoder.defaultAbiCoder();
const leafOf = (account: string, amount: bigint) =>
  ethers.keccak256(ethers.keccak256(coder.encode(["address", "uint256"], [account, amount])));
const pairHash = (a: string, b: string) =>
  ethers.keccak256(BigInt(a) < BigInt(b) ? ethers.concat([a, b]) : ethers.concat([b, a]));
/** Two-leaf tree in the OpenZeppelin StandardMerkleTree encoding. */
function tree2(a: [string, bigint], b: [string, bigint]) {
  const la = leafOf(...a), lb = leafOf(...b);
  return { root: pairHash(la, lb), proofA: [lb], proofB: [la] };
}
const slipPath = (tokenIn: string, tokenOut: string) =>
  ethers.solidityPacked(["address", "int24", "address"], [tokenIn, 10, tokenOut]);

describe("Basket launchpad (local)", function () {
  this.timeout(600_000);

  async function deployStack() {
    const [admin, creator, trader, keeper, treasury, feeWallet, stranger, other] = await ethers.getSigners();

    const weth = await (await ethers.getContractFactory("WETH9")).deploy();
    await weth.waitForDeployment();
    const WETH = await weth.getAddress();

    const art = JSON.parse(
      readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"),
    );
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    await pm.waitForDeployment();
    const POOL_MANAGER = await pm.getAddress();

    const b20f = await (await ethers.getContractFactory("MockB20Factory")).deploy();
    const stock = await (await ethers.getContractFactory("MockToken")).deploy("Mock NVIDIA", "NVDA");
    const slip = await (await ethers.getContractFactory("MockSlipstreamRouter")).deploy();
    await Promise.all([b20f.waitForDeployment(), stock.waitForDeployment(), slip.waitForDeployment()]);
    const STOCK = await stock.getAddress();
    const SLIP = await slip.getAddress();
    await (await stock.mint(SLIP, E("1000000"))).wait();
    await (await slip.setRate(2, 1)).wait(); // 1 WETH buys 2 stock

    // NFT + pot + airdrop + revenue splitter
    const nft = await (await ethers.getContractFactory("BasketNFT")).deploy(
      admin.address, WETH, treasury.address, MINT_PRICE, treasury.address,
    );
    await nft.waitForDeployment();
    const pot = await (await ethers.getContractFactory("BasketPot")).deploy(
      admin.address, await nft.getAddress(), WETH, SLIP, keeper.address,
    );
    await pot.waitForDeployment();
    await (await nft.setPot(await pot.getAddress())).wait();
    const airdrop = await (await ethers.getContractFactory("BasketAirdrop")).deploy(admin.address, WETH, keeper.address);
    await airdrop.waitForDeployment();
    const splitter = await (await ethers.getContractFactory("BasketRevenueSplitter")).deploy(admin.address, [
      { to: await pot.getAddress(), shareBps: 2500 },
      { to: await airdrop.getAddress(), shareBps: 750 },
      { to: treasury.address, shareBps: 6750 },
    ]);
    await splitter.waitForDeployment();
    const SPLITTER = await splitter.getAddress();

    // Hook at an address whose low bits carry its v4 permission flags.
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("BasketFeeHook");
    const hookInit = ethers.concat([
      Hook.bytecode,
      coder.encode(["address", "address", "address"], [POOL_MANAGER, admin.address, SPLITTER]),
    ]);
    const hookHash = ethers.keccak256(hookInit);
    let hookAddr = "", salt = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hookHash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
    }
    if (!hookAddr) throw new Error("no hook salt found");
    await (await c2.deploy(salt, hookInit)).wait();
    const hook = await ethers.getContractAt("BasketFeeHook", hookAddr);

    const vd = await (await ethers.getContractFactory("BasketVaultDeployer")).deploy();
    await vd.waitForDeployment();
    const factory = await (await ethers.getContractFactory("BasketFactory")).deploy(
      admin.address, POOL_MANAGER, hookAddr, await vd.getAddress(), await b20f.getAddress(), WETH, keeper.address, SLIP,
    );
    await factory.waitForDeployment();
    await (await hook.setFactory(await factory.getAddress())).wait();

    await (await factory.setPairConfig(WETH, {
      enabled: true, startMcap: START_MCAP, gradMcap: GRAD_MCAP, minOpeningBuy: MIN_OPENING_BUY,
    })).wait();
    await (await factory.setRewardTokenApproved(STOCK, true)).wait();
    await (await factory.setLaunchFee(LAUNCH_FEE)).wait();

    const router = await (await ethers.getContractFactory("StockTradeRouter")).deploy(
      POOL_MANAGER, await factory.getAddress(), WETH,
    );
    const testRouter = await (await ethers.getContractFactory("TestRouter")).deploy(POOL_MANAGER);
    await Promise.all([router.waitForDeployment(), testRouter.waitForDeployment()]);

    return {
      admin, creator, trader, keeper, treasury, feeWallet, stranger, other,
      weth, WETH, pm, stock, STOCK, slip, SLIP, nft, pot, airdrop, splitter, SPLITTER,
      hook, hookAddr, factory, router, testRouter,
    };
  }

  type Stack = Awaited<ReturnType<typeof deployStack>>;

  const holdersParams = (s: Stack, over: Record<string, unknown> = {}) => ({
    name: "Alpha", symbol: "ALPHA", metadataURI: "ipfs://alpha", pair: s.WETH,
    feeMode: 0, rewardToken: s.STOCK, feeRecipient: ethers.ZeroAddress, openingBuyIn: 0n, minTokensOut: 0n,
    ...over,
  });

  /** Launch a coin. `side` forces the coin to sort as currency0 or currency1
   *  of its pool, so both orientations of the fee engine get exercised. */
  async function launch(s: Stack, params: any, openingBuy = E("0.01"), side?: "coin0" | "coin1") {
    const n = await s.factory.totalTokens();
    const value = LAUNCH_FEE + openingBuy;
    let salt = ethers.hexlify(ethers.randomBytes(32));
    if (side) {
      for (;;) {
        const [predicted] = await s.factory.connect(s.creator).launch.staticCall(params, salt, { value });
        if ((BigInt(predicted) < BigInt(s.WETH)) === (side === "coin0")) break;
        salt = ethers.hexlify(ethers.randomBytes(32));
      }
    }
    await (await s.factory.connect(s.creator).launch(params, salt, { value })).wait();
    const coin = await s.factory.allTokens(n);
    const erc = await ethers.getContractAt("MockB20", coin);
    const coinIs0 = BigInt(coin) < BigInt(s.WETH);
    const key = {
      currency0: coinIs0 ? coin : s.WETH, currency1: coinIs0 ? s.WETH : coin,
      fee: 0, tickSpacing: 60, hooks: s.hookAddr,
    };
    const poolId = (await s.factory.listings(coin)).poolId;
    return { coin, erc, coinIs0, key, poolId };
  }

  const accrued = async (s: Stack, poolId: string) => {
    const a = await s.hook.accruedOf(poolId);
    return { beneficiary: a.beneficiary as bigint, protocol: a.protocol as bigint };
  };

  // -----------------------------------------------------------------------

  describe("admin (BuzzPad model)", () => {
    it("has one owner on every contract, two-step handover, and no renounce", async () => {
      const s = await deployStack();
      for (const c of [s.factory, s.hook, s.pot, s.nft, s.airdrop, s.splitter]) {
        expect(await c.owner()).to.equal(s.admin.address);
        await expect(c.renounceOwnership()).to.be.revertedWithCustomError(c, "OwnershipCannotBeRenounced");
      }

      await (await s.factory.transferOwnership(s.other.address)).wait();
      expect(await s.factory.owner(), "still the old owner until accepted").to.equal(s.admin.address);
      expect(await s.factory.pendingOwner()).to.equal(s.other.address);
      await expect(s.factory.connect(s.stranger).acceptOwnership()).to.be.reverted;
      await (await s.factory.connect(s.other).acceptOwnership()).wait();
      expect(await s.factory.owner()).to.equal(s.other.address);
      await expect(s.factory.setLaunchFee(0)).to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
    });

    it("gates every setting to the owner and enforces the hard caps", async () => {
      const s = await deployStack();
      const f = s.factory.connect(s.stranger);
      await expect(f.setLaunchEnabled(false)).to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
      await expect(f.setLaunchFee(1)).to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
      await expect(f.setKeeper(s.stranger.address)).to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
      await expect(f.setRewardTokenApproved(s.STOCK, false)).to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
      await expect(s.hook.connect(s.stranger).setProtocolFeeRecipient(s.stranger.address))
        .to.be.revertedWithCustomError(s.hook, "OwnableUnauthorizedAccount");
      await expect(s.pot.connect(s.stranger).setKeeper(s.stranger.address))
        .to.be.revertedWithCustomError(s.pot, "OwnableUnauthorizedAccount");

      const policy = { preTaxBps: 200, postTaxBps: 125, holdersPreBps: 50, holdersPostBps: 67, creatorPreBps: 100, creatorPostBps: 67 };
      await expect(s.factory.setFeePolicy({ ...policy, preTaxBps: 201 })).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.factory.setFeePolicy({ ...policy, postTaxBps: 201 })).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.factory.setFeePolicy({ ...policy, holdersPostBps: 126 })).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.factory.setLaunchFee(E("0.06"))).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.factory.setMaxOpeningBuyBps(501)).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.hook.setFactory(s.other.address)).to.be.revertedWithCustomError(s.hook, "AlreadySet");
      await expect(s.nft.setPot(s.other.address)).to.be.revertedWithCustomError(s.nft, "AlreadySet");

      await (await s.factory.setLaunchEnabled(false)).wait();
      await expect(launch(s, holdersParams(s))).to.be.revertedWithCustomError(s.factory, "LaunchDisabled");
    });

    it("applies a fee policy change to new launches only", async () => {
      const s = await deployStack();
      const a = await launch(s, holdersParams(s));
      await (await s.factory.setFeePolicy({
        preTaxBps: 100, postTaxBps: 50, holdersPreBps: 40, holdersPostBps: 20, creatorPreBps: 60, creatorPostBps: 30,
      })).wait();
      const b = await launch(s, holdersParams(s, { name: "Beta", symbol: "BETA" }));
      expect(await s.hook.feeNow(a.poolId)).to.deep.equal([200n, 50n]);
      expect(await s.hook.feeNow(b.poolId)).to.deep.equal([100n, 40n]);
    });
  });

  describe("launch", () => {
    it("mints an admin-less 1B coin, charges the launch fee, and makes the opening buy", async () => {
      const s = await deployStack();
      const { coin, erc, poolId } = await launch(s, holdersParams(s));

      expect(await erc.totalSupply()).to.equal(SUPPLY);
      expect(await erc.admin(), "no admin left on the coin").to.equal(ethers.ZeroAddress);
      expect(await erc.hasRole(await erc.MINT_ROLE(), await s.factory.getAddress()), "factory cannot mint").to.equal(false);

      const listing = await s.factory.listings(coin);
      expect(listing.creator).to.equal(s.creator.address);
      expect(listing.pair).to.equal(s.WETH);
      expect(listing.taxBps).to.equal(200);

      const info = await s.factory.launchInfo(coin);
      expect(info.feeMode).to.equal(0);
      expect(info.rewardToken).to.equal(s.STOCK);
      const vault = await ethers.getContractAt("BasketRewardVault", info.vault);
      expect(await vault.coin()).to.equal(coin);
      expect(await vault.rewardToken()).to.equal(s.STOCK);
      expect(await vault.keeper()).to.equal(s.keeper.address);
      expect((await s.hook.termsOf(poolId)).beneficiary).to.equal(info.vault);

      expect(await s.weth.balanceOf(s.SPLITTER), "launch fee reaches the splitter").to.equal(LAUNCH_FEE);
      const got = await erc.balanceOf(s.creator.address);
      expect(got, "opening buy filled").to.be.greaterThan(0n);
      expect(got, "under the 2% creator cap").to.be.lessThanOrEqual((SUPPLY * 200n) / 10_000n);
      // Seeding rounds liquidity down, so a few thousand wei (of 1e27) stay
      // behind in the factory itself.
      expect(await erc.balanceOf(await s.factory.getAddress()), "factory keeps only rounding dust").to.be.lessThan(1_000_000n);
    });

    it("lets only the owner collect liquidity, by share, to a recipient", async () => {
      const s = await deployStack();
      const { coin, erc } = await launch(s, holdersParams(s));
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("2") })).wait();

      await expect(s.factory.connect(s.stranger).collect(coin, 5000, s.stranger.address))
        .to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
      await expect(s.factory.connect(s.creator).collect(coin, 5000, s.creator.address))
        .to.be.revertedWithCustomError(s.factory, "OwnableUnauthorizedAccount");
      await expect(s.factory.collect(coin, 0, s.other.address)).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.factory.collect(coin, 10_001, s.other.address)).to.be.revertedWithCustomError(s.factory, "InvalidConfig");
      await expect(s.factory.collect(s.STOCK, 5000, s.other.address)).to.be.revertedWithCustomError(s.factory, "TokenNotFound");

      // Half: the recipient gets half the pool's coins and half the WETH
      // buyers paid in (net of the fees the hook holds as claims).
      const liq0 = (await s.factory.positions(coin)).liquidity;
      await expect(s.factory.collect(coin, 5000, s.other.address)).to.emit(s.factory, "Collected");
      const coins1 = await erc.balanceOf(s.other.address);
      const weth1 = await s.weth.balanceOf(s.other.address);
      expect(coins1).to.be.greaterThan(0n);
      expect(weth1, "about half of the 1.97 WETH in the pool").to.be.closeTo(E("0.985"), E("0.01"));
      expect((await s.factory.positions(coin)).liquidity).to.equal(liq0 - liq0 / 2n);

      // The pool still trades on what is left.
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("0.1") })).wait();

      // The rest: nothing remains to collect afterwards.
      await (await s.factory.collect(coin, 10_000, s.other.address)).wait();
      expect((await s.factory.positions(coin)).liquidity).to.equal(0n);
      expect(await s.weth.balanceOf(s.other.address)).to.be.greaterThan(weth1);
      await expect(s.factory.collect(coin, 10_000, s.other.address)).to.be.revertedWithCustomError(s.factory, "NothingToCollect");
    });

    it("rejects launches that break the rules", async () => {
      const s = await deployStack();
      const go = (params: any, value: bigint) =>
        s.factory.connect(s.creator).launch(params, ethers.hexlify(ethers.randomBytes(32)), { value });

      await expect(go(holdersParams(s), LAUNCH_FEE - 1n)).to.be.revertedWithCustomError(s.factory, "LaunchFeeNotPaid");
      await expect(go(holdersParams(s), LAUNCH_FEE)).to.be.revertedWithCustomError(s.factory, "OpeningBuyTooSmall");
      await expect(go(holdersParams(s), LAUNCH_FEE + MIN_OPENING_BUY - 1n))
        .to.be.revertedWithCustomError(s.factory, "OpeningBuyTooSmall");
      // 1 ETH into a 3.9 ETH start cap would take about 20% of supply.
      await expect(go(holdersParams(s), LAUNCH_FEE + E("1"))).to.be.revertedWithCustomError(s.factory, "OpeningBuyTooLarge");
      await expect(go(holdersParams(s, { minTokensOut: SUPPLY }), LAUNCH_FEE + E("0.01")))
        .to.be.revertedWithCustomError(s.factory, "OpeningBuySlippage");
      await expect(go(holdersParams(s, { pair: s.STOCK }), LAUNCH_FEE + E("0.01")))
        .to.be.revertedWithCustomError(s.factory, "PairNotEnabled");
      await expect(go(holdersParams(s, { rewardToken: s.SLIP }), LAUNCH_FEE + E("0.01")))
        .to.be.revertedWithCustomError(s.factory, "RewardTokenNotApproved");
      await expect(go(holdersParams(s, { name: "" }), LAUNCH_FEE + E("0.01")))
        .to.be.revertedWithCustomError(s.factory, "InvalidTokenParams");
    });

    it("binds the coin address to the launcher, so a copied salt cannot block a launch", async () => {
      const s = await deployStack();
      const salt = ethers.hexlify(ethers.randomBytes(32));
      const value = LAUNCH_FEE + E("0.01");
      // Same salt and the very same coin parameters, from two launchers.
      await (await s.factory.connect(s.stranger).launch(holdersParams(s), salt, { value })).wait();
      await (await s.factory.connect(s.creator).launch(holdersParams(s), salt, { value })).wait();
      expect(await s.factory.totalTokens()).to.equal(2n);
      expect(await s.factory.allTokens(0n)).to.not.equal(await s.factory.allTokens(1n));
    });

    it("only lets the factory open pools on the hook", async () => {
      const s = await deployStack();
      const rogue = await (await ethers.getContractFactory("MockToken")).deploy("Rogue", "RG");
      await rogue.waitForDeployment();
      const R = await rogue.getAddress();
      const r0 = BigInt(R) < BigInt(s.WETH);
      const key = { currency0: r0 ? R : s.WETH, currency1: r0 ? s.WETH : R, fee: 0, tickSpacing: 60, hooks: s.hookAddr };
      await expect(s.pm.connect(s.stranger).initialize(key, 1n << 96n)).to.be.reverted;
    });
  });

  describe("fees", () => {
    for (const side of ["coin0", "coin1"] as const) {
    it(`charges every swap shape in the pair token and never in the coin (${side})`, async () => {
      const s = await deployStack();
      const { coin, erc, coinIs0, key, poolId } = await launch(s, holdersParams(s), E("0.01"), side);
      expect(coinIs0).to.equal(side === "coin0");
      const vault = (await s.factory.launchInfo(coin)).vault;
      const R = await s.router.getAddress(), T = await s.testRouter.getAddress();

      // Opening buy of 0.01 ETH already accrued 2%: 0.5% holders, 1.5% protocol.
      let a = await accrued(s, poolId);
      expect(a.beneficiary).to.equal((E("0.01") * 50n) / 10_000n);
      expect(a.protocol).to.equal((E("0.01") * 150n) / 10_000n);

      // 1) exact-input buy: fee is 2% of the ETH paid in.
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      let b = await accrued(s, poolId);
      expect(b.beneficiary - a.beneficiary).to.equal(E("0.005"));
      expect(b.protocol - a.protocol).to.equal(E("0.015"));
      a = b;

      // 2) exact-input sell: fee is 2% of the WETH coming out.
      const half = (await erc.balanceOf(s.trader.address)) / 2n;
      await (await erc.connect(s.trader).approve(R, ethers.MaxUint256)).wait();
      const ethBefore = await ethers.provider.getBalance(s.trader.address);
      const rc = await (await s.router.connect(s.trader).sellForEth(coin, half, 0)).wait();
      const ethOut = (await ethers.provider.getBalance(s.trader.address)) - ethBefore + rc!.gasUsed * rc!.gasPrice;
      b = await accrued(s, poolId);
      const sellFee = b.beneficiary - a.beneficiary + (b.protocol - a.protocol);
      const gross = ethOut + sellFee;
      expect(sellFee).to.equal((gross * 200n) / 10_000n);
      expect(b.beneficiary - a.beneficiary).to.equal((gross * 50n) / 10_000n);
      a = b;

      // 3) exact-output buy: trader gets exactly the coins asked for and pays
      //    the pool's price plus 2% on top, in WETH.
      await (await s.weth.connect(s.trader).deposit({ value: E("5") })).wait();
      await (await s.weth.connect(s.trader).approve(T, ethers.MaxUint256)).wait();
      await (await erc.connect(s.trader).approve(T, ethers.MaxUint256)).wait();
      const want = E("1000000");
      const coins0 = await erc.balanceOf(s.trader.address);
      const weth0 = await s.weth.balanceOf(s.trader.address);
      await (await s.testRouter.connect(s.trader).swapExactOut(key, !coinIs0, want, s.trader.address)).wait();
      expect((await erc.balanceOf(s.trader.address)) - coins0, "exact coins out").to.equal(want);
      const paid = weth0 - (await s.weth.balanceOf(s.trader.address));
      b = await accrued(s, poolId);
      const buyFee = b.beneficiary - a.beneficiary + (b.protocol - a.protocol);
      expect(buyFee).to.equal(((paid - buyFee) * 200n) / 10_000n);
      a = b;

      // 4) exact-output sell: trader gets exactly the WETH asked for; the pool
      //    pays out that plus the 2% fee.
      const wantWeth = E("0.05");
      const weth1 = await s.weth.balanceOf(s.trader.address);
      await (await s.testRouter.connect(s.trader).swapExactOut(key, coinIs0, wantWeth, s.trader.address)).wait();
      expect((await s.weth.balanceOf(s.trader.address)) - weth1, "exact WETH out").to.equal(wantWeth);
      b = await accrued(s, poolId);
      expect(b.beneficiary - a.beneficiary).to.equal((wantWeth * 50n) / 10_000n);
      expect(b.protocol - a.protocol).to.equal((wantWeth * 150n) / 10_000n);

      // Sweep: anyone can call, funds go only to the vault and the splitter.
      const split0 = await s.weth.balanceOf(s.SPLITTER);
      await (await s.hook.connect(s.stranger).sweep(key)).wait();
      expect(await s.weth.balanceOf(vault)).to.equal(b.beneficiary);
      expect((await s.weth.balanceOf(s.SPLITTER)) - split0).to.equal(b.protocol);
      expect(await accrued(s, poolId)).to.deep.equal({ beneficiary: 0n, protocol: 0n });
      expect(await erc.balanceOf(vault), "no fee was ever taken in the coin").to.equal(0n);
      expect(await erc.balanceOf(s.SPLITTER)).to.equal(0n);
      expect(await erc.balanceOf(s.hookAddr)).to.equal(0n);
    });

    it(`graduates once at the cap and drops to the lower fee for good (${side})`, async () => {
      const s = await deployStack();
      const { coin, erc, poolId } = await launch(s, holdersParams(s), E("0.01"), side);
      expect(await s.factory.isGraduated(coin)).to.equal(false);
      expect(await s.hook.feeNow(poolId)).to.deep.equal([200n, 50n]);

      // Not yet: 1 ETH leaves the cap well under 29 ETH.
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      expect(await s.factory.isGraduated(coin)).to.equal(false);

      // About 6.7 ETH of net buying takes a 3.9 ETH start cap to 29 ETH.
      await expect(s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("7") })).to.emit(s.hook, "Graduated");
      expect(await s.factory.isGraduated(coin)).to.equal(true);
      expect(await s.hook.feeNow(poolId)).to.deep.equal([125n, 67n]);

      const a = await accrued(s, poolId);
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      const b = await accrued(s, poolId);
      expect(b.beneficiary - a.beneficiary, "holders 0.67%").to.equal(E("0.0067"));
      expect(b.protocol - a.protocol, "protocol 0.58%").to.equal(E("0.0058"));

      // Selling back under the cap does not undo graduation.
      await (await erc.connect(s.trader).approve(await s.router.getAddress(), ethers.MaxUint256)).wait();
      await (await s.router.connect(s.trader).sellForEth(coin, await erc.balanceOf(s.trader.address), 0)).wait();
      expect(await s.factory.isGraduated(coin)).to.equal(true);
      expect(await s.hook.feeNow(poolId)).to.deep.equal([125n, 67n]);
    });
    }

    it("pays the creator's fee wallet in creator mode", async () => {
      const s = await deployStack();
      const params = holdersParams(s, {
        name: "Gamma", symbol: "GAMMA", feeMode: 1, rewardToken: ethers.ZeroAddress, feeRecipient: s.feeWallet.address,
      });
      const { coin, key, poolId } = await launch(s, params);
      const info = await s.factory.launchInfo(coin);
      expect(info.feeMode).to.equal(1);
      expect(info.vault).to.equal(ethers.ZeroAddress);
      expect(info.feeRecipient).to.equal(s.feeWallet.address);

      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      const a = await accrued(s, poolId);
      expect(a.beneficiary, "creator 1% of both buys").to.equal((E("1.01") * 100n) / 10_000n);
      expect(a.protocol, "protocol 1%").to.equal((E("1.01") * 100n) / 10_000n);
      await (await s.hook.sweep(key)).wait();
      expect(await s.weth.balanceOf(s.feeWallet.address)).to.equal(a.beneficiary);

      // The creator can move their fee wallet; nobody else can.
      await expect(s.hook.connect(s.stranger).setBeneficiary(key, s.stranger.address))
        .to.be.revertedWithCustomError(s.hook, "NotBeneficiary");
      await (await s.hook.connect(s.feeWallet).setBeneficiary(key, s.other.address)).wait();
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      await (await s.hook.sweep(key)).wait();
      expect(await s.weth.balanceOf(s.other.address)).to.equal(E("0.01"));
    });

    it("splits protocol revenue 25% pot, 7.5% airdrops, 67.5% treasury", async () => {
      const s = await deployStack();
      const { coin, key } = await launch(s, holdersParams(s));
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("2") })).wait();
      await (await s.hook.sweep(key)).wait();

      const total = await s.weth.balanceOf(s.SPLITTER);
      expect(total).to.be.greaterThan(0n);
      const pot0 = await s.weth.balanceOf(await s.pot.getAddress());
      const tre0 = await s.weth.balanceOf(s.treasury.address);
      await (await s.splitter.connect(s.stranger).distribute(s.WETH)).wait();
      const toPot = (await s.weth.balanceOf(await s.pot.getAddress())) - pot0;
      const toAir = await s.weth.balanceOf(await s.airdrop.getAddress());
      const toTre = (await s.weth.balanceOf(s.treasury.address)) - tre0;
      expect(toPot).to.equal((total * 2500n) / 10_000n);
      expect(toAir).to.equal((total * 750n) / 10_000n);
      expect(toPot + toAir + toTre, "nothing left behind").to.equal(total);
      expect(await s.weth.balanceOf(s.SPLITTER)).to.equal(0n);

      await expect(s.splitter.setRecipients([{ to: s.treasury.address, shareBps: 9999 }]))
        .to.be.revertedWithCustomError(s.splitter, "InvalidRecipients");
    });
  });

  describe("holder rewards", () => {
    it("swaps the holders' share into the reward token and pays by cumulative proof", async () => {
      const s = await deployStack();
      const { coin, key } = await launch(s, holdersParams(s));
      const vault = await ethers.getContractAt("BasketRewardVault", (await s.factory.launchInfo(coin)).vault);
      const V = await vault.getAddress();

      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("2") })).wait();
      await (await s.hook.sweep(key)).wait();
      const wethIn = await s.weth.balanceOf(V);
      expect(wethIn).to.equal((E("2.01") * 50n) / 10_000n);

      // Only the keeper swaps, and only pair -> reward token into the vault.
      const path = slipPath(s.WETH, s.STOCK);
      await expect(vault.connect(s.stranger).swapToReward(path, wethIn, 0)).to.be.revertedWithCustomError(vault, "NotKeeper");
      await expect(vault.connect(s.keeper).swapToReward(slipPath(s.WETH, s.WETH), wethIn, 0))
        .to.be.revertedWithCustomError(vault, "BadPath");
      await expect(vault.connect(s.keeper).swapToReward(slipPath(s.STOCK, s.STOCK), wethIn, 0))
        .to.be.revertedWithCustomError(vault, "BadPath");
      await expect(vault.connect(s.keeper).swapToReward(path, wethIn, wethIn * 2n + 1n)).to.be.reverted;
      await (await vault.connect(s.keeper).swapToReward(path, wethIn, wethIn * 2n)).wait();
      expect(await s.stock.balanceOf(V)).to.equal(wethIn * 2n);
      expect(await s.weth.balanceOf(V)).to.equal(0n);
      const pool = await vault.distributable();
      expect(pool).to.equal(wethIn * 2n);

      // Round 1: creator 40%, trader 60%.
      const c1 = (pool * 40n) / 100n, t1 = pool - c1;
      const r1 = tree2([s.creator.address, c1], [s.trader.address, t1]);
      await expect(vault.connect(s.stranger).postRoot(r1.root, pool)).to.be.revertedWithCustomError(vault, "NotKeeper");
      await expect(vault.connect(s.keeper).postRoot(r1.root, pool + 1n)).to.be.revertedWithCustomError(vault, "Overallocated");
      await (await vault.connect(s.keeper).postRoot(r1.root, pool)).wait();
      expect(await vault.distributable()).to.equal(0n);

      await expect(vault.claim(s.trader.address, t1 + 1n, r1.proofB)).to.be.revertedWithCustomError(vault, "BadProof");
      await (await vault.connect(s.stranger).claim(s.trader.address, t1, r1.proofB)).wait();
      expect(await s.stock.balanceOf(s.trader.address)).to.equal(t1);
      await expect(vault.claim(s.trader.address, t1, r1.proofB)).to.be.revertedWithCustomError(vault, "NothingToClaim");

      // Round 2: more fees arrive; the creator never claimed round 1 and
      // collects both rounds in a single claim.
      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      await (await s.hook.sweep(key)).wait();
      const more = await s.weth.balanceOf(V);
      await (await vault.connect(s.keeper).swapToReward(path, more, 0)).wait();
      const pool2 = await vault.distributable();
      const c2 = c1 + pool2 / 2n, t2 = t1 + (pool2 - pool2 / 2n);
      const r2 = tree2([s.creator.address, c2], [s.trader.address, t2]);
      await expect(vault.connect(s.keeper).postRoot(r2.root, pool - 1n))
        .to.be.revertedWithCustomError(vault, "CommittedCannotDecrease");
      await (await vault.connect(s.keeper).postRoot(r2.root, c2 + t2)).wait();

      await (await vault.claim(s.creator.address, c2, r2.proofA)).wait();
      expect(await s.stock.balanceOf(s.creator.address), "both rounds in one claim").to.equal(c2);
      await (await vault.claim(s.trader.address, t2, r2.proofB)).wait();
      expect(await s.stock.balanceOf(s.trader.address), "only the difference").to.equal(t2);
      expect(await s.stock.balanceOf(V)).to.equal(0n);

      // Rotating the keeper on the factory reaches the existing vault.
      await (await s.factory.setKeeper(s.other.address)).wait();
      await expect(vault.connect(s.keeper).postRoot(r2.root, c2 + t2)).to.be.revertedWithCustomError(vault, "NotKeeper");
      await (await vault.connect(s.other).postRoot(r2.root, c2 + t2)).wait();
    });

    it("pays in the pair token directly when that is the reward", async () => {
      const s = await deployStack();
      const { coin, key } = await launch(s, holdersParams(s, { rewardToken: ethers.ZeroAddress }));
      const vault = await ethers.getContractAt("BasketRewardVault", (await s.factory.launchInfo(coin)).vault);
      expect(await vault.rewardToken()).to.equal(s.WETH);

      await (await s.router.connect(s.trader).buyWithEth(coin, 0, { value: E("1") })).wait();
      await (await s.hook.sweep(key)).wait();
      const pool = await vault.distributable();
      expect(pool).to.equal((E("1.01") * 50n) / 10_000n);
      await expect(vault.connect(s.keeper).swapToReward(slipPath(s.WETH, s.STOCK), pool, 0))
        .to.be.revertedWithCustomError(vault, "NothingToSwap");

      const r = tree2([s.creator.address, pool / 4n], [s.trader.address, pool - pool / 4n]);
      await (await vault.connect(s.keeper).postRoot(r.root, pool)).wait();
      const before = await s.weth.balanceOf(s.trader.address);
      await (await vault.claim(s.trader.address, pool - pool / 4n, r.proofB)).wait();
      expect((await s.weth.balanceOf(s.trader.address)) - before).to.equal(pool - pool / 4n);
    });

    it("pays trader airdrops from the airdrop pot by proof", async () => {
      const s = await deployStack();
      const A = await s.airdrop.getAddress();
      await (await s.weth.connect(s.admin).deposit({ value: E("1") })).wait();
      await (await s.weth.connect(s.admin).transfer(A, E("1"))).wait();
      const r = tree2([s.trader.address, E("0.7")], [s.other.address, E("0.3")]);
      await expect(s.airdrop.connect(s.stranger).postRoot(r.root, E("1"))).to.be.revertedWithCustomError(s.airdrop, "NotKeeper");
      await expect(s.airdrop.connect(s.keeper).postRoot(r.root, E("1.1"))).to.be.revertedWithCustomError(s.airdrop, "Overallocated");
      await (await s.airdrop.connect(s.keeper).postRoot(r.root, E("1"))).wait();
      await (await s.airdrop.claim(s.trader.address, E("0.7"), r.proofA)).wait();
      expect(await s.weth.balanceOf(s.trader.address)).to.equal(E("0.7"));
    });
  });

  describe("Basket NFT and pot", () => {
    it("mints with ETH: 90% to the pot, 10% to the treasury, 5% royalty", async () => {
      const s = await deployStack();
      const P = await s.pot.getAddress();
      await expect(s.nft.connect(s.trader).mint({ value: MINT_PRICE - 1n })).to.be.revertedWithCustomError(s.nft, "WrongPayment");
      const tre0 = await ethers.provider.getBalance(s.treasury.address);
      await (await s.nft.connect(s.trader).mint({ value: MINT_PRICE })).wait();
      expect(await s.nft.ownerOf(1)).to.equal(s.trader.address);
      expect(await s.nft.totalSupply()).to.equal(1n);
      expect(await s.weth.balanceOf(P)).to.equal((MINT_PRICE * 9000n) / 10_000n);
      expect((await ethers.provider.getBalance(s.treasury.address)) - tre0).to.equal(MINT_PRICE / 10n);
      expect(await s.nft.royaltyInfo(1, 10_000)).to.deep.equal([s.treasury.address, 500n]);

      // Burn-mint is off until the admin names a token, then burns to dEaD.
      await expect(s.nft.connect(s.other).mintWithBurn()).to.be.revertedWithCustomError(s.nft, "BurnMintDisabled");
      const basket = await (await ethers.getContractFactory("MockToken")).deploy("Basket", "BASKET");
      await basket.waitForDeployment();
      await (await s.nft.setBurnMint(await basket.getAddress(), E("100000"))).wait();
      await (await basket.mint(s.other.address, E("100000"))).wait();
      await (await basket.connect(s.other).approve(await s.nft.getAddress(), E("100000"))).wait();
      await (await s.nft.connect(s.other).mintWithBurn()).wait();
      expect(await s.nft.ownerOf(2)).to.equal(s.other.address);
      expect(await basket.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(E("100000"));
      expect(await basket.balanceOf(s.other.address)).to.equal(0n);
    });

    it("spends 5% an hour on the day's token and credits every Basket equally", async () => {
      const s = await deployStack();
      const P = await s.pot.getAddress();
      await expect(s.pot.connect(s.keeper).distribute("0x", 0)).to.be.revertedWithCustomError(s.pot, "NothingToDistribute");

      await (await s.nft.connect(s.trader).mint({ value: MINT_PRICE })).wait(); // Basket #1
      const free0 = await s.pot.freeBalance(s.WETH);
      expect(free0).to.equal(E("0.027"));

      // Default rotation is WETH itself: no swap, straight credit.
      await expect(s.pot.connect(s.stranger).distribute("0x", 0)).to.be.revertedWithCustomError(s.pot, "NotKeeper");
      await (await s.pot.connect(s.keeper).distribute("0x", 0)).wait();
      const spend1 = (free0 * 500n) / 10_000n;
      expect(await s.pot.pending(1, s.WETH)).to.equal(spend1);
      expect(await s.pot.freeBalance(s.WETH)).to.equal(free0 - spend1);
      await expect(s.pot.connect(s.keeper).distribute("0x", 0)).to.be.revertedWithCustomError(s.pot, "TooSoon");

      // Admin rotates to the stock; the next hour buys it through the router.
      await expect(s.pot.setRotation([s.STOCK])).to.be.revertedWithCustomError(s.pot, "InvalidRewardToken");
      await (await s.pot.addRewardToken(s.STOCK)).wait();
      await (await s.pot.setRotation([s.STOCK])).wait();
      expect(await s.pot.todaysToken()).to.equal(s.STOCK);

      // Basket #2 joins: it must not inherit Basket #1's earlier credit.
      await (await s.nft.connect(s.other).mint({ value: MINT_PRICE })).wait();
      expect(await s.pot.pending(2, s.WETH)).to.equal(0n);

      await time.increase(3600);
      const free1 = await s.pot.freeBalance(s.WETH);
      const spend2 = (free1 * 500n) / 10_000n;
      await expect(s.pot.connect(s.keeper).distribute(slipPath(s.WETH, s.WETH), 0)).to.be.revertedWithCustomError(s.pot, "BadPath");
      await (await s.pot.connect(s.keeper).distribute(slipPath(s.WETH, s.STOCK), spend2 * 2n)).wait();
      const perBasket = (spend2 * 2n) / 2n;
      expect(await s.pot.pending(1, s.STOCK)).to.equal(perBasket);
      expect(await s.pot.pending(2, s.STOCK)).to.equal(perBasket);
      expect(await s.pot.freeBalance(s.WETH)).to.equal(free1 - spend2);
      expect(await s.pot.freeBalance(s.STOCK), "credited stock is not free").to.equal(0n);

      // Only the holder withdraws, and the credit follows the NFT.
      await expect(s.pot.connect(s.stranger).withdraw(1, [s.WETH])).to.be.revertedWithCustomError(s.pot, "NotBasketHolder");
      const w0 = await s.weth.balanceOf(s.trader.address);
      await (await s.pot.connect(s.trader).withdraw(1, [s.WETH])).wait();
      expect((await s.weth.balanceOf(s.trader.address)) - w0).to.equal(spend1);
      expect(await s.pot.pending(1, s.WETH)).to.equal(0n);

      await (await s.nft.connect(s.trader).transferFrom(s.trader.address, s.stranger.address, 1)).wait();
      await expect(s.pot.connect(s.trader).withdraw(1, [s.STOCK])).to.be.revertedWithCustomError(s.pot, "NotBasketHolder");
      await (await s.pot.connect(s.stranger).withdraw(1, [s.STOCK, s.WETH])).wait();
      expect(await s.stock.balanceOf(s.stranger.address)).to.equal(perBasket);
      await (await s.pot.connect(s.other).withdraw(2, [s.STOCK])).wait();
      expect(await s.stock.balanceOf(s.other.address)).to.equal(perBasket);
      expect(await s.stock.balanceOf(P)).to.equal(0n);
      expect(await s.pot.owed(s.STOCK)).to.equal(0n);
    });

    it("credits reward tokens the pot already holds without a swap", async () => {
      const s = await deployStack();
      const P = await s.pot.getAddress();
      await (await s.nft.connect(s.trader).mint({ value: MINT_PRICE })).wait();
      await (await s.pot.addRewardToken(s.STOCK)).wait();
      await (await s.stock.mint(P, E("100"))).wait();
      await expect(s.pot.connect(s.keeper).distributeHeld(s.WETH)).to.be.revertedWithCustomError(s.pot, "InvalidRewardToken");
      await (await s.pot.connect(s.keeper).distributeHeld(s.STOCK)).wait();
      expect(await s.pot.pending(1, s.STOCK)).to.equal(E("5"));
      await expect(s.pot.connect(s.keeper).distributeHeld(s.STOCK)).to.be.revertedWithCustomError(s.pot, "TooSoon");
    });
  });
});
