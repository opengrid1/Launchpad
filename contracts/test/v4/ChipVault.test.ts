import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const E = ethers.parseEther;

describe("ChipVault", () => {
  async function setup() {
    const [keeper, a, b, feeder] = await ethers.getSigners();
    const weth = await (await ethers.getContractFactory("WETH9")).deploy();
    const chip = await (await ethers.getContractFactory("MockToken")).deploy("Chipfi", "CHIP", 18);
    const stock = await (await ethers.getContractFactory("MockToken")).deploy("NVIDIA (Ondo)", "NVDAon", 18);
    const conv = await (await ethers.getContractFactory("MockConverter")).deploy(E("0.1")); // 1 NVDAon = 0.1 ETH
    await feeder.sendTransaction({ to: await conv.getAddress(), value: E("50") });
    const vault = await (await ethers.getContractFactory("ChipVault")).deploy(await chip.getAddress(), await weth.getAddress(), await conv.getAddress(), keeper.address);
    for (const s of [a, b]) {
      await chip.mint(s.address, E("1000"));
      await chip.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
    }
    return { keeper, a, b, feeder, weth, chip, stock, conv, vault };
  }

  it("streams WETH fees to stakers pro-rata over the period", async () => {
    const { a, b, feeder, weth, vault } = await setup();
    await vault.connect(a).stake(E("300"));
    await vault.connect(b).stake(E("100"));
    // A coin's platform share arrives as WETH.
    await weth.connect(feeder).deposit({ value: E("7") });
    await weth.connect(feeder).transfer(await vault.getAddress(), E("7"));
    expect(await vault.pending(await weth.getAddress())).to.equal(E("7"));
    await vault.sync();
    expect(await vault.pending(await weth.getAddress())).to.equal(0n);
    await time.increase(7 * 24 * 3600);
    const ea = await vault.earned(a.address); const eb = await vault.earned(b.address);
    expect(ea).to.be.closeTo(E("5.25"), E("0.001"));
    expect(eb).to.be.closeTo(E("1.75"), E("0.001"));
    const before = await ethers.provider.getBalance(a.address);
    const tx = await vault.connect(a).claim(); const rc = await tx.wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    expect((await ethers.provider.getBalance(a.address)) - before + gas).to.be.closeTo(E("5.25"), E("0.001"));
    expect(await vault.earned(a.address)).to.equal(0n);
  });

  it("harvests a stock balance into ETH through the router", async () => {
    const { a, stock, weth, vault } = await setup();
    await vault.connect(a).stake(E("10"));
    await stock.mint(await vault.getAddress(), E("2")); // 2 NVDAon of platform fees
    expect(await vault.pending(await stock.getAddress())).to.equal(E("2"));
    await expect(vault.harvest(await stock.getAddress(), E("0.2"), "0x")).to.emit(vault, "Harvested").withArgs(await stock.getAddress(), E("2"), E("0.2"));
    expect(await weth.balanceOf(await vault.getAddress())).to.equal(E("0.2"));
    expect(await vault.wethAccounted()).to.equal(E("0.2"));
    await time.increase(7 * 24 * 3600);
    expect(await vault.earned(a.address)).to.be.closeTo(E("0.2"), E("0.0001"));
    await expect(vault.harvest(await stock.getAddress(), 0, "0x")).to.be.revertedWithCustomError(vault, "NothingToHarvest");
  });

  it("a late staker only earns from the moment it stakes", async () => {
    const { a, b, feeder, weth, vault } = await setup();
    await vault.connect(a).stake(E("100"));
    await weth.connect(feeder).deposit({ value: E("7") });
    await weth.connect(feeder).transfer(await vault.getAddress(), E("7"));
    await vault.sync();
    await time.increase(3.5 * 24 * 3600);
    await vault.connect(b).stake(E("100")); // halfway through
    await time.increase(3.5 * 24 * 3600);
    expect(await vault.earned(a.address)).to.be.closeTo(E("5.25"), E("0.01"));
    expect(await vault.earned(b.address)).to.be.closeTo(E("1.75"), E("0.01"));
    await vault.connect(b).exit();
    expect(await vault.staked(b.address)).to.equal(0n);
    expect(await vault.totalStaked()).to.equal(E("100"));
  });

  it("refuses to sync with no stakers and holds the fees for later", async () => {
    const { feeder, weth, vault, a } = await setup();
    await weth.connect(feeder).deposit({ value: E("1") });
    await weth.connect(feeder).transfer(await vault.getAddress(), E("1"));
    await expect(vault.sync()).to.be.revertedWithCustomError(vault, "NoStakers");
    await vault.connect(a).stake(E("1"));
    await vault.sync();
    await time.increase(7 * 24 * 3600);
    expect(await vault.earned(a.address)).to.be.closeTo(E("1"), E("0.0001"));
  });
});
