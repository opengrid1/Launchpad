/* eslint-disable no-console */
// Lists backing tokens on the Etherhook oracle as the admin: USDT (Chainlink feed), the Ondo
// stocks that have a Chainlink feed, and every other Ondo stock at the price in backing.json.
// Reads the oracle first and only sends what is missing (or a set price that drifted >2%),
// so a rerun picks up where it stopped. Sends in waves of WAVE transactions, then waits.
//   mainnet: DEPLOYER_ENV=.env.backstop-admin GAS_PRICE_GWEI=0.32 npx hardhat --config hardhat.config.backstop.ts run scripts/list-ondo-backstop.ts --network mainnet
//   fork:    FORK=1 npx hardhat --config hardhat.config.backstop.ts run scripts/list-ondo-backstop.ts   (impersonates the admin)
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const DEP = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "eth-backstop.json"), "utf8"));
const BACKING = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "web", "backstop", "site", "backing.json"), "utf8"));
const WAVE = Number(process.env.WAVE ?? 40);
const DRIFT = 0.02;
const usd8 = (v: number) => BigInt(Math.round(v * 1e8));

async function main() {
  let admin;
  if (network.name === "hardhat") {
    await network.provider.send("hardhat_impersonateAccount", [DEP.admin]);
    await network.provider.send("hardhat_setBalance", [DEP.admin, "0x" + ethers.parseEther("1").toString(16)]);
    admin = await ethers.getSigner(DEP.admin);
  } else {
    [admin] = await ethers.getSigners();
  }
  if (admin.address.toLowerCase() !== DEP.admin.toLowerCase()) throw new Error(`signer ${admin.address} is not the oracle admin ${DEP.admin}`);
  const oracle = await ethers.getContractAt("BackstopOracle", DEP.contracts.oracle, admin);
  const bal = await ethers.provider.getBalance(admin.address);
  console.log(`network ${network.name}, admin ${admin.address}, balance ${ethers.formatEther(bal)} ETH`);

  // what to send
  const jobs: { label: string; args: [string, boolean, bigint, string] }[] = [];
  const usdt = await oracle.listed(BACKING.usdt.address);
  if (!usdt.listed) jobs.push({ label: "USDT", args: [BACKING.usdt.address, true, 100_000_000n, BACKING.usdt.feed] });
  for (const t of BACKING.tokens) {
    const l = await oracle.listed(t.address);
    if (t.feed) {
      if (!(l.listed && l.feed.toLowerCase() === t.feed.toLowerCase())) jobs.push({ label: `${t.symbol} (Chainlink)`, args: [t.address, true, usd8(t.usd ?? t.feedUsd), t.feed] });
    } else if (t.usd) {
      const src = await oracle.sources(t.address);
      if (Number(src.dex) !== 0 && !l.listed) continue; // priced from its pool already
      const drift = l.listed && l.feed === ethers.ZeroAddress && Math.abs(Number(l.usdPrice8) / 1e8 - t.usd) / t.usd > DRIFT;
      if (!l.listed || drift) jobs.push({ label: `${t.symbol} $${t.usd}`, args: [t.address, true, usd8(t.usd), ethers.ZeroAddress] });
    }
  }
  console.log(`${jobs.length} listings to send`);
  if (!jobs.length) return;

  let nonce = await ethers.provider.getTransactionCount(admin.address, "pending");
  let sent = 0, gasUsed = 0n;
  for (let i = 0; i < jobs.length; i += WAVE) {
    const wave = jobs.slice(i, i + WAVE);
    const txs = [];
    for (const j of wave) txs.push(await oracle.setListed(...j.args, { nonce: nonce++, gasLimit: 80_000 }));
    for (const tx of txs) { const rc = await tx.wait(); gasUsed += rc!.gasUsed; }
    sent += wave.length;
    console.log(`  ${sent}/${jobs.length} listed (last: ${wave[wave.length - 1].label})`);
  }
  const after = await ethers.provider.getBalance(admin.address);
  console.log(`done: ${sent} listings, ${gasUsed} gas, spent ${ethers.formatEther(bal - after)} ETH`);
}
main().catch((e) => { console.error(e.shortMessage ?? e.message); process.exit(1); });
