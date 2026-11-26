import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Creator fee run for one Liqio coin, from the creator's wallet (the deployer):
 *   1. claim the creator's fee share (paid in HYPE),
 *   2. buy the coin back with it through the router,
 *   3. burn the coins (totalSupply goes down),
 *   4. push the platform's share to the fee recipient (anyone can).
 *
 *   LIQIO_COIN=0x... npx hardhat run scripts/liqio-claim-buyback.ts --network hyperevm
 *   LIQIO_KEEP_HYPE (default 0.05): HYPE left in the wallet for gas when the claimed amount is spent.
 */
async function main() {
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, `../deployments/liqio-${network.name}.json`), "utf8"));
  const coinAddr = process.env.LIQIO_COIN!;
  if (!coinAddr) throw new Error("LIQIO_COIN is needed");
  const factory = await ethers.getContractAt("LiqioFactory", dep.contracts.factory);
  const hook = await ethers.getContractAt("EquoHook", dep.contracts.hook);
  const router = await ethers.getContractAt("EquoRouter", dep.contracts.router);
  const coin = await ethers.getContractAt("LiqioToken", coinAddr);
  const sym = await coin.symbol();
  const f = (v: bigint) => ethers.formatEther(v);
  const fee = await ethers.provider.getFeeData();
  const gasOpts = { maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice!) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n };

  const owed = await hook.creatorOwed(coinAddr);
  const platform = await hook.platformOwed(coinAddr);
  console.log(`${sym}: creator owed ${f(owed)} HYPE, platform owed ${f(platform)} HYPE, wallet ${f(await ethers.provider.getBalance(me.address))} HYPE`);
  if ((await hook.creatorOf(coinAddr)).toLowerCase() !== me.address.toLowerCase()) throw new Error("not the creator");

  // 1. claim
  let claimed = 0n;
  if (owed > 0n) {
    const before = await ethers.provider.getBalance(me.address);
    const rc = await (await factory.claimCreatorFees(coinAddr, gasOpts)).wait();
    const gasCost = rc!.gasUsed * rc!.gasPrice;
    claimed = (await ethers.provider.getBalance(me.address)) - before + gasCost;
    console.log(`claimed ${f(claimed)} HYPE  tx ${rc!.hash}`);
  }

  // 2. buy back with what was claimed, keeping a gas reserve
  const keep = ethers.parseEther(process.env.LIQIO_KEEP_HYPE ?? "0.05");
  const bal = await ethers.provider.getBalance(me.address);
  let spend = claimed > 0n ? claimed : owed;
  if (bal - spend < keep) spend = bal - keep;
  if (spend <= 0n) throw new Error("nothing to spend");
  const quote: bigint = await router.buy.staticCall(coinAddr, "0x", 0, ethers.ZeroAddress, { value: spend });
  const minOut = (quote * 97n) / 100n;
  const supplyBefore = await coin.totalSupply();
  const held = await coin.balanceOf(me.address);
  const rc2 = await (await router.buy(coinAddr, "0x", minOut, ethers.ZeroAddress, { value: spend, ...gasOpts })).wait();
  const got = (await coin.balanceOf(me.address)) - held;
  console.log(`bought ${f(got)} ${sym} for ${f(spend)} HYPE (quote ${f(quote)})  tx ${rc2!.hash}`);

  // 3. burn
  const rc3 = await (await coin.burn(got, gasOpts)).wait();
  const supplyAfter = await coin.totalSupply();
  console.log(`burned ${f(got)} ${sym}: supply ${f(supplyBefore)} -> ${f(supplyAfter)}  tx ${rc3!.hash}`);

  // 4. platform share to the fee recipient
  if (platform > 0n) {
    const rc4 = await (await factory.pushPlatformFees([coinAddr], gasOpts)).wait();
    console.log(`pushed ${f(platform)} HYPE platform share to ${await factory.feeRecipient()}  tx ${rc4!.hash}`);
  }
  console.log(`wallet now ${f(await ethers.provider.getBalance(me.address))} HYPE`);
}

main().catch((e) => { console.error(e); process.exit(1); });
