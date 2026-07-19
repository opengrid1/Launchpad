import { ethers, network } from "hardhat";

async function main() {
  const T = "0x600478629dd470fbf2a4145a24899458aab34663";
  const dep = "0x7817F4e44a658410C4ADA6a9226ef3d51e5Ea846";
  await network.provider.send("hardhat_mine", ["0x1"]);
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [dep] });
  await network.provider.send("hardhat_setBalance", [dep, "0x1000000000000000000"]);
  const signer = await ethers.getSigner(dep);
  const hook = await ethers.getContractAt("QuiverHook", "0x1E8fd8f01C44084E514d872AD27455De5c994044", signer);
  const tx = await hook.harvest(T, { gasLimit: 5_000_000 });
  await tx.wait();
  console.log("harvest OK");
}
main().catch((e) => { console.error(e); process.exit(1); });
