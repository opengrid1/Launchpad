import { ethers } from "hardhat";

// Creator-fee policy per the public transparency commitment: claim, buy back
// PRINTR with the full amount, and burn it at the dead address.
const PRINTR = "0x600478629dd470fbf2a4145a24899458aab34663";
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function main() {
  const [signer] = await ethers.getSigners();
  const hook = new ethers.Contract("0x1E8fd8f01C44084E514d872AD27455De5c994044",
    ["function creatorClaimable(address) view returns (uint256)", "function claimCreatorFees(address) returns (uint256)"], signer);
  const weth = new ethers.Contract(ethers.getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"),
    ["function balanceOf(address) view returns (uint256)", "function withdraw(uint256)"], signer);
  const router = new ethers.Contract("0xA5CED4a472586B79c8d744F1b50b8D5a703b1b5d",
    ["function buy(address,uint256) payable returns (uint256)"], signer);
  const token = new ethers.Contract(PRINTR,
    ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)"], signer);

  const claimable = await hook.creatorClaimable(PRINTR);
  console.log("creator fees claimable:", ethers.formatEther(claimable), "WETH");
  if (claimable === 0n) { console.log("nothing to claim"); return; }

  await (await hook.claimCreatorFees(PRINTR)).wait();
  const w = await weth.balanceOf(signer.address);
  await (await weth.withdraw(w)).wait();
  console.log("claimed + unwrapped:", ethers.formatEther(w), "ETH");

  const before = await token.balanceOf(signer.address);
  await (await router.buy(PRINTR, 0, { value: w })).wait();
  const bought = (await token.balanceOf(signer.address)) - before;
  console.log("bought back:", ethers.formatEther(bought), "PRINTR");

  await (await token.transfer(DEAD, bought)).wait();
  console.log("burned to dead ✅ total dead balance:", ethers.formatEther(await token.balanceOf(DEAD)), "PRINTR");
}
main().catch((e) => { console.error(e); process.exit(1); });
