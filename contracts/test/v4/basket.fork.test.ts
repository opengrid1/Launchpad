import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * Basket launchpad against live Base infrastructure (FORK=1 with a Base RPC):
 * the real Uniswap v4 PoolManager, real WETH, and the real Aerodrome
 * Slipstream router for the holders' pair -> reward-token swap. Coins are
 * MockB20 because the B-20 precompile cannot run on a fork, and the reward is
 * USDC because the tokenized stocks are precompiles too; the vault code path
 * (keeper-chosen Slipstream path, vault-fixed endpoints) is identical.
 */
const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SLIPSTREAM_ROUTER = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";
const WETH_USDC_TICK_SPACING = 1;
const HOOK_FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const E = ethers.parseEther;
const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
const coder = ethers.AbiCoder.defaultAbiCoder();
const leafOf = (account: string, amount: bigint) =>
  ethers.keccak256(ethers.keccak256(coder.encode(["address", "uint256"], [account, amount])));

describe("Basket launchpad on live Base infra (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1 against a Base RPC", () => {}); return; }

  it("launches, trades, graduates, and pays holders USDC bought on Slipstream", async () => {
    const [admin, creator, trader, keeper, treasury] = await ethers.getSigners();
    const weth = await ethers.getContractAt(erc20Abi, WETH);
    const usdc = await ethers.getContractAt(erc20Abi, USDC);

    const b20f = await (await ethers.getContractFactory("MockB20Factory")).deploy();
    await b20f.waitForDeployment();
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("BasketFeeHook");
    const hookInit = ethers.concat([
      Hook.bytecode, coder.encode(["address", "address", "address"], [POOL_MANAGER, admin.address, treasury.address]),
    ]);
    const hookHash = ethers.keccak256(hookInit);
    let hookAddr = "", salt = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hookHash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
    }
    await (await c2.deploy(salt, hookInit)).wait();
    const hook = await ethers.getContractAt("BasketFeeHook", hookAddr);

    const vd = await (await ethers.getContractFactory("BasketVaultDeployer")).deploy();
    await vd.waitForDeployment();
    const factory = await (await ethers.getContractFactory("BasketFactory")).deploy(
      admin.address, POOL_MANAGER, hookAddr, await vd.getAddress(), await b20f.getAddress(), WETH, keeper.address, SLIPSTREAM_ROUTER,
    );
    await factory.waitForDeployment();
    await (await hook.setFactory(await factory.getAddress())).wait();
    await (await factory.setPairConfig(WETH, {
      enabled: true, startMcap: E("3.9"), gradMcap: E("29"), minOpeningBuy: E("0.005"),
    })).wait();
    await (await factory.setRewardTokenApproved(USDC, true)).wait();
    const router = await (await ethers.getContractFactory("StockTradeRouter")).deploy(POOL_MANAGER, await factory.getAddress(), WETH);
    await router.waitForDeployment();

    // Launch a holders-mode coin that pays USDC, with the required opening buy.
    await (await factory.connect(creator).launch({
      name: "Alpha", symbol: "ALPHA", metadataURI: "", pair: WETH, feeMode: 0, rewardToken: USDC,
      feeRecipient: ethers.ZeroAddress, openingBuyIn: 0, minTokensOut: 0,
    }, ethers.hexlify(ethers.randomBytes(32)), { value: E("0.01") })).wait();
    const coin = await factory.allTokens(0n);
    const erc = await ethers.getContractAt("MockB20", coin);
    const coinIs0 = BigInt(coin) < BigInt(WETH);
    const key = { currency0: coinIs0 ? coin : WETH, currency1: coinIs0 ? WETH : coin, fee: 0, tickSpacing: 60, hooks: hookAddr };
    const poolId = (await factory.listings(coin)).poolId;
    expect(await erc.balanceOf(creator.address), "opening buy filled").to.be.greaterThan(0n);

    // Buy, sell half, then buy through graduation.
    await (await router.connect(trader).buyWithEth(coin, 0, { value: E("1") })).wait();
    let a = await hook.accruedOf(poolId);
    expect(a.beneficiary, "holders 0.5% of 1.01 ETH").to.equal((E("1.01") * 50n) / 10_000n);
    expect(a.protocol, "protocol 1.5%").to.equal((E("1.01") * 150n) / 10_000n);
    await (await erc.connect(trader).approve(await router.getAddress(), ethers.MaxUint256)).wait();
    await (await router.connect(trader).sellForEth(coin, (await erc.balanceOf(trader.address)) / 2n, 0)).wait();
    expect((await hook.accruedOf(poolId)).beneficiary).to.be.greaterThan(a.beneficiary);
    expect(await factory.isGraduated(coin)).to.equal(false);
    await (await router.connect(trader).buyWithEth(coin, 0, { value: E("8") })).wait();
    expect(await factory.isGraduated(coin), "graduated at the cap").to.equal(true);
    expect(await hook.feeNow(poolId)).to.deep.equal([125n, 67n]);

    // Sweep: WETH to the vault and the protocol recipient, nothing in the coin.
    const vault = await ethers.getContractAt("BasketRewardVault", (await factory.launchInfo(coin)).vault);
    const V = await vault.getAddress();
    a = await hook.accruedOf(poolId);
    const tre0 = await weth.balanceOf(treasury.address);
    await (await hook.sweep(key)).wait();
    expect(await weth.balanceOf(V)).to.equal(a.beneficiary);
    expect((await weth.balanceOf(treasury.address)) - tre0).to.equal(a.protocol);
    expect(await erc.balanceOf(V)).to.equal(0n);

    // Keeper swaps the holders' WETH into USDC on the real Slipstream router.
    const path = ethers.solidityPacked(["address", "int24", "address"], [WETH, WETH_USDC_TICK_SPACING, USDC]);
    await (await vault.connect(keeper).swapToReward(path, a.beneficiary, 1)).wait();
    const pool = await vault.distributable();
    expect(pool, "USDC ready for holders").to.be.greaterThan(0n);
    expect(await weth.balanceOf(V)).to.equal(0n);
    // eslint-disable-next-line no-console
    console.log(`      Slipstream: ${ethers.formatEther(a.beneficiary)} WETH -> ${ethers.formatUnits(pool, 6)} USDC`);

    // Post a root and claim.
    const cAmt = pool / 4n, tAmt = pool - cAmt;
    const lc = leafOf(creator.address, cAmt), lt = leafOf(trader.address, tAmt);
    const root = ethers.keccak256(BigInt(lc) < BigInt(lt) ? ethers.concat([lc, lt]) : ethers.concat([lt, lc]));
    await (await vault.connect(keeper).postRoot(root, pool)).wait();
    await (await vault.claim(trader.address, tAmt, [lc])).wait();
    await (await vault.claim(creator.address, cAmt, [lt])).wait();
    expect(await usdc.balanceOf(trader.address)).to.equal(tAmt);
    expect(await usdc.balanceOf(creator.address)).to.equal(cAmt);
    expect(await usdc.balanceOf(V)).to.equal(0n);
  });
});
