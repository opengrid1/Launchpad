// Shared by the API functions: the LiquidFi deployments per chain, a JSON-RPC client that rides out public RPC rate
// limits, Multicall3 reads, and sending signed transactions (Elysium: straight to its inbox on HyperEVM, since the
// public RPC relay refuses big transactions and is often busy; HyperEVM: to its RPC). Env overrides exist for the
// local test chain (they apply to the Elysium entry).
const { ethers } = require('ethers');

const E = process.env;
const NETS = {
  elysium: {
    key: 'elysium', name: 'Elysium',
    rpc: E.ELYSIUM_RPC || 'https://rpc-live.elysp.com',
    chainId: Number(E.ELYSIUM_CHAIN_ID || 99901),
    factory: E.LQF_FACTORY || '0x13757D66782ecA93A86A2A8B6cEEc74f10322b05',
    hook: E.LQF_HOOK || '0xAA13d56014297e31d799D05406dA55F4c9256044',
    locker: E.LQF_LOCKER || '0x4DFB13BC1264f7bcA5Ed464E338C1A5ADC47C5d0',
    escrow: E.LQF_ESCROW || '0xb7C76c44e4fA523071cAD82E5865Bdf133097b38',
    vault: E.LQF_VAULT || '0xfC15Ecc412ACDd25d9Ba33389E53579eD328DfbC',
    poolManager: E.LQF_POOL_MANAGER || '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1',
    quoter: E.LQF_QUOTER || '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5',
    multicall: E.LQF_MULTICALL || '0xcA11bde05977b3631167028862bE2a173976CA11',
    fromBlock: Number(E.LQF_FROM_BLOCK || 311758), // the factory's deploy block
    maxRange: 0, maxChunks: 1, // eth_getLogs takes any range
    parent: E.DIRECT_SEND ? null : { rpc: E.HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm', chainId: 999, inbox: E.ELYSIUM_INBOX || '0xce59f8b65ad41c9dae4c07a0571a39824bd92cff' },
  },
  hyperevm: {
    key: 'hyperevm', name: 'HyperEVM',
    rpc: E.HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm',
    chainId: 999,
    factory: '0xC875D815044Ef2bBD4E286e2DbB54AF9a98Ba8A0',
    hook: '0xBAF9961BA462Abee6d4F86D9509C0BDd15f9A044',
    locker: '0x2e2804A111bCe151aA097a5376b44cBABfEc5D2b',
    escrow: '0x4f1e73B94B43B0EC7Da292dF9CC333bB863CF9b2',
    vault: '0x789Add57A12b92DEC1a2D1C9dc62360d42Be6051',
    poolManager: '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F',
    quoter: '0x108Bfe38532C98f8Cd8D7Ab49c9dDAa3675a1c5e',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
    fromBlock: 50356087,
    // logs come from an RPC without the official endpoint's 1,000-block cap (and with blockTimestamp); if it fails, the
    // official one is read in 1,000-block pages
    logRpc: E.HYPEREVM_LOG_RPC || 'https://rpc.hyperlend.finance', fallbackRange: 1000,
    maxRange: 200000, maxChunks: 10,
    parent: null,
  },
  // Ethereum mainnet (the BuzzPad brand): Uniswap's v4 deployment; the stack's addresses come from the env until deployed
  ethereum: {
    key: 'ethereum', name: 'Ethereum',
    rpc: E.ETH_RPC || 'https://ethereum-rpc.publicnode.com',
    chainId: 1,
    factory: E.ETH_FACTORY || '',
    hook: E.ETH_HOOK || '',
    locker: E.ETH_LOCKER || '',
    escrow: E.ETH_ESCROW || '',
    vault: E.ETH_VAULT || '',
    poolManager: '0x000000000004444c5dc75cB358380D2e3dE08A90',
    quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203',
    multicall: '0xcA11bde05977b3631167028862bE2a173976CA11',
    fromBlock: Number(E.ETH_FROM_BLOCK || 0),
    logRpc: E.ETH_LOG_RPC || '', fallbackRange: 1000,
    maxRange: 50000, maxChunks: 10,
    minSweep: '0.0005', // ETH: a sweep costs real gas on mainnet
    parent: null,
    // BuzzPad v2 (pairs ETH, AZTEC, WXMR; fees paid out in the pair): deployments/buzzpad-v2-ethereum.json
    v2: E.ETH_V2_FACTORY === '' ? null : {
      factory: E.ETH_V2_FACTORY || '0xE1fAd7b84dE65B5A0cfaae1B9EEC2569C97e88B0',
      hook: E.ETH_V2_HOOK || '0x17e71CE8fb92C94C768A4408ef9fC655d0e4a0CC',
      locker: E.ETH_V2_LOCKER || '0xFb02f7E461Cfb04E1614A0a1D86dF26E39cfE045',
      fromBlock: Number(E.ETH_V2_FROM_BLOCK || 0),
    },
    // the ERC-20 pairs and the pools that price them in ETH
    pairs: {
      '0xa27ec0006e59f245217ff08cd52a7e8b169e62d2': { sym: 'AZTEC', route: 'v4', key: ['0x0000000000000000000000000000000000000000', '0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2', 500, 10, '0xd53006d1e3110fD319a79AEEc4c527a0d265E080'] },
      '0x465e07d6028830124be2e4aa551fbe12805db0f5': { sym: 'XMR', route: 'v2', v2pair: '0x14C10b4BDcCD9d3F8940Fb79E0eE00121391D6dE', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
    },
  },
};
for (const k of Object.keys(NETS)) if (!NETS[k].factory) delete NETS[k]; // not deployed (yet)
if (E.LQF_ONLY) for (const k of Object.keys(NETS)) if (!E.LQF_ONLY.split(',').includes(k)) delete NETS[k]; // tests: one chain
const netOf = (key) => NETS[key] || null;
const defaultNet = () => Object.keys(NETS)[0] || 'elysium';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rid = 0;
async function rpc(net, method, params, tries = 6) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(net.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => null);
      if (j && !j.error) return j.result;
      last = (j && j.error && j.error.message) || 'HTTP ' + r.status;
      if (j && j.error && !/rate|limit|busy|not ready|timed out|unavailable/i.test(last)) throw new Error(last);
    } catch (e) { last = e.message; if (!/rate|limit|busy|not ready|timed out|unavailable|fetch|abort|HTTP/i.test(last)) throw e; }
    await sleep(Math.min(6000, 500 * 2 ** i) + Math.random() * 300);
  }
  throw new Error(net.name + ' RPC unavailable: ' + last);
}

