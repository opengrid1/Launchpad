import { expect } from "chai";
import { ethers } from "hardhat";

// Live Uniswap V4 stack + tokens on Robinhood Chain (discovered on-chain).
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";

const AFTER_SWAP_FLAG = 1n << 6n; // 64
const AFTER_SWAP_RETURNS_DELTA_FLAG = 1n << 2n; // 4
const HOOK_FLAGS = AFTER_SWAP_FLAG | AFTER_SWAP_RETURNS_DELTA_FLAG; // 68
const FLAG_MASK = (1n << 14n) - 1n;

const WETH_ABI = [
  "function deposit() payable",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const emptyKey = {
  currency0: ethers.ZeroAddress,
  currency1: ethers.ZeroAddress,
  fee: 0,
  tickSpacing: 60,
  hooks: ethers.ZeroAddress,
};

describe("Quiver V4 launchpad (fork)", function () {
  this.timeout(300_000);

  if (process.env.FORK !== "1") {
    it.skip("requires FORK=1 to run against the Robinhood Chain fork", () => {});
    return;
  }

  it("launches, taxes buys, enforces the 2% wallet cap, and harvests", async () => {
    const [admin, trader] = await ethers.getSigners();
    const treasury = admin.address;

    // 1. Deploy the CREATE2 deployer and mine a flag-valid hook address.
    const Deployer = await ethers.getContractFactory("HookDeployer");
    const deployer = await Deployer.deploy();
    await deployer.waitForDeployment();
    const deployerAddr = await deployer.getAddress();

    const Hook = await ethers.getContractFactory("QuiverHook");
    const ctorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "address"],
      [POOL_MANAGER, admin.address, treasury, WETH],
    );
    const initCode = ethers.concat([Hook.bytecode, ctorArgs]);
    const initCodeHash = ethers.keccak256(initCode);

    let hookAddr = "";
    let salt = "";
    for (let i = 0n; i < 200_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const addr = ethers.getCreate2Address(deployerAddr, s, initCodeHash);
      if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) {
        hookAddr = addr;
        salt = s;
        break;
      }
    }
    expect(hookAddr, "mined hook address").to.not.equal("");
    await (await deployer.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("QuiverHook", hookAddr);
    expect((BigInt(hookAddr) & FLAG_MASK)).to.equal(HOOK_FLAGS);

    // 2. Factory. $3,000 WETH price -> $5,000 start cap.
    const Factory = await ethers.getContractFactory("QuiverFactory");
    const factory = await Factory.deploy(admin.address, POOL_MANAGER, hookAddr, WETH, 3000n * 10n ** 8n);
    await factory.waitForDeployment();
    const factoryAddr = await factory.getAddress();

    await (await hook.setFactory(factoryAddr)).wait();
    // List the stock (holder route left unconfigured for this test).
    await (await factory.listStock(NVDA, emptyKey)).wait();

    // 3. Launch a token with a 5% tax.
    const tx = await factory.launch({
      name: "Fork Test",
      symbol: "FORK",
      metadataURI: "",
      stock: NVDA,
      taxBps: 500,
    });
    const rcpt = await tx.wait();
    const token = await factory.allTokens(0);
    const erc20 = await ethers.getContractAt("QuiverToken", token);
    const supply = await erc20.totalSupply();
    expect(supply).to.equal(10n ** 27n);

    // Seeded single-sided: the whole supply sits in the PoolManager.
    const pmBal = await erc20.balanceOf(POOL_MANAGER);
    expect(pmBal).to.be.greaterThan((supply * 99n) / 100n);

    // 4. Buy through a test router and check the tax was skimmed.
    const Router = await ethers.getContractFactory("TestRouter");
    const router = await Router.deploy(POOL_MANAGER);
    await router.waitForDeployment();
    const routerAddr = await router.getAddress();

    const weth = new ethers.Contract(WETH, WETH_ABI, trader);
    await (await weth.deposit({ value: ethers.parseEther("1") })).wait();
    await (await weth.approve(routerAddr, ethers.MaxUint256)).wait();

    const tokenIsC0 = BigInt(token) < BigInt(WETH);
    const key = {
      currency0: tokenIsC0 ? token : WETH,
      currency1: tokenIsC0 ? WETH : token,
      fee: 0,
      tickSpacing: 60,
      hooks: hookAddr,
    };
    // Buying the token means spending WETH: zeroForOne is true when WETH is currency0.
    const buyZeroForOne = !tokenIsC0;

    // ~$12 at $3k/WETH — under the 1% max-tx cap of a $5k start cap.
    await (await router.connect(trader).swapExactIn(key, buyZeroForOne, ethers.parseEther("0.004"), trader.address)).wait();

    const traderBal = await erc20.balanceOf(trader.address);
    expect(traderBal, "trader received tokens").to.be.greaterThan(0n);
    const maxWallet = await erc20.maxWalletAmount();
    expect(traderBal, "under 2% wallet cap").to.be.lessThanOrEqual(maxWallet);

    const tokenFees = await hook.tokenFees(token);
    expect(tokenFees, "tax skimmed on the buy (token output)").to.be.greaterThan(0n);

    // 5. A buy that would exceed the 2% wallet cap must revert.
    await weth.deposit({ value: ethers.parseEther("5") });
    await expect(
      router.connect(trader).swapExactIn(key, buyZeroForOne, ethers.parseEther("5"), trader.address),
    ).to.be.reverted;

    // 6. Harvest: converts token fees -> WETH, splits, buys back & burns.
    const supplyBefore = await erc20.totalSupply();
    await (await hook.harvest(token)).wait();
    const creatorClaim = await hook.creatorClaimable(token);
    expect(creatorClaim, "creator accrued WETH").to.be.greaterThan(0n);
    const supplyAfter = await erc20.totalSupply();
    expect(supplyAfter, "buyback burned supply").to.be.lessThan(supplyBefore);

    // 7. Creator claims their WETH.
    const wethAdmin = new ethers.Contract(WETH, WETH_ABI, admin);
    const before = await wethAdmin.balanceOf(admin.address);
    await (await hook.connect(admin).claimCreatorFees(token)).wait();
    const after = await wethAdmin.balanceOf(admin.address);
    expect(after - before).to.equal(creatorClaim);
  });
});
