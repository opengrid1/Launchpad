// Shared by the API functions: the LiquidFi addresses on Elysium, a JSON-RPC client that rides out the public RPC's
// rate limits, Multicall3 reads, and posting signed transactions straight to Elysium's inbox on HyperEVM (the public
// RPC's relay refuses big transactions and is often busy). Env overrides exist for the local test chain.
const { ethers } = require('ethers');

const E = process.env;
const NET = {
  rpc: E.ELYSIUM_RPC || 'https://rpc-live.elysp.com',
  chainId: Number(E.ELYSIUM_CHAIN_ID || 99901),
  factory: E.LQF_FACTORY || '0x13757D66782ecA93A86A2A8B6cEEc74f10322b05',
  hook: E.LQF_HOOK || '0xAA13d56014297e31d799D05406dA55F4c9256044',
  locker: E.LQF_LOCKER || '0x4DFB13BC1264f7bcA5Ed464E338C1A5ADC47C5d0',
  escrow: E.LQF_ESCROW || '0xb7C76c44e4fA523071cAD82E5865Bdf133097b38',
  vault: E.LQF_VAULT || '0xfC15Ecc412ACDd25d9Ba33389E53579eD328DfbC',
  poolManager: E.LQF_POOL_MANAGER || '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',
  multicall: E.LQF_MULTICALL || '0xcA11bde05977b3631167028862bE2a173976CA11',
  fromBlock: Number(E.LQF_FROM_BLOCK || 311758), // the factory's deploy block
  parent: { rpc: E.HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm', chainId: 999, inbox: E.ELYSIUM_INBOX || '0xce59f8b65ad41c9dae4c07a0571a39824bd92cff' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rid = 0;
async function rpc(method, params, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(NET.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => null);
      if (j && !j.error) return j.result;
      last = (j && j.error && j.error.message) || 'HTTP ' + r.status;
      if (j && j.error && !/rate|limit|busy|not ready|timed out|unavailable/i.test(last)) throw new Error(last);
    } catch (e) { last = e.message; if (!/rate|limit|busy|not ready|timed out|unavailable|fetch|abort|HTTP/i.test(last)) throw e; }
    await sleep(Math.min(6000, 500 * 2 ** i) + Math.random() * 300);
  }
  throw new Error('Elysium RPC unavailable: ' + last);
}

const MC = new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
// calls: [address, Interface, fn, args]; returns decoded results (single values unwrapped), null for a failed call
async function multicall(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 150) {
    const part = calls.slice(i, i + 150);
    const data = MC.encodeFunctionData('aggregate3', [part.map(([t, I, f, a]) => [t, true, I.encodeFunctionData(f, a || [])])]);
    const [res] = MC.decodeFunctionResult('aggregate3', await rpc('eth_call', [{ to: NET.multicall, data }, 'latest']));
    res.forEach(([ok, rd], k) => { if (!ok) return out.push(null); try { const r = part[k][1].decodeFunctionResult(part[k][2], rd); out.push(r.length === 1 ? r[0] : r); } catch { out.push(null); } });
  }
  return out;
}

async function getLogs(filter) { return rpc('eth_getLogs', [filter]); }

// Posts a transaction signed for Elysium to its HyperEVM inbox (message kind 4) and waits for the Elysium receipt.
async function sendViaInbox(wallet, tx) {
  const L = new ethers.JsonRpcProvider(NET.rpc, NET.chainId, { staticNetwork: true, batchMaxCount: 1 });
  if (E.DIRECT_SEND) { const t = await wallet.connect(L).sendTransaction(tx); const r = await t.wait(); return { hash: t.hash, status: r.status, gasUsed: Number(r.gasUsed) }; } // local test chain
  const H = new ethers.JsonRpcProvider(NET.parent.rpc, NET.parent.chainId, { staticNetwork: true });
  const nonce = parseInt(await rpc('eth_getTransactionCount', [wallet.address, 'latest']), 16);
  const raw = await wallet.signTransaction({ type: 2, chainId: BigInt(NET.chainId), nonce, maxFeePerGas: ethers.parseUnits('0.3', 'gwei'), maxPriorityFeePerGas: 0n, value: 0n, ...tx });
  const hash = ethers.keccak256(raw);
  const data = new ethers.Interface(['function sendL2Message(bytes)']).encodeFunctionData('sendL2Message', ['0x04' + raw.slice(2)]);
  const p = await wallet.connect(H).sendTransaction({ to: NET.parent.inbox, data, gasLimit: 250000n }); await p.wait();
  for (let i = 0; i < 60; i++) { await sleep(3000); const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null); if (r) return { hash, parent: p.hash, status: parseInt(r.status, 16), gasUsed: parseInt(r.gasUsed, 16) }; }
  return { hash, parent: p.hash, status: null };
}

module.exports = { ethers, NET, rpc, multicall, getLogs, sendViaInbox, sleep };
