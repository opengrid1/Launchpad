import { expect } from "chai";
import { ethers, network } from "hardhat";

// Live Uniswap V4 stack + tokens on Robinhood Chain.
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const TSLA = "0x322F0929c4625eD5bAd873c95208D54E1c003b2d";
const SPCX = "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

const HOOK_FLAGS = (1n << 6n) | (1n << 2n); // afterSwap | afterSwapReturnDelta
const FLAG_MASK = (1n << 14n) - 1n;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];

const wethUsdgKey = { currency0: WETH, currency1: USDG, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress };
const usdgNvdaKey = { currency0: USDG, currency1: NVDA, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
const tslaUsdgKey = { currency0: TSLA, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
// MU/USDG fee-3000 is initialized but has zero in-range liquidity on chain;
// (SPCX's fee-3000 pool was seeded by the protocol, so it no longer works here.)
const MU = "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD";
const muUsdgDeadKey = { currency0: USDG, currency1: MU, fee: 3000, tickSpacing: 60, hooks: ethers.ZeroAddress };
// Never-initialized pool: sqrtPrice is zero.
const nvdaUninitKey = { currency0: USDG, currency1: NVDA, fee: 1234, tickSpacing: 60, hooks: ethers.ZeroAddress };

/** Fund an address with NVDA by impersonating the PoolManager (fork only). */
async function fundStock(stock: string, to: string, amount: bigint) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [POOL_MANAGER] });
  await network.provider.send("hardhat_setBalance", [POOL_MANAGER, "0x1000000000000000000"]);
  const pm = await ethers.getSigner(POOL_MANAGER);
  const t = new ethers.Contract(stock, ERC20_ABI, pm);
  await (await t.transfer(to, amount)).wait();
}

async function deploy(adminAddr: string, treasury: string, protocolAdmin?: string) {
  const Deployer = await ethers.getContractFactory("HookDeployer");
  const deployer = await Deployer.deploy();
  await deployer.waitForDeployment();
  const deployerAddr = await deployer.getAddress();

  const Hook = await ethers.getContractFactory("QuiverHookS");
  const ctorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address"],
    [POOL_MANAGER, adminAddr, treasury, USDG],
  );
  const initCode = ethers.concat([Hook.bytecode, ctorArgs]);
  const initCodeHash = ethers.keccak256(initCode);

  let hookAddr = "";
  let salt = "";
  for (let i = 0n; i < 500_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployerAddr, s, initCodeHash);
    if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) {
      hookAddr = addr;
      salt = s;
      break;
    }
  }
  if (!hookAddr) throw new Error("no hook salt found");
  await (await deployer.deploy(salt, initCode)).wait();
  const hook = await ethers.getContractAt("QuiverHookS", hookAddr);

  const Factory = await ethers.getContractFactory("QuiverFactoryS");
  const factory = await Factory.deploy(adminAddr, protocolAdmin ?? adminAddr, POOL_MANAGER, hookAddr, USDG);
  await factory.waitForDeployment();
  await (await hook.setFactory(await factory.getAddress())).wait();

  const Router = await ethers.getContractFactory("QuiverRouterS");
  const router = await Router.deploy(POOL_MANAGER, WETH, USDG, hookAddr, await factory.getAddress(), wethUsdgKey);
  await router.waitForDeployment();

  return { hook, factory, router, hookAddr };
}

async function launchToken(
  factory: any,
  signer: any,
  params: { name: string; symbol: string; metadataURI: string; pairStock: string; taxBps: number; rewardStocks: string[] },
) {
  const Token = await ethers.getContractFactory("QuiverTokenM");
  const factoryAddr = await factory.getAddress();
  const args = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "string", "string", "uint256", "address", "address", "uint16", "address[]"],
    [params.name, params.symbol, params.metadataURI, 10n ** 27n, signer.address, factoryAddr, params.taxBps, params.rewardStocks],
  );
  const initCodeHash = ethers.keccak256(ethers.concat([Token.bytecode, args]));
  let salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(factoryAddr, s, initCodeHash);
    if ((BigInt(a) & 0xffffn) === 0x4663n) {
      salt = s;
      break;
    }
  }
  if (!salt) throw new Error("no token vanity salt");
  return factory.connect(signer).launch(params, salt);
}