const MC = new ethers.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
// calls: [address, Interface, fn, args]; returns decoded results (single values unwrapped), null for a failed call
async function multicall(net, calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 150) {
    const part = calls.slice(i, i + 150);
    const data = MC.encodeFunctionData('aggregate3', [part.map(([t, I, f, a]) => [t, true, I.encodeFunctionData(f, a || [])])]);
    const [res] = MC.decodeFunctionResult('aggregate3', await rpc(net, 'eth_call', [{ to: net.multicall, data }, 'latest']));
    res.forEach(([ok, rd], k) => { if (!ok) return out.push(null); try { const r = part[k][1].decodeFunctionResult(part[k][2], rd); out.push(r.length === 1 ? r[0] : r); } catch { out.push(null); } });
  }
  return out;
}

// Sends a transaction from `wallet` on `net` and waits for its receipt. Elysium transactions are posted to its HyperEVM
// inbox (message kind 4), paid from the same address on HyperEVM.
async function sendTx(net, wallet, tx) {
  const L = new ethers.JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true, batchMaxCount: 1 });
  if (!net.parent) { const fee = await L.getFeeData(); const t = await wallet.connect(L).sendTransaction({ maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n, ...tx }); const r = await t.wait(); return { hash: t.hash, status: r.status, gasUsed: Number(r.gasUsed) }; }
  const H = new ethers.JsonRpcProvider(net.parent.rpc, net.parent.chainId, { staticNetwork: true });
  const nonce = parseInt(await rpc(net, 'eth_getTransactionCount', [wallet.address, 'latest']), 16);
  const raw = await wallet.signTransaction({ type: 2, chainId: BigInt(net.chainId), nonce, maxFeePerGas: ethers.parseUnits('0.3', 'gwei'), maxPriorityFeePerGas: 0n, value: 0n, ...tx });
  const hash = ethers.keccak256(raw);
  const data = new ethers.Interface(['function sendL2Message(bytes)']).encodeFunctionData('sendL2Message', ['0x04' + raw.slice(2)]);
  const p = await wallet.connect(H).sendTransaction({ to: net.parent.inbox, data, gasLimit: 250000n }); await p.wait();
  for (let i = 0; i < 60; i++) { await sleep(3000); const r = await rpc(net, 'eth_getTransactionReceipt', [hash]).catch(() => null); if (r) return { hash, parent: p.hash, status: parseInt(r.status, 16), gasUsed: parseInt(r.gasUsed, 16) }; }
  return { hash, parent: p.hash, status: null };
}

module.exports = { ethers, NETS, netOf, defaultNet, rpc, multicall, sendTx, sleep };
