import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// FeeStaking: stake the project token, receive forwarded fees in kind.
// Proves pro-rata split, multi-asset (ETH + USDG) rewards, the no-stakers guard,
// cooldown behaviour (cooling tokens stop earning), late stakers not getting
// past rewards, and that the owner has no way to pull rewards back out.

const WAD = 10n ** 18n;
const USDG_1 = 10n ** 6n;
const MINT_ROLE = ethers.id("MINT_ROLE");
const ETH = ethers.ZeroAddress;

async function setup() {
  const [owner, creator, alice, bob] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockB20");
  const brrw = await Mock.deploy("Project", "BRRW", owner.address, 18);
  const usdg = await Mock.deploy("USDG", "USDG", owner.address, 6);
  for (const t of [brrw, usdg]) await t.grantRole(MINT_ROLE, owner.address);

  const staking = await (await ethers.getContractFactory("FeeStaking")).deploy(owner.address, await brrw.getAddress());
  const S = await staking.getAddress();
  await staking.setRewardAsset(ETH, true);
  await staking.setRewardAsset(await usdg.getAddress(), true);

  await brrw.mint(alice.address, 1_000n * WAD);
  await brrw.mint(bob.address, 1_000n * WAD);
  await usdg.mint(creator.address, 100_000n * USDG_1);
  await brrw.connect(alice).approve(S, ethers.MaxUint256);
  await brrw.connect(bob).approve(S, ethers.MaxUint256);
  await usdg.connect(creator).approve(S, ethers.MaxUint256);

  return { owner, creator, alice, bob, brrw, usdg, staking, S, U: await usdg.getAddress() };
}

