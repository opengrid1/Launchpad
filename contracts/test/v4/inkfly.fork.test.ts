import { expect } from "chai";
import { ethers } from "hardhat";

// Ink chain (Kraken OP-Stack L2, chainId 57073) Uniswap V4 infra.
const POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
const WETH = "0x4200000000000000000000000000000000000006";
// StockFeeHookV3 uses beforeSwap (bit 7 -> index 7? see flags below). We reuse
// the exact same hook the Base launchpad uses; its permission flags are:
//   afterInitialize(13) | beforeSwap(6) | afterSwap? — matched to the V3 test.
const HOOK_FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

// Ink launchpad model: plain ERC20 coins, WETH-paired, flat 1% trade fee routed
// entirely to the creator. No vault, no keeper, no holder rewards. This fork
// test proves the whole lifecycle: launch (with fee recipient + atomic dev buy),
// trade both ways, 1% fee routing to the creator, poolSpot, and admin collect.
describe("InkFlyFactory: flat 1% creator fee, WETH-paired, no rewards (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }

  // 1 ETH starting market cap (in WETH wei), like a memecoin fair launch.
  const START_MCAP_WEI = ethers.parseEther("1");

  async function deploySystem(admin: any) {
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();

    // The factory is deployed one nonce after the hook (the hook's constructor
    // records the factory address). Predict it so the hook can be immutable.
    const nonce = await ethers.provider.getTransactionCount(admin.address);
    const predictedFactory = ethers.getCreateAddress({ from: admin.address, nonce: nonce + 1 });

    const Hook = await ethers.getContractFactory("StockFeeHookV3");
    const hookInit = ethers.concat([
      Hook.bytecode,
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "address", "address"],
        [POOL_MANAGER, admin.address, predictedFactory, admin.address],
      ),
    ]);
    const hookHash = ethers.keccak256(hookInit);
    let hookAddr = "", salt = "";
    for (let i = 0n; i < 800_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hookHash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
    }
    expect(hookAddr, "mined a hook address").to.not.equal("");
    await (await c2.deploy(salt, hookInit)).wait();

    const factory = await (await ethers.getContractFactory("InkFlyFactory")).deploy(
      admin.address, admin.address, POOL_MANAGER, hookAddr, WETH, START_MCAP_WEI,
    );
    await factory.waitForDeployment();
    expect((await factory.getAddress()).toLowerCase()).to.equal(predictedFactory.toLowerCase());

    const router = await (await ethers.getContractFactory("StockTradeRouter")).deploy(
      POOL_MANAGER, await factory.getAddress(), WETH,
    );
    await router.waitForDeployment();
    const hook = await ethers.getContractAt("StockFeeHookV3", hookAddr);
    return { factory, router, hook, hookAddr };
  }

  it("routes the flat 1% fee entirely to a distinct feeRecipient", async () => {
    const [admin, creator, holder, feeWallet] = await ethers.getSigners();
    const { factory, router, hook, hookAddr } = await deploySystem(admin);

    const p = {
      name: "Inky", symbol: "INKY", metadataURI: "ipfs://a",
      pair: WETH, feeRecipient: feeWallet.address,
    };
    await (await factory.connect(creator).launch(p)).wait();
    const coin = await factory.allTokens(0n);
    const erc = await ethers.getContractAt("InkToken", coin);

    // Fixed tax recorded as 1%.
    const listing = await factory.listings(coin);
    expect(listing.taxBps, "flat 1% tax").to.equal(100);
    expect(await factory.feeRecipientOf(coin), "fee recipient stored").to.equal(feeWallet.address);

    // Exactly one payee: the creator's fee recipient at 100%.
    const coinIsC0 = coin.toLowerCase() < WETH.toLowerCase();
    const key = { currency0: coinIsC0 ? coin : WETH, currency1: coinIsC0 ? WETH : coin, fee: 0, tickSpacing: 60, hooks: hookAddr };
    const payees = await hook.payees(key as any);
    expect(payees.length, "single payee").to.equal(1);
    expect(payees[0].to.toLowerCase(), "payee is fee recipient").to.equal(feeWallet.address.toLowerCase());
    expect(payees[0].shareBps, "creator gets 100%").to.equal(10_000);

    // Trade both ways; the fee recipient accrues value, nobody else.
    const weth = await ethers.getContractAt("InkToken", WETH);
    const feeBefore = (await erc.balanceOf(feeWallet.address)) + (await weth.balanceOf(feeWallet.address));
    await (await router.connect(holder).buyWithEth(coin, 0, { value: ethers.parseEther("0.06") })).wait();
    await (await erc.connect(holder).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(holder).sellForEth(coin, await erc.balanceOf(holder.address), 0)).wait();

    const feeAccrued = (await erc.balanceOf(feeWallet.address)) + (await weth.balanceOf(feeWallet.address)) - feeBefore;
    expect(feeAccrued, "creator fee pushed to feeRecipient").to.be.greaterThan(0n);
  });

  it("defaults feeRecipient to the launcher, does an atomic dev buy, exposes poolSpot", async () => {
    const [admin, creator] = await ethers.getSigners();
    const { factory } = await deploySystem(admin);

    const p = { name: "Beta", symbol: "BETA", metadataURI: "", pair: WETH, feeRecipient: ethers.ZeroAddress };
    const tx = await factory.connect(creator).launch(p, { value: ethers.parseEther("0.05") });
    await tx.wait();
    const coin = await factory.allTokens(0n);
    const erc = await ethers.getContractAt("InkToken", coin);

    // Blank feeRecipient falls back to the launcher.
    expect(await factory.feeRecipientOf(coin)).to.equal(creator.address);
    // Dev buy delivered coins to the creator.
    expect(await erc.balanceOf(creator.address), "dev buy filled").to.be.greaterThan(0n);

    const [sqrtPriceX96, tokenIsCurrency0, pairDecimals] = await factory.poolSpot(coin);
    expect(sqrtPriceX96, "live sqrt price").to.be.greaterThan(0n);
    expect(tokenIsCurrency0).to.equal(coin.toLowerCase() < WETH.toLowerCase());
    expect(pairDecimals, "WETH is 18 decimals").to.equal(18);
  });

  it("rejects a non-WETH pair", async () => {
    const [admin, creator, other] = await ethers.getSigners();
    const { factory } = await deploySystem(admin);
    const p = { name: "Bad", symbol: "BAD", metadataURI: "", pair: other.address, feeRecipient: ethers.ZeroAddress };
    await expect(factory.connect(creator).launch(p)).to.be.reverted;
  });

  it("lets only protocolAdmin collect factory-held liquidity", async () => {
    const [admin, creator, recipient, stranger] = await ethers.getSigners();
    const { factory } = await deploySystem(admin);

    const p = { name: "Gamma", symbol: "GAMMA", metadataURI: "", pair: WETH, feeRecipient: ethers.ZeroAddress };
    await (await factory.connect(creator).launch(p)).wait();
    const coin = await factory.allTokens(0n);
    const erc = await ethers.getContractAt("InkToken", coin);

    await expect(factory.connect(stranger).collect(coin, 5000, recipient.address)).to.be.reverted;

    const before = await erc.balanceOf(recipient.address);
    await (await factory.connect(admin).collect(coin, 5000, recipient.address)).wait();
    expect(await erc.balanceOf(recipient.address), "collect returned coin liquidity").to.be.greaterThan(before);
  });
});