describe("Quiver V4S stock-paired launchpad (fork)", function () {
  this.timeout(600_000);

  if (process.env.FORK !== "1") {
    it.skip("requires FORK=1 to run against the Robinhood Chain fork", () => {});
    return;
  }

  it("verifies price pools at listing and rejects dead ones", async () => {
    const [admin] = await ethers.getSigners();
    const { factory } = await deploy(admin.address, admin.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();
    expect(await factory.stockListed(NVDA)).to.equal(true);
    // A pool with zero in-range liquidity must be rejected outright.
    await expect(factory.listStock(MU, muUsdgDeadKey)).to.be.revertedWithCustomError(factory, "DeadPricePool");
    // An uninitialized pool (no price) must be rejected too.
    await expect(factory.listStock(NVDA, nvdaUninitKey)).to.be.revertedWithCustomError(factory, "DeadPricePool");
    // Live oracle sanity: NVDA trades in the low hundreds of dollars.
    const usd8 = await factory.stockUsd8(NVDA);
    expect(usd8).to.be.greaterThan(10n * 10n ** 8n);
    expect(usd8).to.be.lessThan(10_000n * 10n ** 8n);
  });

  it("launches a stock-paired market at the USD start cap and taxes buys", async () => {
    const [admin, trader] = await ethers.getSigners();
    const { hook, factory, router } = await deploy(admin.address, admin.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();

    await (await launchToken(factory, admin, {
      name: "Pair Test", symbol: "PAIR", metadataURI: "", pairStock: NVDA, taxBps: 500, rewardStocks: [NVDA],
    })).wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverTokenM", token);
    expect(await erc20.totalSupply()).to.equal(10n ** 27n);
    expect(await erc20.balanceOf(POOL_MANAGER)).to.be.greaterThan((10n ** 27n * 99n) / 100n);

    // Buy with NVDA directly.
    await fundStock(NVDA, trader.address, ethers.parseEther("1"));
    const nvda = new ethers.Contract(NVDA, ERC20_ABI, trader);
    await (await nvda.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithStock(token, ethers.parseEther("0.01"), 0)).wait();

    expect(await erc20.balanceOf(trader.address)).to.be.greaterThan(0n);
    expect(await hook.tokenFees(token), "buy taxed in token").to.be.greaterThan(0n);
  });

  it("harvests: direct pair-stock rewards, creator + protocol in stock", async () => {
    const [admin, trader, treasury] = await ethers.getSigners();
    const { hook, factory, router } = await deploy(admin.address, treasury.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();
    await (await launchToken(factory, admin, {
      name: "Harvest", symbol: "HARV", metadataURI: "", pairStock: NVDA, taxBps: 500, rewardStocks: [NVDA],
    })).wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverTokenM", token);

    await fundStock(NVDA, trader.address, ethers.parseEther("1"));
    const nvda = new ethers.Contract(NVDA, ERC20_ABI, trader);
    await (await nvda.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithStock(token, ethers.parseEther("0.02"), 0)).wait();
    // Sell a slice to accrue stock-side fees too.
    const held = await erc20.balanceOf(trader.address);
    await (await erc20.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sellForStock(token, held / 5n, 0)).wait();
    expect(await hook.stockFees(token), "sell taxed in stock").to.be.greaterThan(0n);

    const treasuryBefore = await nvda.balanceOf(treasury.address);
    await (await hook.harvest(token)).wait();

    expect(await hook.creatorClaimable(token), "creator accrued NVDA").to.be.greaterThan(0n);
    expect(await nvda.balanceOf(treasury.address), "protocol got NVDA").to.be.greaterThan(treasuryBefore);
    expect(await erc20.totalRewardsDistributedAt(0), "holders got NVDA direct").to.be.greaterThan(0n);

    // Keeper-style push delivers to the wallet with no holder action.
    const before = await nvda.balanceOf(trader.address);
    await (await erc20.connect(admin).claimForMany([trader.address])).wait();
    expect(await nvda.balanceOf(trader.address)).to.be.greaterThan(before);
    expect(await erc20.pendingRewards(trader.address)).to.equal(0n);

    // Creator claims their NVDA.
    const cBefore = await nvda.balanceOf(admin.address);
    await (await hook.connect(admin).claimCreatorFees(token)).wait();
    expect(await nvda.balanceOf(admin.address)).to.be.greaterThan(cBefore);
  });

  it("pays a multi-stock basket: pair stock direct + routed second stock", async () => {
    const [admin, trader] = await ethers.getSigners();
    const { hook, factory, router } = await deploy(admin.address, admin.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();
    await (await factory.listStock(TSLA, tslaUsdgKey)).wait();
    await (await launchToken(factory, admin, {
      name: "Basket", symbol: "BSKT", metadataURI: "", pairStock: NVDA, taxBps: 500, rewardStocks: [NVDA, TSLA],
    })).wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverTokenM", token);
    expect(await erc20.rewardCount()).to.equal(2n);

    await fundStock(NVDA, trader.address, ethers.parseEther("1"));
    const nvda = new ethers.Contract(NVDA, ERC20_ABI, trader);
    await (await nvda.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithStock(token, ethers.parseEther("0.05"), 0)).wait();

    await (await hook.harvest(token)).wait();
    expect(await erc20.totalRewardsDistributedAt(0), "NVDA share distributed").to.be.greaterThan(0n);
    expect(await erc20.totalRewardsDistributedAt(1), "TSLA share routed + distributed").to.be.greaterThan(0n);

    const tsla = new ethers.Contract(TSLA, ERC20_ABI, trader);
    const nb = await nvda.balanceOf(trader.address);
    const tb = await tsla.balanceOf(trader.address);
    await (await erc20.connect(trader).claim()).wait();
    expect(await nvda.balanceOf(trader.address), "wallet got NVDA").to.be.greaterThan(nb);
    expect(await tsla.balanceOf(trader.address), "wallet got TSLA").to.be.greaterThan(tb);
  });

  it("trades through the ETH convenience path (buy and sell)", async () => {
    const [admin, trader] = await ethers.getSigners();
    const { factory, router } = await deploy(admin.address, admin.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();
    await (await launchToken(factory, admin, {
      name: "EthPath", symbol: "ETHP", metadataURI: "", pairStock: NVDA, taxBps: 500, rewardStocks: [NVDA],
    })).wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverTokenM", token);

    await (await router.connect(trader).buyWithEth(token, 0, { value: ethers.parseEther("0.003") })).wait();
    const bought = await erc20.balanceOf(trader.address);
    expect(bought, "ETH routed to stock-paired token").to.be.greaterThan(0n);

    await (await erc20.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    const ethBefore = await ethers.provider.getBalance(trader.address);
    await (await router.connect(trader).sellForEth(token, bought / 2n, 0)).wait();
    expect(await erc20.balanceOf(trader.address)).to.equal(bought - bought / 2n);
    expect(await ethers.provider.getBalance(trader.address)).to.be.greaterThan(ethBefore - ethers.parseEther("0.001"));
  });

  it("stops paying sellers instantly (settle-on-transfer)", async () => {
    const [admin, trader] = await ethers.getSigners();
    const { hook, factory, router } = await deploy(admin.address, admin.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();
    await (await launchToken(factory, admin, {
      name: "Seller", symbol: "SELL", metadataURI: "", pairStock: NVDA, taxBps: 500, rewardStocks: [NVDA],
    })).wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverTokenM", token);

    await fundStock(NVDA, trader.address, ethers.parseEther("1"));
    const nvda = new ethers.Contract(NVDA, ERC20_ABI, trader);
    await (await nvda.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithStock(token, ethers.parseEther("0.02"), 0)).wait();

    // Admin buys too so a second eligible holder exists after the sell.
    await fundStock(NVDA, admin.address, ethers.parseEther("1"));
    const nvdaA = new ethers.Contract(NVDA, ERC20_ABI, admin);
    await (await nvdaA.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(admin).buyWithStock(token, ethers.parseEther("0.01"), 0)).wait();

    // Trader sells EVERYTHING, then residuals are delivered and zeroed.
    const held = await erc20.balanceOf(trader.address);
    await (await erc20.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sellForStock(token, held, 0)).wait();
    await (await erc20.claimForMany([trader.address])).wait();
    const nvdaAfterResidual = await nvda.balanceOf(trader.address);

    // A NEW distribution happens; the seller must get none of it.
    await (await hook.harvest(token)).wait();
    expect(await erc20.pendingRewards(trader.address), "seller pending stays zero").to.equal(0n);
    expect(await nvda.balanceOf(trader.address), "seller wallet unchanged").to.equal(nvdaAfterResidual);
  });

  it("renounces cleanly; protocolAdmin unwind still works, in stock", async () => {
    const [deployer, trader, padmin] = await ethers.getSigners();
    const { factory, router } = await deploy(deployer.address, deployer.address, padmin.address);
    await (await factory.listStock(NVDA, usdgNvdaKey)).wait();

    await (await factory.renounceOwnership()).wait();
    expect(await factory.owner()).to.equal(ethers.ZeroAddress);
    await expect(factory.setLaunchesPaused(true)).to.be.reverted;
    await expect(factory.listStock(TSLA, tslaUsdgKey)).to.be.reverted;

    await (await launchToken(factory, deployer, {
      name: "Renounced", symbol: "RNC", metadataURI: "", pairStock: NVDA, taxBps: 500, rewardStocks: [NVDA],
    })).wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverTokenM", token);

    await fundStock(NVDA, trader.address, ethers.parseEther("1"));
    const nvda = new ethers.Contract(NVDA, ERC20_ABI, trader);
    await (await nvda.approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).buyWithStock(token, ethers.parseEther("0.02"), 0)).wait();

    await expect(factory.connect(deployer).unwindPosition(token, 10_000, deployer.address))
      .to.be.revertedWithCustomError(factory, "NotProtocolAdmin");
    await (await factory.connect(padmin).unwindPosition(token, 10_000, padmin.address)).wait();
    expect(await erc20.balanceOf(padmin.address)).to.be.greaterThan(0n);
    expect(await nvda.balanceOf(padmin.address), "admin got the stock side").to.be.greaterThan(0n);
    expect((await factory.positions(token)).liquidity).to.equal(0n);
  });
});
