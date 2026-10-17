/* eslint-disable no-console */
// Mainnet smoke test of the private vault and the live relay: shield a small
// amount of ETH from the signer, then withdraw it back through the relay on
// estonks.fun (a real proof, verified on chain, gas paid by the relay).
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
//   AMOUNT_ETH=0.003 npx hardhat run scripts/smoke-vault.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

import { ETH, KIND, newKeys, partialOf, poseidonReady, prove, rand, Tree, type Note } from "../test/v4/private/notes";

const RELAY = process.env.RELAY ?? "https://www.estonks.fun/api/relay";
/** fetch with a few retries for flaky connections. */
async function get(url: string, init?: RequestInit): Promise<Response> {
  for (let i = 0; ; i++) {
    try { return await fetch(url, init); } catch (e) { if (i >= 4) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
  }
}

async function main() {
  await poseidonReady();
  const [me] = await ethers.getSigners();
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json"), "utf8"));
  const vault = await ethers.getContractAt("EstonksVault", dep.contracts.vault, me);
  const amount = ethers.parseEther(process.env.AMOUNT_ETH ?? "0.003");
  const info = await (await get(RELAY)).json();
  console.log("relay", info.relayer, "online", info.online, "| signer", me.address, ethers.formatEther(await ethers.provider.getBalance(me.address)));

  // Mirror the tree from the vault's events so far.
  const tree = new Tree();
  // Public RPCs can index logs a few seconds late: retry until the tree matches.
  const sync = async () => {
    for (let i = 0; i < 30; i++) {
      tree.leaves = [];
      const logs = await vault.queryFilter(vault.filters.Note(), dep.vaultDeployBlock);
      for (const l of logs as any[]) tree.leaves[Number(l.args.index)] = BigInt(l.args.commitment);
      if (tree.root() === (await vault.root())) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error("local tree does not match the vault");
  };

  // 1. Shield. The note's secret is saved first, so a crash never strands it.
  const SAVE = process.env.NOTE_FILE ?? path.join(__dirname, "..", ".smoke-note.json");
  const keys = newKeys();
  const blinding = rand();
  const idx = Number(await vault.nextIndex());
  fs.writeFileSync(SAVE, JSON.stringify({ sk: keys.sk.toString(), blinding: blinding.toString(), amount: amount.toString(), expectedIndex: idx }), { mode: 0o600 });
  const tx = await vault.deposit(ETH, amount, partialOf(keys.pk, blinding), ethers.hexlify(ethers.randomBytes(144)), { value: amount });
  await tx.wait();
  console.log("shielded", ethers.formatEther(amount), "ETH tx", tx.hash);
  await sync();
  const note: Note = { asset: 0n, amount, blinding, pk: keys.pk, index: idx };

  // 2. Withdraw it back through the relay.
  const fee = (BigInt(info.units["1"]) * BigInt(info.gasPrice) * BigInt(info.margin) * 130n) / 10_000n;
  const s = await prove(tree, {
    keys, asset: ETH, inputs: [note], outputs: [], publicOut: amount, partialOut: 0n,
    ext: { kind: KIND.withdraw, recipient: me.address, relayer: info.relayer, relayerFee: fee, coin: ethers.ZeroAddress, route: "0x", minOut: 0n },
    encrypted: [ethers.hexlify(ethers.randomBytes(144)), ethers.hexlify(ethers.randomBytes(144)), ethers.hexlify(ethers.randomBytes(144))],
  });
  const body = JSON.stringify({ proof: s.proof, pub: s.pub, ext: s.ext, encrypted: s.encrypted }, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  const before = await ethers.provider.getBalance(me.address);
  const r = await get(RELAY, { method: "POST", headers: { "content-type": "application/json" }, body });
  const j = await r.json();
  console.log("relay answer", r.status, JSON.stringify(j));
  if (!j.hash) throw new Error("relay refused");
  let rc = null as any; for (let i = 0; i < 80 && !rc; i++) { rc = await ethers.provider.getTransactionReceipt(j.hash); if (!rc) await new Promise((r) => setTimeout(r, 3000)); }
  console.log("withdraw tx", j.hash, "status", rc?.status, "gas", rc?.gasUsed.toString());
  console.log("received", ethers.formatEther((await ethers.provider.getBalance(me.address)) - before), "ETH (fee", ethers.formatEther(fee), ")");
  console.log("vault ETH liabilities", ethers.formatEther(await vault.liabilities(ETH)));
}

main().catch((e) => { console.error(e); process.exit(1); });
