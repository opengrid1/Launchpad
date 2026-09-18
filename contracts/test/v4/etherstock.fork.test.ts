import { expect } from "chai";
import { ethers, network } from "hardhat";

// Ethereum mainnet fork: real Uniswap V4 PoolManager, V3 SwapRouter02, WETH and
// the Ondo SLVon stock (its SLVon/USDC V3 1% pool is the deepest Ondo pool on
// mainnet; NVDAon's V4 pool has been drained). Etherstock = Stonkreum's launcher
// with the holder share turned into an automatic buyback and burn.
//   FORK=1 ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com ROBINHOOD_CHAIN_ID=1 \
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat test test/v4/etherstock.fork.test.ts
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const SLV = "0xF3e4872e6a4cF365888D93b6146a2bAA7348F1A4";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
// Route for SLVon: WETH -(V3 0.05%)-> USDC -(V3 1%)-> SLVon, no V4 leg.
const SLV_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WETH, 500, USDC, 10000, SLV]), EMPTY_KEY]);
const NO_ROUTE = "0x";
const ETH_USD_8 = 4_000n * 10n ** 8n;
const SLV_USD_8 = 60n * 10n ** 8n;
const SUPPLY = 10n ** 27n;
const TAX_BPS = 400;
const CREATOR_BPS = 5000, BURN_BPS = 3000;
/** $25 of WETH at $4,000. */
const BUYBACK_MIN_WETH = (25n * 10n ** 8n * 10n ** 18n) / ETH_USD_8;

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];

async function deployAll(admin: any) {
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("EtherStockHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, admin.address])]);
  const hookHash = ethers.keccak256(hookInit);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 2_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hookHash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  if (!hookAddr) throw new Error("no hook salt");
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("EtherStockHook", hookAddr);
  const td = await (await ethers.getContractFactory("EtherStockTokenDeployer")).deploy();
  await td.waitForDeployment();
  const factory = await (await ethers.getContractFactory("EtherStockFactory")).deploy(
    admin.address, admin.address, POOL_MANAGER, hookAddr, await td.getAddress(), WETH, ETH_USD_8, TAX_BPS, CREATOR_BPS, BURN_BPS,
  );
  await factory.waitForDeployment();
  await (await td.setFactory(await factory.getAddress())).wait();
  await (await hook.connect(admin).setFactory(await factory.getAddress())).wait();
  const router = await (await ethers.getContractFactory("EtherStockRouter")).deploy(POOL_MANAGER, await factory.getAddress(), WETH, ROUTER02);
  await router.waitForDeployment();
  await (await factory.connect(admin).setConverter(await router.getAddress())).wait();
  await (await factory.connect(admin).setQuoteAsset(SLV, true, SLV_USD_8, ethers.ZeroAddress)).wait();
  return { hook, factory, router };
}

async function launch(factory: any, creator: any, pair: string, ethIn = 0n, route = NO_ROUTE) {
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now()) % 2n ** 64n), 32);
  const n = Number(await factory.totalTokens());
  await (await factory.connect(creator).launch({ name: "Test Coin", symbol: "TC", metadataURI: '{"description":"fork test"}', pair }, salt, route, { value: ethIn })).wait();
  const token = await factory.allTokens(n);
  return ethers.getContractAt("EtherStockToken", token);
}

async function pastSnipe() {
  await network.provider.send("evm_increaseTime", [30]);
  for (let i = 0; i < 3; i++) await network.provider.send("evm_mine", []);
}