describe("FeeStaking", () => {
  it("splits a forward pro-rata across current stakers, in kind", async () => {
    const { creator, alice, bob, staking, U } = await setup();
    await staking.connect(alice).stake(300n * WAD);
    await staking.connect(bob).stake(100n * WAD);

    await staking.connect(creator).notifyReward(U, 1_000n * USDG_1);
    await staking.connect(creator).notifyRewardETH({ value: ethers.parseEther("2") });

    expect(await staking.claimable(alice.address, U)).to.equal(750n * USDG_1);
    expect(await staking.claimable(bob.address, U)).to.equal(250n * USDG_1);
    expect(await staking.claimable(alice.address, ETH)).to.equal(ethers.parseEther("1.5"));
    expect(await staking.claimable(bob.address, ETH)).to.equal(ethers.parseEther("0.5"));
  });

  it("claimAll pays out ETH and USDG and zeroes the balances", async () => {
    const { creator, alice, staking, usdg, U } = await setup();
    await staking.connect(alice).stake(100n * WAD);
    await staking.connect(creator).notifyReward(U, 500n * USDG_1);
    await staking.connect(creator).notifyRewardETH({ value: ethers.parseEther("1") });

    const ethBefore = await ethers.provider.getBalance(alice.address);
    const tx = await staking.connect(alice).claimAll();
    const rc = await tx.wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    const ethAfter = await ethers.provider.getBalance(alice.address);

    expect(await usdg.balanceOf(alice.address)).to.equal(500n * USDG_1);
    expect(ethAfter - ethBefore + gas).to.equal(ethers.parseEther("1"));
    expect(await staking.claimable(alice.address, U)).to.equal(0n);
    expect(await staking.claimable(alice.address, ETH)).to.equal(0n);
  });

  it("refuses a forward when nobody is staked, so fees never get stuck", async () => {
    const { creator, staking, U } = await setup();
    await expect(staking.connect(creator).notifyReward(U, 100n * USDG_1)).to.be.revertedWithCustomError(staking, "NoStakers");
    await expect(staking.connect(creator).notifyRewardETH({ value: 1n })).to.be.revertedWithCustomError(staking, "NoStakers");
    // and plain ETH transfers are refused too
    await expect(creator.sendTransaction({ to: await staking.getAddress(), value: 1n })).to.be.revertedWith("use notifyRewardETH");
  });

  it("a late staker earns nothing from earlier forwards", async () => {
    const { creator, alice, bob, staking, U } = await setup();
    await staking.connect(alice).stake(100n * WAD);
    await staking.connect(creator).notifyReward(U, 1_000n * USDG_1);
    await staking.connect(bob).stake(100n * WAD); // after the forward
    expect(await staking.claimable(bob.address, U)).to.equal(0n);
    expect(await staking.claimable(alice.address, U)).to.equal(1_000n * USDG_1);

    await staking.connect(creator).notifyReward(U, 1_000n * USDG_1); // now both earn
    expect(await staking.claimable(bob.address, U)).to.equal(500n * USDG_1);
    expect(await staking.claimable(alice.address, U)).to.equal(1_500n * USDG_1);
  });

  it("tokens in cooldown stop earning and are released only after the cooldown", async () => {
    const { creator, alice, bob, staking, brrw, U } = await setup();
    await staking.connect(alice).stake(100n * WAD);
    await staking.connect(bob).stake(100n * WAD);

    await staking.connect(alice).requestUnstake(100n * WAD);
    expect(await staking.totalStaked()).to.equal(100n * WAD);

    await staking.connect(creator).notifyReward(U, 1_000n * USDG_1);
    expect(await staking.claimable(alice.address, U)).to.equal(0n); // cooling, earns nothing
    expect(await staking.claimable(bob.address, U)).to.equal(1_000n * USDG_1);

    await expect(staking.connect(alice).unstake()).to.be.revertedWithCustomError(staking, "StillCooling");
    await time.increase(7 * 24 * 3600 + 1);
    await staking.connect(alice).unstake();
    expect(await brrw.balanceOf(alice.address)).to.equal(1_000n * WAD);
    await expect(staking.connect(alice).unstake()).to.be.revertedWithCustomError(staking, "NothingPending");
  });

  it("rewards earned before a stake change are kept", async () => {
    const { creator, alice, staking, U } = await setup();
    await staking.connect(alice).stake(100n * WAD);
    await staking.connect(creator).notifyReward(U, 400n * USDG_1);
    await staking.connect(alice).stake(300n * WAD); // stake change settles the 400 into owed
    await staking.connect(creator).notifyReward(U, 400n * USDG_1);
    expect(await staking.claimable(alice.address, U)).to.equal(800n * USDG_1);
    await staking.connect(alice).requestUnstake(400n * WAD);
    expect(await staking.claimable(alice.address, U)).to.equal(800n * USDG_1); // still owed after leaving
  });

  it("only owner-approved assets can be forwarded", async () => {
    const { owner, creator, alice, staking, brrw } = await setup();
    await staking.connect(alice).stake(100n * WAD);
    const B = await brrw.getAddress();
    await brrw.mint(creator.address, 10n * WAD);
    await brrw.connect(creator).approve(await staking.getAddress(), ethers.MaxUint256);
    await expect(staking.connect(creator).notifyReward(B, 10n * WAD)).to.be.revertedWithCustomError(staking, "NotRewardAsset");
    await staking.connect(owner).setRewardAsset(B, true);
    await staking.connect(creator).notifyReward(B, 10n * WAD);
    expect(await staking.claimable(alice.address, B)).to.equal(10n * WAD);
  });

  it("owner has no way to withdraw forwarded rewards", async () => {
    const { owner, creator, alice, staking, usdg, U } = await setup();
    await staking.connect(alice).stake(100n * WAD);
    await staking.connect(creator).notifyReward(U, 1_000n * USDG_1);
    // the only owner functions are setRewardAsset and setCooldown; neither moves funds
    const abi = staking.interface;
    const ownerFns = abi.fragments.filter((f) => f.type === "function").map((f: any) => f.name);
    expect(ownerFns).to.not.include.members(["withdraw", "rescue", "sweep", "recall", "emergencyWithdraw"]);
    await expect(staking.connect(owner).setCooldown(31 * 24 * 3600)).to.be.revertedWith("cooldown too long");
    expect(await usdg.balanceOf(await staking.getAddress())).to.equal(1_000n * USDG_1);
  });
});
