import { ethers } from "hardhat";

// Claims PRINTR creator fees to the deployer and unwraps ALL deployer WETH
// to native ETH so the balance is visible in the Robinhood wallet app.
async function main() {
  const [signer] = await ethers.getSigners();
  const hook = new ethers.Contract("0x1E8fd8f01C44084E514d872AD27455De5c994044",
    ["function claimCreatorFees(address) returns (uint256)", "function creatorClaimable(address) view returns (uint256)"], signer);
  const weth = new ethers.Contract(ethers.getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
    ["function balanceOf(address) view returns (uint256)", "function withdraw(uint256)"], signer);

  const claimable = await hook.creatorClaimable("0x600478629dd470fbf2a4145a24899458aab34663");
  console.log("claimable:", ethers.formatEther(claimable), "WETH");
  if (claimable > 0n) await (await hook.claimCreatorFees("0x600478629dd470fbf2a4145a24899458aab34663")).wait();

  const bal = await weth.balanceOf(signer.address);
  console.log("deployer WETH after claim:", ethers.formatEther(bal));
  if (bal > 0n) await (await weth.withdraw(bal)).wait();
  console.log("unwrapped ✅ deployer ETH now:", ethers.formatEther(await ethers.provider.getBalance(signer.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
