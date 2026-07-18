import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Live proof that a seller stops earning: sell the signer's entire QVR
 * position, run a harvest that distributes NVDA, and show the seller's
 * pending stays zero and their NVDA wallet balance doesn't move.
 */
async function main() {
  const [signer] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, "../deployments/quiver-v4.json"), "utf8"));
  const hook = await ethers.getContractAt("QuiverHook", dep.contracts.hook);
  const router = await ethers.getContractAt("QuiverRouter", dep.contracts.router);
  const factory = await ethers.getContractAt("QuiverFactory", dep.contracts.factory);
  const qvr = await factory.allTokens(0);
  const token = await ethers.getContractAt("QuiverToken", qvr);
  const nvda = new ethers.Contract(
    "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    ["function balanceOf(address) view returns (uint256)"],
    ethers.provider,
  );

  const bal = await token.balanceOf(signer.address);
  console.log("QVR before sell:", ethers.formatEther(bal));
  const nvdaBefore = await nvda.balanceOf(signer.address);
  console.log("NVDA wallet before:", ethers.formatEther(nvdaBefore));

  // 1. Sell EVERYTHING.
  await (await token.approve(await router.getAddress(), bal)).wait();
  await (await router.sell(qvr, bal, 0)).wait();
  console.log("sold. QVR now:", ethers.formatEther(await token.balanceOf(signer.address)));

  // 2. Any residual earned-while-holding is settled; deliver and zero it.
  await (await token.claimForMany([signer.address], { gasLimit: 500_000n })).wait();
  const nvdaAfterResidual = await nvda.balanceOf(signer.address);
  console.log("NVDA after residual delivery:", ethers.formatEther(nvdaAfterResidual));

  // 3. Harvest the (sell-tax) fees — a NEW distribution the seller must miss.
  await (await hook.harvest(qvr)).wait();
  console.log("harvested. totalRewardsDistributed:", ethers.formatEther(await token.totalRewardsDistributed()));

  // 4. Seller's pending after the new distribution must be ZERO.
  const pend = await token.pendingRewards(signer.address);
  const nvdaAfter = await nvda.balanceOf(signer.address);
  console.log("seller pendingRewards after new distribution:", ethers.formatEther(pend));
  console.log("seller NVDA wallet after:", ethers.formatEther(nvdaAfter));
  console.log(
    pend === 0n && nvdaAfter === nvdaAfterResidual
      ? "\nPROVEN: after selling, the wallet receives NOTHING from new distributions ✅"
      : "\nUNEXPECTED: seller still accrued ❌",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