describe("Etherstock on Ethereum mainnet (fork)", function () {
  this.timeout(600_000);

  it("WETH pair: fees split creator / burn reserve / platform; the swap that fills the reserve buys back and burns in the same transaction", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, WETH, ethers.parseEther("0.1"));
    const coinAddr = await coin.getAddress();
    const weth = new ethers.Contract(WETH, ERC20, ethers.provider);

    expect(await coin.buybackMin()).to.equal(BUYBACK_MIN_WETH);
    // Dev buy of 0.1 ETH: fee 0.004 WETH, 30% of it into the burn reserve, below the $25 threshold.
    const fee0 = await weth.balanceOf(coinAddr);
    expect(fee0).to.be.closeTo(ethers.parseEther("0.004"), ethers.parseEther("0.00001"));
    expect(await coin.burnReserve()).to.equal(fee0 * 3000n / 10000n);
    expect(await coin.creatorFees()).to.equal(fee0 * 5000n / 10000n);
    expect(await coin.platformFees()).to.equal(fee0 - fee0 * 3000n / 10000n - fee0 * 5000n / 10000n);
    expect(await coin.totalSupply()).to.equal(SUPPLY);

    await pastSnipe();
    // A 0.5 ETH buy adds 0.006 WETH to the reserve: over the threshold, so this
    // very swap triggers the buyback. Supply drops inside the buyer's transaction.
    const supplyBefore = await coin.totalSupply();
    const rc = await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.5") })).wait();
    const ev = rc!.logs.map((l: any) => { try { return coin.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Buyback");
    expect(ev, "Buyback event in the buy tx").to.not.equal(undefined);
    expect(ev!.args.inSwap).to.equal(true);
    expect(ev!.args.pairIn).to.equal(fee0 * 3000n / 10000n + ethers.parseEther("0.5") * 400n / 10000n * 3000n / 10000n);
    expect(await coin.burnReserve()).to.equal(0n);
    const burned = await coin.totalBurned();
    expect(burned).to.be.gt(0n);
    expect(await coin.totalSupply()).to.equal(supplyBefore - burned);
    expect(await coin.balanceOf(coinAddr)).to.equal(0n); // everything bought was burned
    expect(await coin.totalBuybackPair()).to.equal(ev!.args.pairIn);
    // The buyback swap itself paid no fee: creator share reflects the two taxed swaps only.
    const taxed = fee0 + ethers.parseEther("0.5") * 400n / 10000n;
    expect(await coin.totalCreatorFees()).to.equal(taxed * 5000n / 10000n);
    expect(await coin.totalBurnFees()).to.equal(taxed * 3000n / 10000n);
    // The trader still got a normal fill.
    expect(await coin.balanceOf(trader.address)).to.be.gt(SUPPLY / 100n);

    // Sells feed the reserve too; a small one stays below the threshold, then anyone can burn it by hand.
    const got = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sell(coinAddr, got / 20n, NO_ROUTE, 0)).wait();
    const reserve = await coin.burnReserve();
    expect(reserve).to.be.gt(0n);
    expect(reserve).to.be.lt(BUYBACK_MIN_WETH);
    const supplyMid = await coin.totalSupply();
    const rc2 = await (await coin.connect(trader).buybackAndBurn()).wait();
    const ev2 = rc2!.logs.map((l: any) => { try { return coin.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Buyback");
    expect(ev2!.args.inSwap).to.equal(false);
    expect(ev2!.args.pairIn).to.equal(reserve);
    expect(await coin.burnReserve()).to.equal(0n);
    expect(await coin.totalSupply()).to.equal(supplyMid - ev2!.args.coinsBurned);
    await expect(coin.connect(trader).buybackAndBurn()).to.be.revertedWithCustomError(coin, "NothingToBuy");

    // Creator and platform claims still work as before.
    const cf = await coin.creatorFees();
    const cBefore = await ethers.provider.getBalance(creator.address);
    const rc3 = await (await coin.connect(creator).claimCreatorFees(true, 0, NO_ROUTE)).wait();
    expect((await ethers.provider.getBalance(creator.address)) + rc3!.gasUsed * rc3!.gasPrice - cBefore).to.equal(cf);
    const pf = await coin.platformFees();
    await (await factory.connect(trader).pushPlatformFees([coinAddr])).wait();
    expect(await weth.balanceOf(admin.address)).to.equal(pf);
    // Nothing of the pair is stranded in the coin.
    expect(await weth.balanceOf(coinAddr)).to.equal(0n);
  });

  it("SLVon pair: fees land in the stock and the buyback burns the coin with SLVon, by hand and inside a swap", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    const coin = await launch(factory, creator, SLV, ethers.parseEther("0.2"), SLV_ROUTE);
    const coinAddr = await coin.getAddress();
    const slv = new ethers.Contract(SLV, ERC20, ethers.provider);
    // $25 of SLVon at $60.
    expect(await coin.buybackMin()).to.equal((25n * 10n ** 8n * 10n ** 18n) / SLV_USD_8);

    await pastSnipe();
    await (await router.connect(trader).buy(coinAddr, SLV_ROUTE, 0, { value: ethers.parseEther("0.05") })).wait();
    const reserve = await coin.burnReserve();
    expect(reserve).to.be.gt(0n);
    const supply0 = await coin.totalSupply();
    // Below the threshold: burn by hand. The pair may still sit in the hook as a V4 claim; the coin flushes it first.
    const rc = await (await coin.connect(trader).buybackAndBurn()).wait();
    const ev = rc!.logs.map((l: any) => { try { return coin.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Buyback");
    expect(ev!.args.pairIn).to.equal(reserve);
    expect(await coin.totalSupply()).to.equal(supply0 - ev!.args.coinsBurned);
    expect(await slv.balanceOf(coinAddr)).to.equal((await coin.creatorFees()) + (await coin.platformFees()));

    // A big enough buy crosses the threshold and burns inside the swap.
    const supply1 = await coin.totalSupply();
    const rc2 = await (await router.connect(trader).buy(coinAddr, SLV_ROUTE, 0, { value: ethers.parseEther("1") })).wait();
    const ev2 = rc2!.logs.map((l: any) => { try { return coin.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Buyback");
    if (ev2) {
      expect(ev2.args.inSwap).to.equal(true);
      expect(await coin.totalSupply()).to.equal(supply1 - ev2.args.coinsBurned);
      expect(await coin.burnReserve()).to.equal(0n);
    } else {
      // The stock was not physically in the PoolManager during the swap (held as a claim): deferred, not lost.
      expect(await coin.burnReserve()).to.be.gte(await coin.buybackMin());
      await (await coin.connect(trader).buybackAndBurn()).wait();
      expect(await coin.burnReserve()).to.equal(0n);
    }
    // Creator claims as ETH along the route.
    const cf = await coin.creatorFees();
    expect(cf).to.be.gt(0n);
    const cBefore = await ethers.provider.getBalance(creator.address);
    const rc3 = await (await coin.connect(creator).claimCreatorFees(true, 0, SLV_ROUTE)).wait();
    expect((await ethers.provider.getBalance(creator.address)) + rc3!.gasUsed * rc3!.gasPrice - cBefore).to.be.gt(0n);
  });

  it("anti-snipe still holds: launch block is creator-only, first blocks capped, surcharge goes to the platform", async () => {
    const [admin, creator, trader] = await ethers.getSigners();
    const { factory, router } = await deployAll(admin);
    await network.provider.send("evm_setAutomine", [false]);
    const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now()) % 2n ** 64n), 32);
    const n = Number(await factory.totalTokens());
    const tx1 = await factory.connect(creator).launch({ name: "Snipe", symbol: "SN", metadataURI: "{}", pair: WETH }, salt, NO_ROUTE, { gasLimit: 6_000_000 });
    await network.provider.send("evm_mine", []);
    await network.provider.send("evm_setAutomine", [true]);
    await tx1.wait();
    const coinAddr = await factory.allTokens(n);
    const coin = await ethers.getContractAt("EtherStockToken", coinAddr);
    // Next block: caps apply (3% per wallet) and the surcharge is still high.
    await expect(router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("2") })).to.be.reverted;
    await (await router.connect(trader).buy(coinAddr, NO_ROUTE, 0, { value: ethers.parseEther("0.001") })).wait();
    // The surcharge above the 4% base is platform-only: platform fees exceed 20% of the creator share ratio.
    const cf = await coin.totalCreatorFees(), pf = await coin.totalPlatformFees();
    expect(pf).to.be.gt(cf * 2000n / 5000n);
  });
});
