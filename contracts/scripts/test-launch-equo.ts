// Mainnet smoke test: launch one coin through the deployed factory, then a small buy and a sell through
// the router, and print what the hook recorded (fee, 70/30 split, cashback).
//   EQUO_CONFIRM_TEST=1 npx hardhat run scripts/test-launch-equo.ts --network <net>
// Optional: TEST_FIRST_BUY (native, default = the factory minimum), TEST_TRADE (native, default 0.0002),
// TEST_TOKEN (skip the launch and trade an existing coin).
import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  if (process.env.EQUO_CONFIRM_TEST !== "1") throw new Error("set EQUO_CONFIRM_TEST=1 to launch a real coin");
  const d = JSON.parse(readFileSync(join(__dirname, `../deployments/equo-${network.name}.json`), "utf8"));
  const [me] = await ethers.getSigners();
  const factory = await ethers.getContractAt("EquoFactory", d.contracts.factory);
  const router = await ethers.getContractAt("EquoRouter", d.contracts.router);
  const hook = await ethers.getContractAt("EquoHook", d.contracts.hook);
  const firstBuy = process.env.TEST_FIRST_BUY ? ethers.parseEther(process.env.TEST_FIRST_BUY) : await factory.minFirstBuy();
  const trade = ethers.parseEther(process.env.TEST_TRADE ?? "0.0002");
  console.log(`network ${network.name}, from ${me.address}, balance ${ethers.formatEther(await ethers.provider.getBalance(me.address))}`);

  const meta = { description: "Equo mainnet test coin. Not an investment.", image: "https://www.equo.fun/img/apple-touch-icon.png", website: "https://www.equo.fun" };
  const genes = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };
  const p = { name: "Equo Test", symbol: "EQTEST", metadataURI: JSON.stringify(meta), pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [], split: 1 };
  // each contract's events, read only from that contract's own logs
  const parseFrom = (c: any, addr: string) => (l: any) => {
    if (l.address.toLowerCase() !== addr.toLowerCase()) return null;
    try { return c.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; }
  };
  const parse = parseFrom(hook, d.contracts.hook);
  let token = process.env.TEST_TOKEN ?? "";
  if (!token) {
    const rc = await (await factory.launch(p, ethers.id(`equo-test-${Date.now()}`), "0x", "0x", { value: firstBuy })).wait();
    const launched = rc!.logs.map(parseFrom(factory, d.contracts.factory)).find((e: any) => e && e.name === "Launched") as any;
    token = launched.args.token as string;
    console.log(`launched ${token} in ${rc!.hash} (gas ${rc!.gasUsed})`);
  }
  const coin = await ethers.getContractAt("EquoToken", token);
  console.log(`  holds ${ethers.formatEther(await coin.balanceOf(me.address))} EQTEST`);

  // a buy and a sell through the router, in later blocks
  const c0 = await hook.creatorOwed(token), p0 = await hook.platformOwed(token);
  const brc = await (await router.buy(token, "0x", 0, { value: trade })).wait();
  const fee = brc!.logs.map(parse).find((e: any) => e && e.name === "FeeTaken") as any;
  const cb = brc!.logs.map(parse).find((e: any) => e && e.name === "CashbackCredited") as any;
  console.log(`buy ${brc!.hash}: fee ${ethers.formatEther(fee.args.fee)} at ${fee.args.bps} bps, cashback ${cb ? ethers.formatEther(cb.args.amount) : 0}`);
  const dc = (await hook.creatorOwed(token)) - c0, dp = (await hook.platformOwed(token)) - p0;
  console.log(`  creator +${ethers.formatEther(dc)}, platform +${ethers.formatEther(dp)} (creator share of creator+platform+cashback: ${Number((dc * 10000n) / (fee.args.fee as bigint)) / 100}%)`);
  const bal = await coin.balanceOf(me.address);
  await (await coin.approve(d.contracts.router, bal / 4n)).wait();
  const src = await (await router.sell(token, bal / 4n, "0x", 0)).wait();
  const sfee = src!.logs.map(parse).find((e: any) => e && e.name === "FeeTaken") as any;
  console.log(`sell ${src!.hash}: fee ${ethers.formatEther(sfee.args.fee)} at ${sfee.args.bps} bps`);
  console.log(`done. balance ${ethers.formatEther(await ethers.provider.getBalance(me.address))}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
