import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Claim a coin's creator fee share (from the creator wallet, the deployer) and send the HYPE to another wallet,
 * then push the platform share to the fee recipient.
 *
 *   LIQIO_COIN=0x... LIQIO_TO=0x... npx hardhat run scripts/liqio-claim-to.ts --network hyperevm
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/liqio-${network.name}.json`), "utf8"));
  const coinAddr = process.env.LIQIO_COIN!, to = process.env.LIQIO_TO!;
  if (!coinAddr || !ethers.isAddress(to)) throw new Error("LIQIO_COIN and LIQIO_TO are needed");
  const factory = await ethers.getContractAt("LiqioFactory", dep.contracts.factory);
  const hook = await ethers.getContractAt("EquoHook", dep.contracts.hook);
  const f = (v: bigint) => ethers.formatEther(v);
  const fee = await ethers.provider.getFeeData();
  const gasOpts = { maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice!) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n };

  const owed = await hook.creatorOwed(coinAddr), platform = await hook.platformOwed(coinAddr);
  console.log(`creator owed ${f(owed)} HYPE, platform owed ${f(platform)} HYPE, wallet ${f(await ethers.provider.getBalance(me.address))} HYPE`);
  if (owed === 0n) throw new Error("nothing to claim");
  const before = await ethers.provider.getBalance(me.address);
  const rc = await (await factory.claimCreatorFees(coinAddr, gasOpts)).wait();
  const claimed = (await ethers.provider.getBalance(me.address)) - before + rc!.gasUsed * rc!.gasPrice;
  console.log(`claimed ${f(claimed)} HYPE  tx ${rc!.hash}`);
  const rc2 = await (await me.sendTransaction({ to, value: claimed, ...gasOpts })).wait();
  console.log(`sent ${f(claimed)} HYPE to ${to}  tx ${rc2!.hash}`);
  if (platform > 0n) {
    const rc3 = await (await factory.pushPlatformFees([coinAddr], gasOpts)).wait();
    console.log(`pushed ${f(platform)} HYPE platform share to ${await factory.feeRecipient()}  tx ${rc3!.hash}`);
  }
  console.log(`wallet now ${f(await ethers.provider.getBalance(me.address))} HYPE`);
}

main().catch((e) => { console.error(e); process.exit(1); });
