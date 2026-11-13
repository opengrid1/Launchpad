// GET /api/relay (the keeper, every minute from the Vercel cron): carries coins and their floor HYPE between Hypex's
// chains.
//  1. Every HypexBridge send not delivered yet: its signed Wormhole message (Wormholescan) is delivered on the
//     receiving chain with the floor HYPE it took along, paid from the keeper's HYPE there (receiveMessage), so the
//     newcomers are carried by the floor at once.
//  2. The floor HYPE that left a chain's floors (HypexBridge.floorOut) is released to the keeper there.
//  3. The keeper's HYPE is rebalanced between the chains through Relay when one side runs low.
// The keeper key is HYPEX_KEEPER_KEY (never logged). A request from anyone but the cron (CRON_SECRET) only reports.
const X = require('./_hx');
const { ethers, NETS, rpc, multicall, I } = X;
const ST = require('./state');

const WHSCAN = 'https://api.wormholescan.io/api/v1/vaas';
const RELAY = 'https://api.relay.link';
const GAS_RESERVE = ethers.parseEther('0.05'); // what the keeper keeps for gas on each chain
const MIN_FLOAT = ethers.parseEther(process.env.HYPEX_KEEPER_MIN_FLOAT || '0.5'); // rebalance below this
const pad = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

function vaaHash(vaa) {
  // VAA v1: version(1) guardianSetIndex(4) numSigs(1) sigs(66 each) body; hash = keccak256(keccak256(body))
  const n = vaa[5], body = vaa.subarray(6 + n * 66);
  return ethers.keccak256(ethers.keccak256(body));
}
async function fetchVaa(N, seq) {
  const r = await fetch(`${WHSCAN}/${N.whChain}/${pad(N.bridge)}/${seq}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json(); const b64 = j && j.data && j.data.vaa; return b64 ? Buffer.from(b64, 'base64') : null;
}
const walletOn = (N) => new ethers.Wallet(process.env.HYPEX_KEEPER_KEY, new ethers.JsonRpcProvider(N.rpcs[0], N.chainId, { staticNetwork: true }));

async function relayHype(from, to, amount, wallet) {
  const q = await (await fetch(`${RELAY}/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: wallet.address, recipient: wallet.address, originChainId: from.chainId, destinationChainId: to.chainId, originCurrency: ethers.ZeroAddress, destinationCurrency: ethers.ZeroAddress, tradeType: 'EXACT_INPUT', amount: amount.toString() }), signal: AbortSignal.timeout(10000) })).json();
  if (!q || !Array.isArray(q.steps)) throw new Error('Relay quote: ' + ((q && q.message) || 'no steps'));
  const hashes = [];
  for (const step of q.steps) for (const it of step.items || []) {
    const d = it.data; if (!d || !d.to) continue;
    if (Number(d.chainId) !== from.chainId) throw new Error('Relay step on an unexpected chain');
    const tx = await wallet.sendTransaction({ to: d.to, data: d.data || '0x', value: BigInt(d.value || 0) });
    await tx.wait(1, 90000); hashes.push(tx.hash);
  }
  return hashes;
}

module.exports = async (req, res) => {
  const cron = process.env.CRON_SECRET && (req.headers.authorization || '') === `Bearer ${process.env.CRON_SECRET}`;
  const act = cron && !!process.env.HYPEX_KEEPER_KEY;
  const out = { act, delivered: [], waiting: [], released: [], rebalanced: [], errors: [] };
  try {
    const nets = Object.values(NETS).filter((n) => n.live);
    if (nets.length < 2) return X.json(res, 200, { ...out, note: 'both chains must be live' });
    // every send from each chain, from the indexer's logs
    for (const N of nets) { const S = ST.stateOf(N); await ST.sync(N, S, Date.now() + 15000); }
    for (const A of nets) {
      const S = ST.stateOf(A), sends = S.br.filter((l) => l.topics[0] === I.bridge.getEvent('Sent').topicHash);
      for (const l of sends) {
        const p = I.bridge.parseLog(l), B = X.netByWh(p.args.toChain); if (!B || !B.live) continue;
        const id = `${A.key}:${p.args.sequence}`;
        try {
          const vaa = await fetchVaa(A, p.args.sequence.toString());
          if (!vaa) { out.waiting.push({ id, why: 'guardians have not signed it yet' }); continue; }
          const [done] = await multicall(B, [[B.bridge, I.bridge, 'consumed', [vaaHash(vaa)]]]);
          if (done) continue;
          if (!act) { out.waiting.push({ id, why: 'ready to deliver' }); continue; }
          const w = walletOn(B), bal = await w.provider.getBalance(w.address), hype = p.args.floorHype;
          // the floor HYPE from the keeper's float; if the float is short, the coins go now and the floor is paid later
          const value = bal > GAS_RESERVE + hype ? hype : 0n;
          const tx = await w.sendTransaction({ to: B.bridge, data: I.bridge.encodeFunctionData('receiveMessage', [vaa]), value, gasLimit: 2_500_000n });
          await tx.wait(1, 90000); out.delivered.push({ id, to: B.key, tx: tx.hash, floorPaid: ethers.formatEther(value) });
        } catch (e) { out.errors.push({ id, error: e.shortMessage || e.message }); }
      }
    }
    if (act) {
      // the floor HYPE that left each chain's floors back into the keeper's float there
      for (const N of nets) {
        try {
          const [fo] = await multicall(N, [[N.bridge, I.bridge, 'floorOut']]);
          if (fo && fo > 0n) { const w = walletOn(N); const tx = await w.sendTransaction({ to: N.bridge, data: I.bridge.encodeFunctionData('releaseFloor', [w.address, fo]) }); await tx.wait(1, 90000); out.released.push({ chain: N.key, hype: ethers.formatEther(fo), tx: tx.hash }); }
        } catch (e) { out.errors.push({ chain: N.key, error: e.shortMessage || e.message }); }
      }
      // rebalance: a side under MIN_FLOAT gets half the other side's surplus over it, through Relay
      const [a, b] = nets, wa = walletOn(a), wb = walletOn(b);
      const [ba, bb] = await Promise.all([wa.provider.getBalance(wa.address), wb.provider.getBalance(wb.address)]);
      const plan = ba < MIN_FLOAT && bb > MIN_FLOAT * 2n ? [b, a, (bb - MIN_FLOAT) / 2n, wb] : bb < MIN_FLOAT && ba > MIN_FLOAT * 2n ? [a, b, (ba - MIN_FLOAT) / 2n, wa] : null;
      if (plan) { try { out.rebalanced.push({ from: plan[0].key, to: plan[1].key, hype: ethers.formatEther(plan[2]), txs: await relayHype(plan[0], plan[1], plan[2], plan[3]) }); } catch (e) { out.errors.push({ rebalance: e.message }); } }
    }
    X.json(res, 200, out);
  } catch (e) { X.json(res, 500, { ...out, error: e.message }); }
};
