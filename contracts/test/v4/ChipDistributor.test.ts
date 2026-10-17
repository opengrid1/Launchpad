import { expect } from "chai";
import { ethers } from "hardhat";

const E = ethers.parseEther;

/** The main coin is a real StockPadToken: holders are credited by its own
 *  accumulator, the distributor just feeds it the platform's fees. */
describe("ChipDistributor", () => {
  async function setup() {
    const [factory, creator, a, b, feeder, poolManager] = await ethers.getSigners();
    const weth = await (await ethers.getContractFactory("WETH9")).deploy();
    const chip = await (await ethers.getContractFactory("StockPadToken")).deploy(
      "Chipfi", "CHIP", "", E("1000000000"), creator.address, factory.address, await weth.getAddress(), poolManager.address, 5000, 3000,
    );
    // The factory holds the supply (excluded); hand some to holders.
    await chip.connect(factory).transfer(a.address, E("300"));
    await chip.connect(factory).transfer(b.address, E("100"));
    const stock = await (await ethers.getContractFactory("MockToken")).deploy("NVIDIA (Ondo)", "NVDAon", 18);
    const conv = await (await ethers.getContractFactory("MockConverter")).deploy(E("0.1")); // 1 NVDAon = 0.1 ETH
    await feeder.sendTransaction({ to: await conv.getAddress(), value: E("50") });
    const dist = await (await ethers.getContractFactory("ChipDistributor")).deploy(await chip.getAddress(), await weth.getAddress(), await conv.getAddress());
    return { factory, creator, a, b, feeder, poolManager, weth, chip, stock, conv, dist };
  }

  it("pays every CHIP holder the WETH fees on sync, claimable at once", async () => {
    const { a, b, feeder, weth, chip, dist } = await setup();
    expect(await chip.eligibleSupply()).to.equal(E("400"));
    await weth.connect(feeder).deposit({ value: E("8") });
    await weth.connect(feeder).transfer(await dist.getAddress(), E("8"));
    await expect(dist.sync()).to.emit(dist, "Distributed").withArgs(E("8"));
    expect(await chip.pendingRewards(a.address)).to.equal(E("6"));
    expect(await chip.pendingRewards(b.address)).to.equal(E("2"));
    await chip.connect(a).claimRewards();
    expect(await weth.balanceOf(a.address)).to.equal(E("6"));
    expect(await chip.pendingRewards(a.address)).to.equal(0n);
  });

  it("turns stock fees into ETH and pays holders", async () => {
    const { a, b, stock, chip, dist } = await setup();
    await stock.mint(await dist.getAddress(), E("2"));
    await expect(dist.harvest(await stock.getAddress(), E("0.2"), "0x")).to.emit(dist, "Harvested").withArgs(await stock.getAddress(), E("2"), E("0.2"));
    expect(await chip.pendingRewards(a.address)).to.equal(E("0.15"));
    expect(await chip.pendingRewards(b.address)).to.equal(E("0.05"));
    await expect(dist.harvest(await stock.getAddress(), 0, "0x")).to.be.revertedWithCustomError(dist, "NothingToHarvest");
  });

  it("a wallet that receives CHIP later only earns later fees, and the pool earns nothing", async () => {
    const { a, b, feeder, poolManager, weth, chip, dist } = await setup();
    await weth.connect(feeder).deposit({ value: E("8") });
    await weth.connect(feeder).transfer(await dist.getAddress(), E("4"));
    await dist.sync();
    await chip.connect(a).transfer(poolManager.address, E("100")); // into the pool: excluded
    await chip.connect(b).transfer(feeder.address, E("100"));      // b hands everything to a new holder
    await weth.connect(feeder).transfer(await dist.getAddress(), E("4"));
    await dist.sync();
    // Second 4 ETH split over a 200 + feeder 100 = 300 eligible.
    expect(await chip.pendingRewards(a.address)).to.be.closeTo(E("3") + E("2.6667"), E("0.001"));
    expect(await chip.pendingRewards(b.address)).to.be.closeTo(E("1"), E("0.001"));
    expect(await chip.pendingRewards(feeder.address)).to.be.closeTo(E("1.3333"), E("0.001"));
    expect(await chip.pendingRewards(poolManager.address)).to.equal(0n);
  });

  it("refuses to fund a coin with no eligible holders", async () => {
    const { factory, creator, poolManager, weth, feeder } = await setup();
    const empty = await (await ethers.getContractFactory("StockPadToken")).deploy(
      "Empty", "EMP", "", E("1000"), creator.address, factory.address, await weth.getAddress(), poolManager.address, 5000, 3000,
    );
    await weth.connect(feeder).deposit({ value: E("1") });
    await weth.connect(feeder).approve(await empty.getAddress(), E("1"));
    await expect(empty.connect(feeder).fund(E("1"))).to.be.revertedWithCustomError(empty, "NoHolders");
  });
});
