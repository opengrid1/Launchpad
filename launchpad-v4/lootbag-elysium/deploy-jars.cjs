// Deploys a fresh Jars contract (KinetiqPumpBags) on Elysium and ties it to the official coin. The first Jars
// contract had its coin set to the withdrawn KNTQ-paired $KPUMP, and a Jars contract's coin can be set only once.
// The new one gets the same settings: KNTQ mint price, the swapper, the treasury, the day list, the keeper. It is
// then offered to the owner wallet, who accepts it and points the fee hook's Jar share at it (admin page).
//   node deploy-jars.cjs            dry run
//   node deploy-jars.cjs --send
// The creation is too large for Elysium's public RPC, so it is posted to the rollup's Inbox on HyperEVM (the deployer
// needs a little HYPE there). Steps done are kept in deployments/jars-2.progress.json, so a run can be repeated.
const fs = require('fs'), path = require('path');
const { ethers } = require(path.join(__dirname, '../node_modules/ethers'));
const DEP = path.join(__dirname, 'deployments'), REC = path.join(DEP, 'kinetiqpump-elysium.json'), PROG = path.join(DEP, 'jars-2.progress.json');
const dep = JSON.parse(fs.readFileSync(REC, 'utf8')), official = JSON.parse(fs.readFileSync(path.join(DEP, 'kpump-official.json'), 'utf8'));
const art = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/KinetiqPumpBags.sol/KinetiqPumpBags.json'), 'utf8'));
const SEND = process.argv.includes('--send'), I = new ethers.Interface(art.abi), AC = ethers.AbiCoder.defaultAbiCoder();
const PARENT = { rpc: 'https://rpc.hyperliquid.xyz/evm', chainId: 999, inbox: '0xce59f8b65ad41c9dae4c07a0571a39824bd92cff' };
const RATE = /invalid block height|rate.?limit|429|too many|-32005|not ready|timeout|ECONNRESET|socket hang up|50[234]|missing response/i;
class RetryProvider extends ethers.JsonRpcProvider {
  async send(method, params) {
    for (let i = 0; ; i++) {
      try { return await super.send(method, params); } catch (e) {
        const msg = (e.shortMessage || '') + ' ' + (e.message || '') + ' ' + JSON.stringify(e.error || e.info || '');
        if (method === 'eth_sendRawTransaction' && i > 0 && /already known|nonce too low|known transaction/i.test(msg)) return ethers.keccak256(params[0]);
        if (i >= 8 || !RATE.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(i, 4)));
      }
    }
  }
}
(async () => {
  const P = new RetryProvider('https://rpc.elysium.kinetiq.xyz', 99901, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  const keyFile = process.env.KEYFILE || path.join(__dirname, '.env.deployer.kinetiqpump');
  const m = fs.readFileSync(keyFile, 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
  if (!m) throw new Error('no PRIVATE_KEY=... in ' + keyFile);
  const w = new ethers.Wallet('0x' + m[2]), me = w.address;
  const old = new ethers.Contract(dep.contracts.bags, art.abi, P);
  // the first Jars contract's own settings, read back from the chain
  const [kntq, swapper, treasury, mintKntq, days, minted, oldLoot] = await Promise.all([old.kntq(), old.swapper(), old.treasury(), old.MINT_KNTQ(), old.dayTokens(), old.minted(), old.loot()]);
  console.log(`${SEND ? '' : 'DRY RUN. '}deployer ${me}, ${ethers.formatEther(await P.getBalance(me))} HYPE on Elysium`);
  console.log(`first Jars ${dep.contracts.bags}: ${minted} minted, coin ${oldLoot}`);
  console.log(`new Jars: mint ${ethers.formatEther(mintKntq)} KNTQ, days ${days.join(', ')}, treasury ${treasury}, keeper ${dep.keeper}, coin ${official.coin} ($${official.symbol} paired with ${official.pair})`);
  if (minted !== 0n) throw new Error('Jars have been minted on the first contract: replacing it would strand them');
  if (oldLoot.toLowerCase() === official.coin.toLowerCase()) throw new Error('the first Jars contract already has the official coin: nothing to replace');
  const create = art.bytecode.object + AC.encode(['address', 'address', 'address', 'address', 'address[]', 'uint256'], [kntq, swapper, me, treasury, [...days], mintKntq]).slice(2);
  console.log(`creation: ${create.length / 2 - 1} bytes`);
  if (!SEND) return console.log('Add --send to deploy.');

  const prog = fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG, 'utf8')) : { steps: {} };
  const save = () => fs.writeFileSync(PROG, JSON.stringify(prog, null, 1));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const receiptOf = async (hash) => { try { return await P.send('eth_getTransactionReceipt', [hash]); } catch { return null; } };
  const fee = await P.getFeeData(), maxFeePerGas = (fee.maxFeePerGas ?? fee.gasPrice) * 2n, maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
  let parentW = null;
  async function postToInbox(raw) {
    if (!parentW) parentW = new ethers.Wallet(w.privateKey, new RetryProvider(PARENT.rpc, PARENT.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 }));
    const data = new ethers.Interface(['function sendL2Message(bytes messageData) returns (uint256)']).encodeFunctionData('sendL2Message', ['0x04' + raw.slice(2)]);
    const gas = await parentW.estimateGas({ to: PARENT.inbox, data });
    const t = await parentW.sendTransaction({ to: PARENT.inbox, data, gasLimit: (gas * 13n) / 10n });
    const r = await t.wait();
    if (r.status !== 1) throw new Error('inbox post reverted ' + t.hash);
    return t.hash;
  }
  async function step(name, req, fallbackGas) {
    let rec = prog.steps[name];
    if (rec && rec.done) return rec;
    if (!rec) {
      const est = await P.estimateGas({ from: me, ...req }).catch((e) => { const s = (e.shortMessage || '') + ' ' + (e.message || ''); if (RATE.test(s)) return fallbackGas; throw new Error(name + ': ' + (e.shortMessage || e.message)); });
      const used = Object.values(prog.steps).map((s) => s.nonce);
      const nonce = Math.max(await P.getTransactionCount(me, 'latest'), used.length ? Math.max(...used) + 1 : 0);
      const raw = await w.signTransaction({ type: 2, chainId: 99901, nonce, gasLimit: (est * 13n) / 10n + 200_000n, maxFeePerGas, maxPriorityFeePerGas, to: req.to ?? null, data: req.data, value: 0n });
      rec = prog.steps[name] = { nonce, hash: ethers.keccak256(raw), raw, address: req.to ? null : ethers.getCreateAddress({ from: me, nonce }) };
      save();
    }
    for (let round = 0; round < 40; round++) {
      let r = await receiptOf(rec.hash);
      if (!r) {
        let viaParent = rec.raw.length > 2 * 6000;
        if (!viaParent) {
          try { await P.send('eth_sendRawTransaction', [rec.raw]); } catch (e) {
            const s = (e.shortMessage || '') + ' ' + JSON.stringify(e.error || e.info || '');
            if (/exceeds cap/i.test(s)) viaParent = true;
            else if (!/already known|known transaction|nonce too low/i.test(s)) console.log(`  ${name}: send not confirmed (${s.replace(/\s+/g, ' ').slice(0, 120)}), checking`);
          }
        }
        if (viaParent && (!rec.parentHash || round - (rec.parentRound ?? 0) >= 5)) { rec.parentHash = await postToInbox(rec.raw); rec.parentRound = round; save(); console.log(`  ${name}: posted to the HyperEVM inbox in ${rec.parentHash}`); }
        for (let i = 0; i < 20 && !r; i++) { await sleep(3000); r = await receiptOf(rec.hash); }
      }
      if (r) {
        if (Number(r.status) !== 1) throw new Error(`${name} reverted in ${rec.hash}`);
        rec.done = true; rec.block = Number(r.blockNumber); rec.gas = Number(r.gasUsed); delete rec.raw;
        if (r.contractAddress) rec.address = ethers.getAddress(r.contractAddress);
        save(); console.log(`  ${name.padEnd(18)} ${rec.address || 'ok'}  ${rec.gas} gas`);
        return rec;
      }
    }
    throw new Error(`${name}: no receipt for ${rec.hash} after many tries; run again to keep re-sending it`);
  }
  const bags = (await step('KinetiqPumpBags', { data: create }, 2_300_000n)).address;
  const call = (name, fn, args) => step(name, { to: bags, data: I.encodeFunctionData(fn, args) }, 230_000n);
  await call('setKeeper', 'setKeeper', [dep.keeper, true]);
  await call('setLoot', 'setLoot', [official.coin]);
  await call('offer', 'transferOwnership', [dep.owner]);

  // the record: the new Jars take the place of the first, which is kept under `replaced`
  dep.replaced = { ...(dep.replaced || {}), bags: { address: dep.contracts.bags, why: 'its coin was set to the withdrawn KNTQ-paired $KPUMP, and that can be set only once; nothing was minted on it' } };
  dep.contracts.bags = bags;
  dep.officialCoin = official.coin;
  dep.toDoByOwner = ['acceptOwnership() on the new Jars contract', `hook.setWallets(${bags}, airdrop pot, treasury): until then the Jar share of fees still goes to the first Jars contract`];
  fs.writeFileSync(REC, JSON.stringify(dep, null, 1) + '\n');
  console.log(`done. New Jars ${bags}, coin set, offered to ${dep.owner}. Record updated.`);
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
