/* Zappy app on Ethereum: live data from /api/state (every coin, its pool price, floor, holders, trades), quotes from
   Uniswap's V4 Quoter, buys and sells through the Universal Router (V4 swap, native ETH), launches through the factory
   with a start signed by /api/sign, logos and metadata through /api/upload and /api/meta. Wallets: any injected EIP-1193
   provider (EIP-6963 discovery). */
(function () {
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)], DPR = Math.min(2, devicePixelRatio || 1);
const X = window.ethers, AC = X.AbiCoder.defaultAbiCoder(), Q96 = 2 ** 96, ZERO = X.ZeroAddress, low = (a) => String(a || '').toLowerCase();
const CFG = {
  chainId: 1, chainHex: '0x1', explorer: 'https://etherscan.io',
  rpcs: ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io', 'https://rpc.flashbots.net'],
  factory: '0xeE2D9c1b5a5bb1B742746888956476FBF78097e5', hook: '0x0ccaD7b1035c7eDd95201ED8737dBC29eEA868eC',
  quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203', router: '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af', permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  spacing: 60, supply: 1e9, slippageBps: 300,
};
const I = {
  factory: new X.Interface(['function launch((string name,string ticker,string metadataURI,bytes32 salt,address quote,uint256 devBuyTokens,uint256 devBuyMaxCost,int24 tickStart,uint256 deadline,bytes signature,uint8 vestMonths) lp) payable returns (address token, bytes32 poolId)', 'function launchFeeEth() view returns (uint256)', 'function devBuyMax() view returns (uint256)', 'function launchesPaused() view returns (bool)', 'event TokenLaunched(address indexed token, bytes32 indexed poolId, address indexed creator, address quote, int24 tickStart, uint256 devBuyTokens, string name, string ticker, string metadataURI)',
    'error StartExpired()', 'error StartUsed()', 'error BadStartSignature()', 'error StartOutOfBand()', 'error FeeNotPaid()', 'error Paused()', 'error DevBuyTooBig()', 'error BadSalt()', 'error BadQuote()', 'error DevBuyTooExpensive()']),
  quoter: new X.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)']),
  router: new X.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable', 'error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)', 'error DeadlinePassed(uint256 deadline)', 'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)']),
  erc20: new X.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']),
  permit2: new X.Interface(['function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)', 'function approve(address token, address spender, uint160 amount, uint48 expiration)']),
  hook: new X.Interface(['error PartialFill()', 'error NeedGas()', 'error FloorBroken()', 'error UnknownPool()']),
};
const ERR = { V4TooLittleReceived: 'The price moved past your slippage. Try again.', DeadlinePassed: 'The transaction waited too long. Try again.', PartialFill: 'The pool cannot fill that much right now. Try a smaller amount.', NeedGas: 'Not enough gas was given. Try again.', StartExpired: 'The launch start expired. Try again.', StartUsed: 'That launch start was already used. Try again.', BadStartSignature: 'The launch start could not be verified. Try again.', StartOutOfBand: 'The start price is outside the allowed band right now.', FeeNotPaid: 'The launch fee was not covered.', Paused: 'Launches are paused right now.', DevBuyTooBig: 'The first buy is over 5% of the supply.', DevBuyTooExpensive: 'The first buy would cost more than expected. Try again.' };
let seed = 5; const rnd = () => ((seed = seed * 16807 % 2147483647) / 2147483647);
const toast = (t, ms = 3200) => { const e = $('#toast'); e.textContent = t; e.classList.add('on'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('on'), ms); };
const usd = (v) => !isFinite(v) ? '$0' : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : Math.abs(v) >= 1e3 ? '$' + (v / 1e3).toFixed(Math.abs(v) < 1e4 ? 2 : 1) + 'K' : '$' + v.toFixed(Math.abs(v) < 10 ? 2 : 0);
const num = (v) => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(v < 10 ? 2 : 0);
const ago = (s) => s < 60 ? Math.max(1, Math.floor(s)) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowTs = () => Math.floor(Date.now() / 1000) + (ST ? ST.skew || 0 : 0);

/* avatars: the coin's logo, or a soft gradient disc with its initial; traders: a muted disc with two initials, named
   from their address like the reference */
const PAL = [['#ffe27a', '#c98d00'], ['#8ad4ff', '#2b6cb0'], ['#ffb3c6', '#c2456b'], ['#a8f0cf', '#1f9e6a'], ['#d9c2ff', '#6b4fd1'], ['#ffcf8a', '#b35d12'], ['#d6dde2', '#5f6b72'], ['#ffe9a3', '#d9a500']];
const TPAL = [['#2a3540', '#1b2229'], ['#3a2f4a', '#24202e'], ['#2c3f3a', '#1c2825'], ['#45392a', '#2a231b'], ['#2f3a4d', '#1e2531'], ['#4a2f38', '#2c1f24']];
const hashOf = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 1e9; return h; };
const avatar = (a, b, txt, ink, size) => `<svg viewBox="0 0 100 100"><defs><linearGradient id="g${a.slice(1)}${b.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g${a.slice(1)}${b.slice(1)})"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-size="${size}" fill="${ink}">${esc(txt)}</text></svg>`;
const letter = (c) => (([a, b]) => avatar(a, b, (c.n || '?')[0].toUpperCase(), '#0b0d16', 48))(PAL[hashOf(c.addr) % PAL.length]);
const face = (c) => c.img ? `<img src="${esc(c.img)}" alt="" data-fb="${esc(letter(c))}" onerror="this.insertAdjacentHTML('afterend',this.dataset.fb);this.remove()">` : letter(c);
const ADJ = ['Calm', 'Vivid', 'Sharp', 'Witty', 'Bold', 'Steady', 'Cosmic', 'Patient', 'Golden', 'Solar', 'Silent', 'Brave', 'Gentle', 'Swift', 'Eager', 'Glad'], COL = ['Amber', 'Opal', 'Ruby', 'Teal', 'Ivory', 'Jade', 'Cobalt', 'Pearl', 'Maple', 'Ochre', 'Indigo', 'Copper', 'Lilac', 'Ash', 'Plum', 'Crimson'], ANI = ['Raven', 'Panda', 'Puma', 'Lynx', 'Hare', 'Otter', 'Wolf', 'Gecko', 'Owl', 'Pike', 'Ibis', 'Koi', 'Tapir', 'Finch', 'Husky', 'Trout'];
const trader = (w) => { if (!w) return 'Unknown'; const h = hashOf(w); return ADJ[h % 16] + COL[(h >> 4) % 16] + ANI[(h >> 8) % 16]; };
const tri = (w) => { const h = hashOf(w), [a, b] = TPAL[h % TPAL.length], n = trader(w); return avatar(a, b, n.replace(/[a-z]/g, '').slice(0, 2), '#d6dde2', 40); };
const ethsvg = '<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#1c2428"/><path d="M50 16v25l21 9.5zM50 16 29 50.5 50 41zM50 68.5v15.5l21-29.5zM50 84V68.5L29 54.5z" fill="#e7ecea" opacity=".95"/><path d="M50 41l21 9.5L50 60.5 29 50.5z" fill="#e7ecea" opacity=".6"/></svg>';
const VF = '<svg class="vf" viewBox="0 0 24 24"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" fill="currentColor"/><path d="m9 12 2 2 4-4" stroke="#1a1403" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HEART = '<svg class="mood" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" fill="currentColor"/></svg>';
const SPROUT = '<svg class="fl" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 20h10M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z"/></svg>';
const X_I = '<svg class="ico f" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const COPY_I = '<svg class="ico" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const GLOBE_I = '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/></svg>';
const SEND_I = '<svg class="ico send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
const GEAR_I = '<svg class="ico" viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
const WALLET_I = '<svg class="ico" viewBox="0 0 24 24"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>';
const SHARE_I = '<svg class="ico" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>';
const EXT_I = '<svg class="ico" style="width:14px;height:14px;display:inline" viewBox="0 0 24 24"><path d="M15 3h6v6M21 3l-9 9M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const DOWN_I = '<svg class="ico" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>', CLOSE_I = '<svg class="ico" style="width:16px;height:16px" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>', BACK_I = '<svg class="ico" style="width:14px;height:14px" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';
const tok = (av, label, bare) => `<span class="tok${bare ? ' bare' : ''}"><span class="av">${av}<i></i></span>${label}${DOWN_I}</span>`;
const copyBtn = (text, size = 15) => `<button class="cp" data-copy="${esc(text)}" aria-label="Copy">${COPY_I.replace('class="ico"', `class="ico" style="width:${size}px;height:${size}px"`)}</button>`;

/* ---- RPC (reads) ---- */
let rid = 0, rcur = 0;
async function rpc(method, params, tries = 6) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    const url = CFG.rpcs[(rcur + i) % CFG.rpcs.length];
    try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) }); const j = await r.json().catch(() => null); if (j && !j.error) { rcur = (rcur + i) % CFG.rpcs.length; return j.result; } last = (j && j.error && j.error.message) || 'HTTP ' + r.status; if (j && j.error && !/rate|limit|busy|timed out|unavailable/i.test(last)) { const e = new Error(last); e.data = j.error.data; throw e; } }
    catch (e) { if (e.data !== undefined) throw e; last = e.message; }
    await new Promise((r) => setTimeout(r, Math.min(3000, 300 * 2 ** i)));
  }
  throw new Error('Ethereum RPC is busy, try again in a moment (' + last + ')');
}
const call = async (to, iface, fn, args, from) => iface.decodeFunctionResult(fn, await rpc('eth_call', [{ to, data: iface.encodeFunctionData(fn, args || []), ...(from ? { from } : {}) }, 'latest']));
function revertText(e) {
  const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
  const str = typeof d === 'string' ? d : (d && d.data) || '';
  if (typeof str === 'string' && str.length >= 10) {
    for (const f of Object.values(I)) { try { const p = f.parseError(str); if (p) { if (p.name === 'WrappedError') { for (const g of Object.values(I)) { try { const q = g.parseError(p.args.reason); if (q) return ERR[q.name] || q.name; } catch {} } return 'The pool refused the swap (' + p.args.selector + ')'; } return ERR[p.name] || p.name; } } catch {} }
  }
  const m = (e && (e.shortMessage || e.message)) || String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return 'You cancelled the transaction.';
  if (/insufficient funds/i.test(m)) return 'Not enough ETH for that plus gas.';
  return m.length > 160 ? m.slice(0, 160) + '…' : m;
}

/* ---- live state ---- */
let ST = null, COINS = [], BY = new Map(), TR = new Map(), ethUsd = 0, loading = null;
const pxAgo = (trs, s, p0) => { const cut = nowTs() - s; for (let i = trs.length - 1; i >= 0; i--) if (trs[i].ts <= cut) return trs[i].p; return p0; };
function view(t) {
  const trs = TR.get(t.addr) || [], n = nowTs(), p = t.p || t.p0, floorP = t.floorP || 0;
  let vol24 = 0; for (const x of trs) if (x.ts > n - 86400 && !x.bb) vol24 += x.eth * ethUsd;
  const ago24 = t.createdAt > n - 86400 ? t.p0 : pxAgo(trs, 86400, t.p0);
  const fl = t.raises || [], fAgo = fl.filter((r) => r.ts <= n - 86400).pop();
  const img = (t.meta && t.meta.image) || '';
  return { addr: t.addr, n: t.name, t: t.ticker, v: t.addr === low(ST.zappy), img, meta: t.meta || {}, creator: t.creator, createdAt: t.createdAt, age: Math.max(0, n - t.createdAt), tx: t.tx, poolId: t.poolId,
    p, pUsd: p * ethUsd, mc: p * ethUsd * t.supply, floor: floorP * ethUsd * t.supply, floorP, above: floorP > 0 ? p / floorP - 1 : 0, ch: ago24 > 0 ? (p / ago24 - 1) * 100 : 0, fch: fAgo && fAgo.p > 0 ? (floorP / fAgo.p - 1) * 100 : 0,
    vol: vol24, holders: t.holders || [], holderCount: t.holderCount || 0, supply: t.supply, circ: t.circulating, raises: fl, events: t.events || [], trades: trs, vesting: t.vesting || 0, tickStart: t.tickStart, p0: t.p0 };
}
function index() {
  ethUsd = ST.ethUsd || ethUsd; TR.clear(); BY.clear();
  for (const tr of ST.trades) (TR.get(tr.t) || TR.set(tr.t, []).get(tr.t)).push(tr);
  for (const a of TR.values()) a.sort((x, y) => x.ts - y.ts || x.blk - y.blk);
  COINS = ST.tokens.map(view); for (const c of COINS) BY.set(c.addr, c);
}
async function load(fresh) {
  if (loading) return loading;
  loading = (async () => { const r = await fetch('/api/state' + (fresh ? '?t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' }); const j = await r.json(); if (j.error) throw new Error(j.error); if (!ST || j.block >= ST.block || fresh) { ST = j; index(); } })().finally(() => { loading = null; });
  return loading;
}
const findCoin = (k) => { k = low(k); return BY.get(k) || COINS.find((c) => low(c.t) === k) || null; };

/* ---- wallet (EIP-1193, EIP-6963) ---- */
const W = { provider: null, address: '', eth: 0, found: new Map() };
addEventListener('eip6963:announceProvider', (e) => { const d = e.detail; W.found.set(low(d.info.rdns), d.provider); });
dispatchEvent(new Event('eip6963:requestProvider'));
const RDNS = { MetaMask: 'io.metamask', Coinbase: 'com.coinbase.wallet', Rainbow: 'me.rainbow', 'Trust Wallet': 'com.trustwallet.app', 'Rabby Wallet': 'io.rabby', Phantom: 'app.phantom', WalletConnect: '' };
// RainbowKit (rk/index.jsx, loaded as /rk/rk.js) owns connecting: it reports every change here, and the page keeps
// the wallet's EIP-1193 provider for sending transactions. The plain EIP-6963 path below is the fallback if it fails to load.
const RK = (window.RK = window.RK || { listeners: [] });
const rkReady = () => !!(RK.ready && RK.open);
RK.listeners.push(async (s) => {
  const was = W.address;
  if (!s.address || !s.provider) { if (was && W.viaRk) { W.provider = null; W.address = ''; W.viaRk = false; render(); } return; }
  W.provider = s.provider; W.address = X.getAddress(s.address); W.viaRk = true;
  if (s.chainId && s.chainId !== CFG.chainId) { toast('Switch the wallet to Ethereum mainnet'); try { await RK.switchChain(); } catch { } }
  await refreshMine(); render(); if (low(was) !== low(W.address)) toast('Connected ' + short(W.address));
});
async function connect(name) {
  let p = W.found.get(low(RDNS[name] || '')) || null;
  if (!p && name === 'WalletConnect') throw new Error('WalletConnect is not wired yet. Use a browser wallet.');
  if (!p) p = window.ethereum || [...W.found.values()][0];
  if (!p) throw new Error(name + ' was not found in this browser. Install it or open this page in its app.');
  const [addr] = await p.request({ method: 'eth_requestAccounts' });
  try { const cid = await p.request({ method: 'eth_chainId' }); if (cid !== CFG.chainHex) await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CFG.chainHex }] }); } catch (e) { throw new Error('Switch the wallet to Ethereum mainnet.'); }
  W.provider = p; W.address = X.getAddress(addr);
  p.on && p.on('accountsChanged', (a) => { W.address = a[0] ? X.getAddress(a[0]) : ''; if (!W.address) W.provider = null; refreshMine(); render(); });
  p.on && p.on('chainChanged', () => location.reload());
  await refreshMine(); render(); toast('Connected ' + short(W.address));
}
async function refreshMine() { if (!W.address) { W.eth = 0; return; } try { W.eth = Number(X.formatEther(await rpc('eth_getBalance', [W.address, 'latest']))); } catch {} }
async function myTokens(addr) { if (!W.address) return 0n; const [b] = await call(addr, I.erc20, 'balanceOf', [W.address]); return b; }
async function send(tx, label) {
  if (!W.provider) throw new Error('Connect a wallet to ' + label);
  const req = { from: W.address, to: tx.to, data: tx.data, value: tx.value ? '0x' + BigInt(tx.value).toString(16) : '0x0', gas: '0x' + BigInt(tx.gas || 600000).toString(16) };
  try { await rpc('eth_call', [{ from: req.from, to: req.to, data: req.data, value: req.value }, 'latest']); } catch (e) { if (e.data !== undefined) throw new Error(revertText(e)); }
  let hash; try { hash = await W.provider.request({ method: 'eth_sendTransaction', params: [req] }); } catch (e) { throw new Error(revertText(e)); }
  toast('Sent. Waiting for Ethereum…', 20000);
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) { const r = await rpc('eth_getTransactionReceipt', [hash], 3).catch(() => null); if (r) { if (parseInt(r.status, 16) !== 1) throw new Error('The transaction reverted. ' + CFG.explorer + '/tx/' + hash); return { hash, receipt: r }; } await new Promise((s) => setTimeout(s, 2500)); }
  throw new Error('Still waiting after 5 minutes: ' + CFG.explorer + '/tx/' + hash);
}
async function afterTx(blk) { for (let i = 0; i < 12; i++) { await load(true).catch(() => {}); if (!blk || (ST && ST.block >= blk)) break; await new Promise((s) => setTimeout(s, 2000)); } await refreshMine(); render(); }

/* ---- trading: quotes from the V4 Quoter, swaps through the Universal Router ---- */
const keyOf = (c) => [ZERO, X.getAddress(c.addr), 0, CFG.spacing, CFG.hook];
async function quote(c, buy, amountIn) {
  if (amountIn <= 0n) return 0n;
  try { const [out] = await call(CFG.quoter, I.quoter, 'quoteExactInputSingle', [[keyOf(c), buy, amountIn, '0x']]); return out; } catch (e) { throw new Error(revertText(e)); }
}
function v4Swap(c, buy, amountIn, minOut) {
  const key = keyOf(c), cur0 = ZERO, cur1 = X.getAddress(c.addr), actions = '0x060c0f'; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
  const params = [AC.encode(['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'], [[key, buy, amountIn, minOut, '0x']]), AC.encode(['address', 'uint256'], [buy ? cur0 : cur1, amountIn]), AC.encode(['address', 'uint256'], [buy ? cur1 : cur0, minOut])];
  return I.router.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], [actions, params])], BigInt(nowTs() + 900)]);
}
const minOf = (out) => (out * BigInt(10000 - CFG.slippageBps)) / 10000n;
async function buy(c, ethIn) {
  const amountIn = X.parseEther(ethIn.toFixed(12)); if (W.eth && ethIn > W.eth) throw new Error('Not enough ETH in the wallet');
  const out = await quote(c, true, amountIn);
  const r = await send({ to: CFG.router, data: v4Swap(c, true, amountIn, minOf(out)), value: amountIn, gas: 1600000 }, 'buy');
  await afterTx(parseInt(r.receipt.blockNumber, 16)); return r.hash;
}
async function sell(c, tokens) {
  const have = await myTokens(c.addr); let amount = X.parseEther(Math.floor(tokens * 1e6) / 1e6 + ''); if (amount > have || tokens >= Number(X.formatEther(have)) - 1e-6) amount = have; if (amount <= 0n) throw new Error('No tokens to sell');
  const me = W.address, [[allow], p2] = await Promise.all([call(c.addr, I.erc20, 'allowance', [me, CFG.permit2]), call(CFG.permit2, I.permit2, 'allowance', [me, c.addr, CFG.router])]);
  if (allow < amount) { toast('Approve the token for trading (once)', 6000); await send({ to: c.addr, data: I.erc20.encodeFunctionData('approve', [CFG.permit2, X.MaxUint256]), gas: 120000 }, 'approve'); }
  if (p2.amount < amount || Number(p2.expiration) < nowTs() + 120) { toast('Allow the swap router through Permit2 (once a month)', 6000); await send({ to: CFG.permit2, data: I.permit2.encodeFunctionData('approve', [c.addr, CFG.router, (1n << 160n) - 1n, BigInt(nowTs() + 30 * 86400)]), gas: 120000 }, 'approve'); }
  const out = await quote(c, false, amount);
  const r = await send({ to: CFG.router, data: v4Swap(c, false, amount, minOf(out)), gas: 1600000 }, 'sell');
  await afterTx(parseInt(r.receipt.blockNumber, 16)); return r.hash;
}

/* ---- launch: logo and metadata to the Blob store, the start signed by the server, then factory.launch ---- */
async function uploadLogo(dataUrl) {
  const img = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('Could not read the image')); im.src = dataUrl; });
  const s = Math.min(img.width, img.height), size = Math.min(512, s), cv = document.createElement('canvas'); cv.width = cv.height = size;
  cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  let data = cv.toDataURL('image/webp', 0.9); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/png');
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) }); const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j.error || 'Logo upload failed'); return j.url;
}
const MIN_TICK = -887220;
const sqrtAt = (tick) => BigInt(Math.round(Math.pow(1.0001, tick / 2) * 1e12)) * (1n << 96n) / 1000000000000n;
// what a first buy of `tokens` costs at launch: tranche 0 (35% of supply from the start price up) priced like the pool
// will, plus the base tax on the ETH leg, plus 3% slack
function devBuyCost(tokens, tickStart) {
  const sTop = sqrtAt(tickStart), sMin = sqrtAt(MIN_TICK), Q = 1n << 96n;
  const amt0 = X.parseEther('350000000'), L = (amt0 * Q) / (sTop - sMin);
  const sNew = sTop - (tokens * Q) / L; if (sNew <= 0n) throw new Error('First buy too large');
  const cost = (L * (sTop - sNew) * Q) / (sNew * sTop);
  return (cost * 1030n * 1000n) / (1000n * 975n);
}
async function launch(p) {
  if (!W.address) throw new Error('Connect a wallet to launch');
  const image = p.image ? await uploadLogo(p.image) : '';
  const mr = await fetch('/api/meta', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: p.name, ticker: p.ticker, description: p.desc, image, x: p.x, telegram: p.telegram, website: p.website }) });
  const mj = await mr.json().catch(() => ({})); if (!mr.ok || !mj.url) throw new Error(mj.error || 'Could not save the metadata');
  const salt = X.hexlify(X.randomBytes(32));
  const sr = await fetch('/api/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ creator: W.address, salt, name: p.name, ticker: p.ticker }) });
  const sj = await sr.json().catch(() => ({})); if (!sr.ok || !sj.signature) throw new Error(sj.error || 'Could not sign the launch start');
  const [[fee], [paused]] = await Promise.all([call(CFG.factory, I.factory, 'launchFeeEth'), call(CFG.factory, I.factory, 'launchesPaused')]);
  if (paused) throw new Error('Launches are paused right now');
  const devTokens = p.buyPct > 0 ? X.parseEther(String(Math.round(CFG.supply * p.buyPct / 100))) : 0n;
  const devCost = devTokens > 0n ? devBuyCost(devTokens, sj.tickStart) : 0n;
  const lp = { name: p.name, ticker: p.ticker, metadataURI: mj.url, salt, quote: ZERO, devBuyTokens: devTokens, devBuyMaxCost: devCost, tickStart: sj.tickStart, deadline: sj.deadline, signature: sj.signature, vestMonths: 0 };
  const r = await send({ to: CFG.factory, data: I.factory.encodeFunctionData('launch', [lp]), value: fee + devCost, gas: devTokens > 0n ? 3200000 : 2600000 }, 'launch');
  const lg = r.receipt.logs.map((l) => { try { return I.factory.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
  const addr = lg ? low(lg.args.token) : '';
  for (let i = 0; i < 15 && addr && !BY.has(addr); i++) { await load(true).catch(() => {}); if (!BY.has(addr)) await new Promise((s) => setTimeout(s, 2500)); }
  await refreshMine(); return { addr, hash: r.hash, fee: Number(X.formatEther(fee)) };
}

/* ---- derived views ---- */
function candles(c, step) {
  const trs = c.trades.filter((x) => !x.bb), out = []; let cur = null, last = c.p0 * ethUsd;
  const pts = [{ ts: c.createdAt, p: last, v: 0 }, ...trs.map((x) => ({ ts: x.ts, p: x.p * ethUsd, v: x.eth * ethUsd, big: x.b && x.eth * ethUsd >= 250 }))];
  for (const x of pts) { const b = Math.floor(x.ts / step) * step; if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: last, h: Math.max(last, x.p), l: Math.min(last, x.p), c: x.p, v: 0, big: 0 }; } cur.h = Math.max(cur.h, x.p); cur.l = Math.min(cur.l, x.p); cur.c = x.p; cur.v += x.v; if (x.big) cur.big++; last = x.p; }
  if (cur) out.push(cur);
  // carry the last close into the present so a quiet coin still shows a candle per step up to now
  const n = nowTs(); let t = out.length ? out[out.length - 1].t + step : Math.floor(c.createdAt / step) * step;
  while (t <= n && out.length < 400) { out.push({ t, o: last, h: last, l: last, c: last, v: 0, big: 0 }); t += step; }
  return out.slice(-120);
}
const floorAt = (c, ts) => { let p = 0; for (const r of c.raises) { if (r.ts > ts) break; p = r.p; } return (p || c.floorP) * ethUsd; };
function walletStats() { // every wallet's realized flow and holdings across coins, in USD at today's prices
  const m = new Map(), get = (w) => m.get(w) || m.set(w, { w, buys: 0, sells: 0, vol: 0, swaps: 0, held: 0, first: 0 }).get(w);
  for (const c of COINS) for (const x of c.trades) { if (x.bb || !x.w) continue; const s = get(x.w), u = x.eth * ethUsd; s.vol += u; s.swaps++; if (x.b) s.buys += u; else s.sells += u; if (!s.first || x.ts < s.first) s.first = x.ts; }
  for (const c of COINS) for (const [w, bal] of c.holders) { const s = get(w); s.held += bal * c.pUsd; }
  const list = [...m.values()].map((s) => ({ ...s, pnl: s.sells + s.held - s.buys })).sort((a, b) => b.pnl - a.pnl);
  return list;
}
function walletView(w) {
  w = low(w); const pos = [];
  for (const c of COINS) { const h = c.holders.find(([a]) => a === w); const mine = c.trades.filter((x) => x.w === w); const bought = mine.filter((x) => x.b).reduce((s, x) => s + x.eth * ethUsd, 0), sold = mine.filter((x) => !x.b).reduce((s, x) => s + x.eth * ethUsd, 0), tokIn = mine.filter((x) => x.b).reduce((s, x) => s + x.tok, 0);
    const bal = h ? h[1] : 0; if (bal > 0 || mine.length) pos.push({ c, bal, value: bal * c.pUsd, floorValue: bal * c.floorP * ethUsd, cost: bought, sold, pnl: sold + bal * c.pUsd - bought, avgEntry: tokIn > 0 ? (bought / tokIn) * c.supply : 0, open: bal > 0, trades: mine }); }
  const s = walletStats().find((x) => x.w === w) || { w, buys: 0, sells: 0, vol: 0, swaps: 0, held: 0, pnl: 0 };
  return { w, pos: pos.sort((a, b) => b.value - a.value), ...s, rank: walletStats().findIndex((x) => x.w === w) + 1 };
}

/* ---- ticker ---- */
function tickerHtml() {
  const items = [];
  for (const c of COINS) { for (const x of c.trades) if (!x.bb) items.push({ ts: x.ts, c, x }); items.push({ ts: c.createdAt, c, launch: true }); }
  items.sort((a, b) => b.ts - a.ts); const top = items.slice(0, 24);
  if (!top.length) return '';
  const h = top.map(({ c, x, launch }) => `<a class="chip" href="#/coin/${c.addr}"><span class="av">${tri(launch ? c.creator : x.w)}</span>${trader(launch ? c.creator : x.w)} <b class="${launch ? '' : x.b ? 'up' : 'dn'}">${launch ? 'launched' : (x.b ? 'bought ' : 'sold ') + usd(x.eth * ethUsd)}</b> ${launch ? '' : 'of '}<span class="av sm">${face(c)}</span><b>$${esc(c.t)}</b></a>`).join('');
  return h + h;
}

/* ---- list column ---- */
let sort = 'trending', cur = '';
const listHtml = () => {
  let L = COINS.slice(); if (sort === 'new') L.sort((a, b) => b.createdAt - a.createdAt); else if (sort === 'mcap') L.sort((a, b) => b.mc - a.mc); else if (sort === 'floor') L.sort((a, b) => a.above - b.above); else L.sort((a, b) => (b.v - a.v) || (b.vol - a.vol) || (b.createdAt - a.createdAt));
  const rows = L.map((c) => `<a class="row ${c.addr === cur ? 'on' : ''}" href="#/coin/${c.addr}"><span class="av">${face(c)}</span><span class="nm"><b>${esc(c.n)}${c.v ? VF : ''}<span>$${esc(c.t)}</span></b><small class="${c.above < .5 && c.trades.length ? 'up' : ''}">${c.above < .5 && c.trades.length ? SPROUT : ''}${ago(c.age)}</small></span><span class="rt"><b>${HEART}${usd(c.mc)}</b><small>${usd(c.floor)} floor</small></span></a>`).join('');
  return `<div class="pills" id="sort">${[['trending', 'Trending'], ['new', 'New'], ['mcap', 'Mcap'], ['floor', 'Floor']].map(([k, l]) => `<button data-s="${k}" class="${sort === k ? 'on' : ''}">${l}</button>`).join('')}</div><div class="rows">${rows || '<div class="grey" style="padding:24px 10px;font-size:13px">No launches yet. Be the first.</div>'}</div>`;
};

/* ---- chart ---- */
const STEP = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };
function drawChart(c, mode) {
  const cv = $('#chart'); if (!cv) return; const r = cv.getBoundingClientRect(); cv.width = r.width * DPR; cv.height = r.height * DPR; const x = cv.getContext('2d'), W = cv.width, H = cv.height;
  const step = STEP[tf] || 900, K0 = candles(c, step), mul = mode === 'price' ? 1 : c.supply, K = K0.map((k) => ({ ...k, o: k.o * mul, h: k.h * mul, l: k.l * mul, c: k.c * mul, f: floorAt(c, k.t + step - 1) * mul })), N = K.length;
  const mob = r.width < 520, fs = (mob ? 13 : 10.5) * DPR, tagH = (mob ? 26 : 18) * DPR, pad = (mob ? 80 : 66) * DPR, cw = W - pad, ax = (mob ? 24 : 18) * DPR, vb = H - ax, volH = H * .14;
  const lab = (v) => mode === 'price' ? '$' + (v >= 1 ? v.toFixed(2) : v.toPrecision(3)) : usd(v);
  const vals = K.flatMap((k) => [k.h, k.l, k.f]).filter((v) => v > 0), mn = Math.min(...vals) * .9, mx = Math.max(...vals) * 1.04 || 1;
  const Y = (v) => (vb - volH - 12 * DPR) - (v - mn) / (mx - mn) * (vb - volH - 30 * DPR), bw = cw / N, maxV = Math.max(1e-9, ...K.map((k) => k.v));
  x.font = `500 ${fs}px Geist,sans-serif`;
  const raw = (mx - mn) / 4, p10 = Math.pow(10, Math.floor(Math.log10(raw || 1))), stp = [1, 2, 2.5, 5, 10].map((m) => m * p10).find((s) => s >= raw) || raw;
  const last = K[N - 1], up = last.c >= last.o, ly = Y(last.c), fy = Y(last.f);
  x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = DPR;
  for (let v = Math.ceil(mn / stp) * stp; v < mx; v += stp) { const y = Y(v); x.beginPath(); x.moveTo(0, y); x.lineTo(cw, y); x.stroke(); if (Math.abs(y - ly) > tagH && Math.abs(y - fy) > tagH) { x.fillStyle = '#8a9396'; x.fillText(lab(v), cw + 10 * DPR, y + fs * .36); } }
  for (let g = 1; g < 6; g++) { x.beginPath(); x.moveTo(cw * g / 6, 0); x.lineTo(cw * g / 6, vb); x.stroke(); }
  x.save(); x.strokeStyle = '#d6dde2'; x.lineWidth = 1.3 * DPR; x.beginPath(); K.forEach((k, i) => { if (!(k.f > 0)) return; i ? x.lineTo(i * bw, Y(k.f)) : x.moveTo(0, Y(k.f)); x.lineTo((i + 1) * bw, Y(k.f)); }); x.stroke(); x.restore();
  K.forEach((k, i) => { const u = k.c >= k.o, col = u ? '#4ade80' : '#ff4f63', cx = i * bw + bw / 2; x.strokeStyle = col; x.lineWidth = DPR; x.beginPath(); x.moveTo(cx, Y(k.h)); x.lineTo(cx, Y(k.l)); x.stroke(); x.fillStyle = col; const y1 = Y(Math.max(k.o, k.c)), y2 = Y(Math.min(k.o, k.c)); x.fillRect(i * bw + bw * .28, y1, bw * .44, Math.max(DPR, y2 - y1)); if (k.v > 0) { x.globalAlpha = .5; const vh = (k.v / maxV) * volH; x.fillRect(i * bw + bw * .28, vb - vh, bw * .44, vh); x.globalAlpha = 1; } });
  const tag = (y, bg, fg, t) => { x.fillStyle = bg; x.beginPath(); x.roundRect(cw + 4 * DPR, y - tagH / 2, pad - 8 * DPR, tagH, tagH / 2); x.fill(); x.fillStyle = fg; x.fillText(t, cw + 12 * DPR, y + fs * .36); };
  x.save(); x.setLineDash([3 * DPR, 3 * DPR]); x.strokeStyle = up ? '#4ade80' : '#ff4f63'; x.lineWidth = DPR; x.beginPath(); x.moveTo(0, ly); x.lineTo(cw, ly); x.stroke(); x.restore();
  tag(ly, up ? '#4ade80' : '#ff4f63', up ? '#04150a' : '#1a0507', lab(last.c));
  // the floor tag steps aside when the price sits on it
  if (last.f > 0) { const ty = Math.abs(fy - ly) < tagH + 2 * DPR ? (fy >= ly ? ly + tagH + 2 * DPR : ly - tagH - 2 * DPR) : fy; x.fillStyle = '#b3bcbb'; x.fillText('Floor', cw - x.measureText('Floor').width - 6 * DPR, fy - 6 * DPR); tag(ty, '#20282c', '#e7ecea', lab(last.f)); }
  // big buys ($250 and up) as a flame under their candle
  const FP = new Path2D('M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'), mr = (mob ? 14 : 12) * DPR;
  K.forEach((k, i) => { if (!k.big) return; const px = i * bw + bw / 2, py = Y(k.l) + mr + 6 * DPR; x.fillStyle = '#1c2428'; x.strokeStyle = '#263034'; x.beginPath(); x.roundRect(px - mr, py - mr, mr * 2, mr * 2, mr); x.fill(); x.stroke(); x.save(); x.translate(px - mr * .575, py + DPR - mr * .575); x.scale(mr * 1.15 / 24, mr * 1.15 / 24); x.fillStyle = '#f97316'; x.fill(FP); x.restore(); });
  x.fillStyle = '#8a9396'; const nl = Math.max(3, Math.min(7, Math.floor(r.width / 120))); let prevLab = '';
  for (let i = 0; i < nl; i++) { const k = K[Math.round(i * (N - 1) / (nl - 1))], d = new Date(k.t * 1000), s = step >= 86400 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); if (s === prevLab) continue; prevLab = s; x.fillText(s, (i + .5) / nl * cw - x.measureText(s).width / 2, H - 6 * DPR); }
  const el = $('#ohlc-v'); if (el) el.innerHTML = `<span>O <b>${lab(last.o)}</b></span><span>H <b>${lab(last.h)}</b></span><span>L <b>${lab(last.l)}</b></span><span>C <b>${lab(last.c)}</b></span><span class="${up ? 'up' : 'dn'}">${last.o > 0 ? ((last.c / last.o - 1) * 100).toFixed(1) : '0.0'}%</span><span>Floor <b>${lab(last.f)}</b></span><span>Vol <b>${usd(last.v)}</b></span>`;
}

/* ---- coin view ---- */
let side = 'b', tab = 'holders', tabTouched = false, hmode = 'list', tf = '15m', cmode = 'mcap', per = '24h';
const isPhone = () => matchMedia('(max-width:900px)').matches;
const chgOf = (c) => { const o = {}; for (const [k, s] of [['5m', 300], ['1h', 3600], ['6h', 21600], ['24h', 86400]]) { const a = c.createdAt > nowTs() - s ? c.p0 : pxAgo(c.trades, s, c.p0); o[k] = a > 0 ? (c.p / a - 1) * 100 : 0; } return o; };
function coinView(c) {
  const chg = chgOf(c), m = c.meta || {};
  const links = `${m.x ? `<a href="${esc(m.x)}" target="_blank" rel="noopener" title="X">${X_I}</a>` : ''}${m.telegram ? `<a href="${esc(m.telegram)}" target="_blank" rel="noopener" title="Telegram">${SEND_I}</a>` : ''}${m.website ? `<a href="${esc(m.website)}" target="_blank" rel="noopener" title="Website">${GLOBE_I}</a>` : ''}${[['CoinGecko', 'coingecko', `https://www.coingecko.com/en/search?query=${c.addr}`], ['GeckoTerminal', 'geckoterminal', `https://www.geckoterminal.com/eth/tokens/${c.addr}`], ['DexScreener', 'dexscreener', `https://dexscreener.com/ethereum/${c.addr}`]].map(([n, f, u]) => `<a class="brand" href="${u}" target="_blank" rel="noopener" title="${n}"><img src="/brands/${f}.png" alt="${n}"></a>`).join('')}`;
  const me = W.address ? low(W.address) : '';
  return `<div class="center">
 <div class="ch"><a class="back" href="#/" aria-label="Back to launches"><svg class="ico" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></a><span class="av">${face(c)}</span><div class="idb"><h1><span class="nm">${esc(c.n)}</span>${c.v ? VF.replace('class="vf"', 'class="vf" style="width:18px;height:18px"') : ''}<span>$${esc(c.t)}</span><span class="links mo">${links}</span></h1><div class="meta"><span class="by">by <a href="#/trader/${c.creator}" style="display:inline-flex;align-items:center;gap:5px;color:var(--ink2)"><span class="av" style="display:inline-block;width:16px;height:16px;vertical-align:-3px">${tri(c.creator)}</span>${c.v ? 'Zappy' : trader(c.creator)}</a></span><span>${ago(c.age)}<span class="dk"> ago</span></span><a class="num" href="${CFG.explorer}/token/${c.addr}" target="_blank" rel="noopener">${short(c.addr)}</a>${copyBtn(c.addr)}<span class="links dk">${links}</span></div></div></div>
 ${m.description ? `<p class="desc">${esc(m.description)}</p>` : ''}
 <div class="stats"><div><span>Market cap</span><b class="num">${usd(c.mc)}<em class="${chg['24h'] >= 0 ? 'up' : 'dn'}">${chg['24h'] >= 0 ? '▲' : '▼'}${Math.abs(chg['24h']).toFixed(1)}%</em></b></div><div><span>Floor</span><b class="num">${usd(c.floor)}<em class="${c.fch >= 0 ? 'up' : 'dn'}">${c.fch >= 0 ? '▲' : '▼'}${Math.abs(c.fch).toFixed(1)}%</em></b></div><div><span>Price</span><b class="num">$${c.pUsd >= 1 ? c.pUsd.toFixed(4) : c.pUsd.toPrecision(4)}</b></div><div><span>Vol</span><b class="num">${usd(c.vol)}</b></div></div>
 <div class="cbar"><div class="pills sm" id="tf">${Object.keys(STEP).map((k) => `<button data-k="${k}" class="${k === tf ? 'on' : ''}">${k}</button>`).join('')}</div><div class="r"><div class="pills sm" id="cmode"><button data-k="mcap" class="${cmode === 'mcap' ? 'on' : ''}">Mcap</button><button data-k="price" class="${cmode === 'price' ? 'on' : ''}">Price</button></div><button class="gear" aria-label="Chart settings" data-gear>${GEAR_I}</button></div></div>
 <div class="ohlc"><div class="seg" id="ohlc-v"></div><div class="cur"><b>USD</b> <span class="grey">/</span> <b class="off">ETH</b></div></div>
 <canvas id="chart"></canvas><div class="handle mo"></div>
 <div class="tabs" id="tabs">${[['trade', '$' + esc(c.t)], ['holders', 'Holders · ' + c.holderCount.toLocaleString('en-US')], ['swaps', 'Swaps'], ['theses', 'Theses'], ['social', 'Social'], ['info', 'Info']].map(([k, l]) => `<button data-k="${k}" class="${k === 'trade' ? 'mo ' : ''}${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
 <div id="tabbody"></div></div>
 <aside class="side">
  <div class="card trade"><div class="bs"><div class="seg"><button class="b ${side === 'b' ? 'on' : ''}" data-x="b">Buy</button><button class="s ${side === 's' ? 'on' : ''}" data-x="s">Sell</button></div><button class="gear" aria-label="Slippage" data-slip>${GEAR_I}</button></div>
   <div class="pay"><div class="l">You pay <span class="bal" id="bal"></span></div><div class="in"><input id="amt" inputmode="decimal" placeholder="${side === 'b' ? '$0' : '0'}" class="num" autocomplete="off"><button class="tokb">${tok(side === 'b' ? ethsvg : face(c), side === 'b' ? 'ETH' : '$' + esc(c.t))}</button></div></div>
   <div class="chips">${side === 'b' ? ['25', '50', '100', '250'].map((v) => `<button data-v="${v}">$${v}</button>`).join('') : [['25', '25%'], ['50', '50%'], ['75', '75%'], ['100', 'Max']].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
   <div class="arrow"><svg class="ico" viewBox="0 0 24 24"><path d="M12 5v14M19 12l-7 7-7-7"/></svg></div>
   <div class="recv"><div class="top"><span class="l">You receive</span>${tok(side === 'b' ? face(c) : ethsvg, side === 'b' ? '$' + esc(c.t) : 'ETH', true)}</div><span class="v num" id="recv">${side === 'b' ? '0' : '$0.00'}</span><small class="sub" id="recv2"></small></div>
   <button class="btn g" id="go">${W.address ? (side === 'b' ? 'Buy $' + esc(c.t) : 'Sell $' + esc(c.t)) : WALLET_I + 'Connect wallet'}</button>${me ? `<div class="mine num" id="mine"></div>` : ''}</div>
  <div class="card act"><div class="per" id="per">${[['5m', '5M'], ['1h', '1H'], ['6h', '6H'], ['24h', '24H']].map(([k, l]) => `<button data-k="${k}" class="${per === k ? 'on' : ''}"><span>${l}</span><b class="num ${chg[k] >= 0 ? 'up' : 'dn'}">${chg[k] >= 0 ? '+' : ''}${chg[k].toFixed(1)}%</b></button>`).join('')}</div><div id="splits"></div></div>
  <div class="card sent"><div class="h">${HEART}<div><b>Love</b><small>No votes yet</small></div></div>
   <div class="faces">${[['<circle cx="8.5" cy="9.5" r="1.6"/><circle cx="15.5" cy="9.5" r="1.6"/>', 'M7.5 14.5c1.1 1.9 2.6 2.8 4.5 2.8s3.4-.9 4.5-2.8'], ['<circle cx="8.5" cy="9.5" r="1.6"/><circle cx="15.5" cy="9.5" r="1.6"/>', 'M8.5 16h7'], ['<circle cx="8.5" cy="9.5" r="1.6"/><circle cx="15.5" cy="9.5" r="1.6"/>', 'M7.5 17.3c1.1-1.9 2.6-2.8 4.5-2.8s3.4.9 4.5 2.8'], ['', 'M6.5 7.5l3.5 3.5M10 7.5 6.5 11M14 7.5l3.5 3.5M17.5 7.5 14 11M8.5 17h7']].map(([e, m]) => `<button aria-label="Vote"><svg viewBox="0 0 24 24">${e}<path d="${m}"/></svg></button>`).join('')}</div></div>
 </aside>`;
}
function tabBody(c, tab) {
  if (tab === 'holders') {
    const bar = `<div class="tbar"><div class="pills sm" id="hmode"><button data-k="list" class="${hmode === 'list' ? 'on' : ''}">List</button><button data-k="bubbles" class="${hmode === 'bubbles' ? 'on' : ''}">Bubbles</button></div><label class="tog">Contracts <span class="sw"><i></i></span></label></div>`;
    if (hmode === 'bubbles') return bar + `<div class="bubbles"><canvas id="bub"></canvas></div>`;
    if (!c.holders.length) return bar + `<div class="empty">No holders yet.</div>`;
    const rows = c.holders.slice(0, 50).map(([w, bal], k) => { const mine = c.trades.filter((x) => x.w === w), bought = mine.filter((x) => x.b).reduce((s, x) => s + x.eth * ethUsd, 0), sold = mine.filter((x) => !x.b).reduce((s, x) => s + x.eth * ethUsd, 0), tokIn = mine.filter((x) => x.b).reduce((s, x) => s + x.tok, 0); const val = bal * c.pUsd, pnl = sold + val - bought, avg = tokIn > 0 ? (bought / tokIn) * c.supply : 0, isC = w === c.creator;
      return `<tr><td class="grey">${k + 1}</td><td><a class="who" href="#/trader/${w}"><span class="av">${tri(w)}</span>${trader(w)}${isC ? '<span class="tagr">creator</span>' : ''}</a></td><td class="r"><div class="cell2"><b class="num">${usd(val)}</b><small class="num">${num(bal)} · ${(bal / c.supply * 100).toFixed(2)}%</small></div></td><td class="r"><div class="cell2"><b class="num ${pnl >= 0 ? 'up' : 'dn'}">${pnl >= 0 ? '+' : '-'}${usd(Math.abs(pnl))}</b><small class="num ${pnl >= 0 ? 'up' : 'dn'}">${bought > 0 ? (pnl >= 0 ? '+' : '') + (pnl / bought * 100).toFixed(1) + '%' : ''}</small></div></td><td class="r num">${avg ? usd(avg) : '<span class="grey">—</span>'}</td></tr>`; }).join('');
    return bar + `<div class="tw"><table><tr><th>#</th><th>Holder</th><th class="r">Position</th><th class="r">PnL</th><th class="r">Avg. mcap entry</th></tr>${rows}</table></div>`;
  }
  if (tab === 'swaps') {
    const trs = c.trades.filter((x) => !x.bb).slice().reverse().slice(0, 60); if (!trs.length) return `<div class="empty">No swaps yet.</div>`;
    return `<div class="tw"><table><tr><th>Age</th><th>Side</th><th>Trader</th><th class="r">USD</th><th class="r">$${esc(c.t)}</th><th></th></tr>${trs.map((x) => `<tr><td class="grey">${ago(nowTs() - x.ts)}</td><td class="${x.b ? 'up' : 'dn'}">${x.b ? 'Buy' : 'Sell'}</td><td><a class="who" href="#/trader/${x.w}"><span class="av">${tri(x.w)}</span>${trader(x.w)}</a></td><td class="r num">${usd(x.eth * ethUsd)}</td><td class="r num">${num(x.tok)}</td><td class="r grey"><a href="${CFG.explorer}/tx/${x.tx}" target="_blank" rel="noopener">${EXT_I}</a></td></tr>`).join('')}</table></div>`;
  }
  if (tab === 'theses') return `<div class="tbar"><span class="grey" style="font-size:12px;display:inline-flex;align-items:center;gap:6px"><i style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block"></i> Live</span></div><div class="compose"><span>Sign in to share your thesis on $${esc(c.t)}.</span><button class="btn" style="height:36px;padding:0 14px;font-size:13px;background:var(--s3)" data-soon>Sign in</button></div><div class="empty">No theses yet.</div>`;
  if (tab === 'social') { const m = c.meta || {}; return `<div class="tbar"><span class="grey" style="font-size:12px;display:inline-flex;align-items:center;gap:6px">${X_I.replace('class="ico f"', 'class="ico f" style="width:13px;height:13px"')} ${m.x ? `<a href="${esc(m.x)}" target="_blank" rel="noopener">${esc(m.x.replace(/^https?:\/\/(www\.)?/, ''))}</a>` : 'No X account linked'}</span></div><div class="empty">${m.x ? 'Posts show here once the feed is connected.' : 'The creator did not link an X account.'}</div>`; }
  const m = c.meta || {}, burned = Math.max(0, CFG.supply - c.supply), lastRaise = c.raises[c.raises.length - 1];
  const lk = (u, icon) => u ? `<a class="lk" href="${esc(u)}" target="_blank" rel="noopener">${icon}${esc(u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '';
  const links = lk(m.x, X_I) + lk(m.telegram, SEND_I) + lk(m.website, GLOBE_I);
  const cp = (a) => `<b class="num" style="display:inline-flex;align-items:center;gap:6px"><a href="${CFG.explorer}/address/${a}" target="_blank" rel="noopener">${short(a)}</a>${copyBtn(a, 14)}</b>`;
  return `${links ? `<div class="tbar" style="justify-content:flex-start;gap:8px;flex-wrap:wrap">${links}</div>` : ''}<div class="kv"><div><span>Contract</span>${cp(c.addr)}</div><div><span>Creator</span>${cp(c.creator)}</div><div><span>Launched</span><b>${new Date(c.createdAt * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</b></div><div><span>Pair</span><b>ETH</b></div><div><span>Supply</span><b class="num">${Math.round(c.supply).toLocaleString('en-US')}</b></div><div><span>Burned</span><b class="num">${(burned / CFG.supply * 100).toFixed(2)}% of supply</b></div><div><span>Creator earns</span><b>0.6% of every swap</b></div><div><span>Liquidity</span><b>Hook-owned, no LP tokens</b></div><div><span>Floor ETH</span><b class="num">${lastRaise ? lastRaise.eth.toFixed(4) + ' ETH' : '—'}</b></div><div><span>Floor raises</span><b class="num">${c.raises.length}</b></div>${c.vesting > 0 ? `<div><span>Vesting</span><b class="num">${num(c.vesting)} $${esc(c.t)}</b></div>` : ''}</div>`;
}
function bubbles(c) {
  const cv = $('#bub'); if (!cv) return; const r = cv.getBoundingClientRect(); cv.width = r.width * DPR; cv.height = r.height * DPR; const x = cv.getContext('2d');
  const H = c.holders.slice(0, 46); if (!H.length) return; const max = H[0][1]; seed = hashOf(c.addr) % 1000 + 1; const B = [];
  for (const [w, bal] of H) { const rr = (8 + 30 * Math.sqrt(bal / max)) * DPR; B.push({ x: rr + rnd() * (cv.width - 2 * rr), y: rr + rnd() * (cv.height - 2 * rr), r: rr, c: w === c.creator ? '#ffd84d' : '#4ade80', w }); }
  for (let it = 0; it < 60; it++) for (const a of B) for (const b of B) { if (a === b) continue; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, m = a.r + b.r + 3 * DPR; if (d < m) { const s = (m - d) / 2; a.x -= dx / d * s; a.y -= dy / d * s; b.x += dx / d * s; b.y += dy / d * s; } }
  B.forEach((b) => { x.fillStyle = b.c; x.globalAlpha = .85; x.beginPath(); x.arc(Math.max(b.r, Math.min(cv.width - b.r, b.x)), Math.max(b.r, Math.min(cv.height - b.r, b.y)), b.r, 0, 7); x.fill(); x.globalAlpha = 1; });
}
function splits(c) {
  const s = { '5m': 300, '1h': 3600, '6h': 21600, '24h': 86400 }[per], cut = nowTs() - s; let bv = 0, sv = 0, bn = 0, sn = 0; const by = new Set(), sy = new Set();
  for (const x of c.trades) { if (x.bb || x.ts < cut) continue; const u = x.eth * ethUsd; if (x.b) { bv += u; bn++; by.add(x.w); } else { sv += u; sn++; sy.add(x.w); } }
  const bar = (a, b) => `<div class="bb"><i style="flex:${a || (b ? 0 : 1)};background:var(--green)"></i><i style="flex:${b || (a ? 0 : 1)};background:var(--red)"></i></div>`;
  $('#splits').innerHTML = [['BUY VOL', 'SELL VOL', usd(bv), usd(sv), bv, sv], ['BUYS', 'SELLS', bn, sn, bn, sn], ['BUYERS', 'SELLERS', by.size, sy.size, by.size, sy.size]].map(([a, b, va, vb, na, nb]) => `<div class="pair2"><div class="tt"><span>${a}</span><span>${b}</span></div><div class="vv"><span class="num">${typeof va === 'number' ? va.toLocaleString('en-US') : va}</span><span class="num">${typeof vb === 'number' ? vb.toLocaleString('en-US') : vb}</span></div>${bar(na, nb)}</div>`).join('');
}

/* ---- leaderboard + profile ---- */
function lbView(sel) {
  const L = walletStats().slice(0, 50);
  return `<div class="lb"><h2>Top traders</h2>${L.length ? L.map((t, i) => `<a class="lbrow ${sel === t.w ? 'on' : ''}" href="#/trader/${t.w}"><span class="rk ${i < 3 ? 'top' : ''}">${i + 1}</span><span class="av">${tri(t.w)}</span><span class="nm">${trader(t.w)}</span><span class="rt"><b class="${t.pnl >= 0 ? 'up' : 'dn'} num">${t.pnl >= 0 ? '+' : '-'}${usd(Math.abs(t.pnl))}</b><small class="num">${usd(t.vol)} vol</small></span></a>`).join('') : '<div class="grey" style="padding:16px 10px;font-size:13px">No trades yet.</div>'}</div>`;
}
function profView(w) {
  const v = walletView(w), open = v.pos.filter((p) => p.open), closed = v.pos.filter((p) => !p.open), realized = v.sells - v.pos.reduce((s, p) => s + Math.min(p.cost, p.sold), 0), unreal = v.pos.reduce((s, p) => s + p.value, 0) - v.pos.reduce((s, p) => s + Math.max(0, p.cost - p.sold), 0);
  const floorV = v.pos.reduce((s, p) => s + p.floorValue, 0), value = v.pos.reduce((s, p) => s + p.value, 0), isMe = W.address && low(W.address) === w;
  return `<div class="prof center" style="grid-column:2/-1"><a class="back" href="#/leaderboard">${BACK_I}Leaderboard</a><div class="card" style="overflow:hidden"><div class="banner"><canvas id="pban"></canvas></div>
 <div class="idrow"><span class="av">${tri(w)}</span><div class="who2"><h1>${isMe ? 'You' : trader(w)}</h1><div class="addr num"><a href="${CFG.explorer}/address/${w}" target="_blank" rel="noopener">${short(w)}</a> ${copyBtn(w, 13)}${v.rank === 1 ? '<span class="tagr">#1 by profit</span>' : v.rank ? `<span class="tagr">#${v.rank} by profit</span>` : ''}</div></div><button class="btn ghost share" data-copy="${location.origin}/app#/trader/${w}">${SHARE_I}Share</button></div>
 <div class="pv"><div class="pvl"><div><span>Portfolio value</span><b class="num">${usd(value)}</b><small class="${v.pnl >= 0 ? 'up' : 'dn'} num">${v.pnl >= 0 ? '+' : '-'}${usd(Math.abs(v.pnl))} <span class="grey" style="display:inline">all time</span></small></div><div><span class="dot">Floor</span><b class="num">${usd(floorV)}</b><small class="grey num">what it sells for into the floor</small></div></div><div class="pills sm"><button class="on">1D</button><button>1W</button><button>1M</button></div></div>
 <canvas id="pchart"></canvas><div class="note">Value of holdings over time. The dashed line is the floor: what the tokens are worth if every holder sells.</div>
 <div class="pnl"><div><span>Total PnL</span><b class="${v.pnl >= 0 ? 'up' : 'dn'} num">${v.pnl >= 0 ? '+' : '-'}${usd(Math.abs(v.pnl))}</b></div><div><span>Realized PnL</span><b class="${realized >= 0 ? 'up' : 'dn'} num">${realized >= 0 ? '+' : '-'}${usd(Math.abs(realized))}</b></div><div><span>Unrealized PnL</span><b class="${unreal >= 0 ? 'up' : 'dn'} num">${unreal >= 0 ? '+' : '-'}${usd(Math.abs(unreal))}</b></div><div><span>Volume</span><b class="num">${usd(v.vol)}</b><small>${v.swaps} swaps</small></div></div>
 <div class="tabs" style="padding:0 12px"><button class="on">Open · ${open.length}</button><button data-soon>Closed · ${closed.length}</button><button data-soon>Orders</button><button data-soon>Activity</button><button data-soon>Launched · ${COINS.filter((c) => c.creator === w).length}</button><button data-soon>Theses</button></div>
 <div style="padding:0 12px 12px"><div class="tw"><table><tr><th>Coin</th><th class="r">Mcap</th><th class="r">Value</th><th class="r">Floor value</th><th class="r">PnL</th><th></th></tr>${open.length ? open.map((p) => `<tr><td><a class="who" href="#/coin/${p.c.addr}"><span class="av">${face(p.c)}</span><div><b style="font-weight:500">${esc(p.c.n)}</b><br><small class="grey">$${esc(p.c.t)}</small></div></a></td><td class="r"><div class="cell2"><b class="num">${usd(p.c.mc)}</b><small class="num">${p.avgEntry ? 'Avg. entry ' + usd(p.avgEntry) : ''}</small></div></td><td class="r"><div class="cell2"><b class="num">${usd(p.value)}</b><small class="num">${num(p.bal)} $${esc(p.c.t)}</small></div></td><td class="r num">${usd(p.floorValue)}</td><td class="r"><div class="cell2"><b class="${p.pnl >= 0 ? 'up' : 'dn'} num">${p.pnl >= 0 ? '+' : '-'}${usd(Math.abs(p.pnl))}</b><small class="${p.pnl >= 0 ? 'up' : 'dn'} num">${p.cost > 0 ? (p.pnl >= 0 ? '+' : '') + (p.pnl / p.cost * 100).toFixed(0) + '%' : ''}</small></div></td><td class="r"><a class="btn ghost" style="height:30px;padding:0 10px;font-size:12px" href="#/coin/${p.c.addr}">Trade</a></td></tr>`).join('') : '<tr><td colspan="6" class="grey">No open positions.</td></tr>'}</table></div></div></div></div>`;
}
function profCharts(w) {
  const b = $('#pban'); if (b) { const r = b.getBoundingClientRect(); b.width = r.width * DPR; b.height = r.height * DPR; const x = b.getContext('2d'); const [a, c] = TPAL[hashOf(w) % TPAL.length]; x.fillStyle = c; x.fillRect(0, 0, b.width, b.height);
    const P = new Path2D('M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z'), s = 1.1 * DPR, gx = 58 * DPR, gy = 46 * DPR; x.fillStyle = a; x.globalAlpha = .55;
    for (let yy = -gy; yy < b.height + gy; yy += gy) { const odd = Math.round(yy / gy) % 2; for (let xx = -gx; xx < b.width + gx; xx += gx) { x.save(); x.translate(xx + (odd ? gx / 2 : 0), yy); x.scale(s, s); x.fill(P); x.restore(); } } x.globalAlpha = 1; }
  const cv = $('#pchart'); if (!cv) return; const r = cv.getBoundingClientRect(); cv.width = r.width * DPR; cv.height = r.height * DPR; const x = cv.getContext('2d'), W2 = cv.width, H = cv.height;
  // the wallet's holdings valued at each coin's price after every trade it made, then at today's price
  const v = walletView(w), pts = []; const held = {}; let ts0 = 0;
  const all = v.pos.flatMap((p) => p.trades.map((t) => ({ ...t, c: p.c }))).sort((a, b) => a.ts - b.ts);
  const value = (px) => Object.entries(held).reduce((s, [a, bal]) => s + bal * (px[a] || BY.get(a).pUsd), 0), px = {};
  for (const t of all) { held[t.c.addr] = (held[t.c.addr] || 0) + (t.b ? t.tok : -t.tok); px[t.c.addr] = t.p * ethUsd; if (!ts0) ts0 = t.ts; pts.push({ ts: t.ts, v: value(px), f: Object.entries(held).reduce((s, [a, bal]) => s + bal * floorAt(BY.get(a), t.ts), 0) }); }
  for (const p of v.pos) held[p.c.addr] = p.bal; pts.push({ ts: nowTs(), v: v.pos.reduce((s, p) => s + p.value, 0), f: v.pos.reduce((s, p) => s + p.floorValue, 0) });
  if (pts.length < 2) pts.unshift({ ts: pts[0].ts - 3600, v: pts[0].v, f: pts[0].f });
  const t0 = pts[0].ts, t1 = pts[pts.length - 1].ts || t0 + 1, mx = Math.max(1e-9, ...pts.map((p) => Math.max(p.v, p.f))) * 1.05, Y = (q) => H - 10 * DPR - q / mx * (H - 20 * DPR), Xp = (ts) => ((ts - t0) / Math.max(1, t1 - t0)) * (W2 - 4 * DPR);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,216,77,.25)'); g.addColorStop(1, 'rgba(255,216,77,0)'); x.beginPath(); x.moveTo(0, H); pts.forEach((p, i) => { if (i) x.lineTo(Xp(p.ts), Y(pts[i - 1].v)); x.lineTo(Xp(p.ts), Y(p.v)); }); x.lineTo(W2, H); x.closePath(); x.fillStyle = g; x.fill();
  x.strokeStyle = '#ffd84d'; x.lineWidth = 1.6 * DPR; x.beginPath(); pts.forEach((p, i) => { if (i) x.lineTo(Xp(p.ts), Y(pts[i - 1].v)); i ? x.lineTo(Xp(p.ts), Y(p.v)) : x.moveTo(Xp(p.ts), Y(p.v)); }); x.stroke();
  x.setLineDash([3 * DPR, 4 * DPR]); x.strokeStyle = 'rgba(255,255,255,.35)'; x.beginPath(); pts.forEach((p, i) => { if (i) x.lineTo(Xp(p.ts), Y(pts[i - 1].f)); i ? x.lineTo(Xp(p.ts), Y(p.f)) : x.moveTo(Xp(p.ts), Y(p.f)); }); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#ffd84d'; x.beginPath(); x.arc(W2 - 2 * DPR, Y(pts[pts.length - 1].v), 4 * DPR, 0, 7); x.fill();
}

/* ---- modals ---- */
const scrim = $('#scrim'), modal = $('#modal'); const closeM = () => scrim.classList.remove('on'); scrim.onclick = (e) => { if (e.target === scrim) closeM(); }; addEventListener('keydown', (e) => { if (e.key === 'Escape') closeM(); });
const mh = (t) => `<div class="mh"><b>${t}</b><button class="x" aria-label="Close">${CLOSE_I}</button></div>`;
function connectModal() {
  if (W.address) { modal.className = 'modal'; modal.innerHTML = mh('Wallet') + `<div class="wrow"><span class="av" style="width:40px;height:40px">${tri(W.address)}</span><div><b>${trader(W.address)}</b><div class="grey num" style="font-size:12px">${short(W.address)} · ${W.eth.toFixed(4)} ETH</div></div></div><div style="display:flex;gap:8px;margin-top:14px"><a class="btn ghost" style="flex:1" href="#/trader/${low(W.address)}">Profile</a><button class="btn ghost" style="flex:1" id="wdis">Disconnect</button></div>`; $('.x', modal).onclick = closeM; $$('a', modal).forEach((a) => a.onclick = closeM); $('#wdis').onclick = () => { if (W.viaRk && RK.disconnect) RK.disconnect(); W.provider = null; W.address = ''; W.viaRk = false; closeM(); render(); }; scrim.classList.add('on'); return; }
  if (rkReady()) { closeM(); RK.open(); return; }
  modal.className = 'modal'; modal.innerHTML = mh('Connect a Wallet') + `<div class="grey" style="font-size:12px;margin-bottom:10px">Popular</div><div class="wgrid">${[['MetaMask', 'metamask'], ['Coinbase', 'coinbase'], ['Rainbow', 'rainbow'], ['Trust Wallet', 'trust'], ['Rabby Wallet', 'rabby'], ['Phantom', 'phantom'], ['WalletConnect', 'walletconnect']].map(([n, f]) => `<button data-w="${n}"><i><img src="/brands/w-${f}.png" alt=""></i>${n}</button>`).join('')}</div><div class="grey" style="font-size:12px;margin-top:12px">Browser wallets connect straight away. On a phone, open this page inside the wallet's app.</div>`;
  $('.x', modal).onclick = closeM; $$('[data-w]', modal).forEach((b) => b.onclick = async () => { b.disabled = true; try { await connect(b.dataset.w); closeM(); } catch (e) { toast(e.message, 5000); b.disabled = false; } }); scrim.classList.add('on');
}
const L = { name: '', ticker: '', desc: '', buy: 'None', img: '', x: '', telegram: '', website: '', busy: false };
function launchModal() {
  modal.className = 'modal wide'; modal.innerHTML = mh('Launch a token') + `<div class="lf">
 <div class="top"><label class="pick" id="pick">${L.img ? `<img src="${L.img}" alt="">` : '<svg class="ico" style="width:26px;height:26px" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'}<input type="file" id="limg" accept="image/*" hidden></label><div style="flex:1;min-width:0"><div class="nm"><input id="lnm" placeholder="Token name" maxlength="32" value="${esc(L.name)}"></div><div class="tk" style="display:flex;align-items:center"><span class="dollar">$</span><input id="ltk" placeholder="TICKER" maxlength="10" value="${esc(L.ticker)}"></div></div></div>
 <textarea id="ldesc" placeholder="What's it about? (optional)" maxlength="500">${esc(L.desc)}</textarea>
 <div class="soc">${[['x', 'X profile or tweet'], ['telegram', 'Telegram'], ['website', 'Website']].map(([k, l]) => `<input class="socin" data-k="${k}" placeholder="+ ${l}" value="${esc(L[k])}">`).join('')}</div>
 <div class="hr"></div>
 <div class="fr"><span>Pair</span><span class="pairsel"><span class="av">${ethsvg}</span>ETH</span></div>
 <div class="fr"><span>First buy</span><div class="pills sm" id="lbuy">${['None', '1%', '2.5%', '5%'].map((v) => `<button data-v="${v}" class="${L.buy === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>
 <div class="lbot"><button class="btn y" style="height:46px;width:100%" id="ldo" ${L.name && L.ticker && !L.busy ? '' : 'disabled'}>${L.busy ? 'Launching…' : W.address ? 'Launch' : 'Connect a wallet to launch'}</button>
 <div class="fine" id="lfine">Starts at ~$10K · 1B supply · Earn 0.6% of volume · Liquidity owned by the hook<br>The launch fee is set on-chain and burns $ZAPPY.</div></div></div>`;
  const ok = () => { $('#ldo').disabled = !(L.name && L.ticker && !L.busy); };
  $('.x', modal).onclick = closeM; $('#lnm').oninput = (e) => { L.name = e.target.value.trim(); ok(); }; $('#ltk').oninput = (e) => { L.ticker = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10); e.target.value = L.ticker; ok(); }; $('#ldesc').oninput = (e) => L.desc = e.target.value;
  $$('.socin', modal).forEach((i) => i.oninput = () => L[i.dataset.k] = i.value.trim());
  $$('#lbuy button').forEach((b) => b.onclick = () => { L.buy = b.dataset.v; $$('#lbuy button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#limg').onchange = (e) => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { L.img = rd.result; launchModal(); }; rd.readAsDataURL(f); };
  $('#ldo').onclick = async () => {
    if (!W.address) { connectModal(); return; }
    L.busy = true; launchModal(); const fine = $('#lfine');
    try { fine.textContent = 'Saving the logo and metadata…'; const pct = parseFloat(L.buy) || 0;
      const r = await launch({ name: L.name, ticker: L.ticker, desc: L.desc, image: L.img, buyPct: pct, x: L.x, telegram: L.telegram, website: L.website });
      L.busy = false; Object.assign(L, { name: '', ticker: '', desc: '', buy: 'None', img: '', x: '', telegram: '', website: '' }); closeM(); toast('Launched. ' + (r.addr ? 'Opening the coin…' : 'View it on Etherscan: ' + r.hash), 5000); if (r.addr) location.hash = '#/coin/' + r.addr; render(); }
    catch (e) { L.busy = false; launchModal(); $('#lfine').textContent = e.message; toast(e.message, 6000); }
  };
  scrim.classList.add('on');
}
function searchModal() { modal.className = 'modal'; modal.innerHTML = mh('Search coins') + `<input id="q" placeholder="Name, ticker or address" style="width:100%;height:44px;padding:0 12px;border-radius:12px;background:var(--bg);border:1px solid var(--line);outline:0;color:var(--ink)"><div id="qres" style="margin-top:8px"></div>`; $('.x', modal).onclick = closeM; const q = $('#q'); q.oninput = () => { const v = q.value.toLowerCase(); $('#qres').innerHTML = COINS.filter((c) => v && (c.n + c.t + c.addr).toLowerCase().includes(v)).slice(0, 8).map((c) => `<a class="row" href="#/coin/${c.addr}"><span class="av">${face(c)}</span><span class="nm"><b>${esc(c.n)} <span>$${esc(c.t)}</span></b></span><span class="rt"><b class="num">${usd(c.mc)}</b></span></a>`).join(''); $$('#qres a').forEach((a) => a.onclick = closeM); }; scrim.classList.add('on'); setTimeout(() => q.focus(), 30); }
function slipModal() { modal.className = 'modal'; modal.innerHTML = mh('Slippage') + `<div class="pills sm" id="slip">${[50, 100, 300, 500, 1000].map((b) => `<button data-v="${b}" class="${CFG.slippageBps === b ? 'on' : ''}">${b / 100}%</button>`).join('')}</div><div class="grey" style="font-size:12px;margin-top:10px">The most the price may move against you before the swap fails. A coin's tax is separate: 2.5% after its first minute, up to 90% inside it.</div>`; $('.x', modal).onclick = closeM; $$('#slip button').forEach((b) => b.onclick = () => { CFG.slippageBps = +b.dataset.v; closeM(); toast('Slippage ' + (CFG.slippageBps / 100) + '%'); }); scrim.classList.add('on'); }
['#r-launch', '#m-launch'].forEach((s) => { const e = $(s); if (e) e.onclick = (ev) => { ev.preventDefault(); launchModal(); }; }); ['#r-signin', '#m-signin'].forEach((s) => { const e = $(s); if (e) e.onclick = connectModal; }); ['#r-search', '#m-search'].forEach((s) => { const e = $(s); if (e) e.onclick = searchModal; });
document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b) { navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Copied')); e.preventDefault(); } const s = e.target.closest('[data-soon]'); if (s) { toast('Sign-in and profiles come with the next release.'); e.preventDefault(); } });

/* ---- trade panel wiring ---- */
let quoteSeq = 0;
function tradePanel(c) {
  const amt = $('#amt'), recv = $('#recv'), recv2 = $('#recv2'), go = $('#go'), bal = $('#bal'), mine = $('#mine');
  let myTok = 0n; const showBal = () => { if (!W.address) { bal.textContent = ''; return; } bal.textContent = side === 'b' ? W.eth.toFixed(4) + ' ETH' : num(Number(X.formatEther(myTok))) + ' $' + c.t; };
  if (W.address) myTokens(c.addr).then((b) => { myTok = b; showBal(); if (mine) mine.textContent = 'You hold ' + num(Number(X.formatEther(b))) + ' $' + c.t + ' (' + usd(Number(X.formatEther(b)) * c.pUsd) + ')'; }).catch(() => {}); showBal();
  const parse = () => parseFloat((amt.value || '').replace(/[^0-9.]/g, '')) || 0;
  const est = async () => {
    const v = parse(), mySeq = ++quoteSeq; if (!v) { recv.textContent = side === 'b' ? '0' : '$0.00'; recv.classList.remove('has'); recv2.textContent = ''; return; }
    recv.classList.add('has'); recv2.textContent = 'quoting…';
    try {
      if (side === 'b') { const eth = v / ethUsd, out = await quote(c, true, X.parseEther(eth.toFixed(12))); if (mySeq !== quoteSeq) return; const t = Number(X.formatEther(out)); recv.textContent = num(t); recv2.textContent = eth.toFixed(5) + ' ETH · ' + (t > 0 ? usd(t * c.pUsd) + ' at the current price' : ''); }
      else { const out = await quote(c, false, X.parseEther(Math.min(v, 1e15).toFixed(6))); if (mySeq !== quoteSeq) return; const eth = Number(X.formatEther(out)); recv.textContent = usd(eth * ethUsd); recv2.textContent = eth.toFixed(5) + ' ETH'; }
    } catch (e) { if (mySeq !== quoteSeq) return; recv.textContent = '—'; recv2.textContent = e.message; }
  };
  amt.oninput = () => { clearTimeout(amt._t); amt._t = setTimeout(est, 250); };
  $$('.chips button').forEach((b) => b.onclick = () => { if (side === 'b') amt.value = '$' + b.dataset.v; else { const have = Number(X.formatEther(myTok)); amt.value = have ? String(Math.floor(have * (+b.dataset.v) / 100 * 1e6) / 1e6) : '0'; } est(); });
  go.onclick = async () => {
    if (!W.address) return connectModal(); const v = parse(); if (!v) return toast(side === 'b' ? 'Enter an amount in dollars' : 'Enter how many tokens to sell');
    go.disabled = true; go.textContent = side === 'b' ? 'Buying…' : 'Selling…';
    try { const h = side === 'b' ? await buy(c, v / ethUsd) : await sell(c, v); toast((side === 'b' ? 'Bought $' : 'Sold $') + c.t + ' · ' + short(h), 5000); } catch (e) { toast(e.message, 7000); go.disabled = false; go.textContent = side === 'b' ? 'Buy $' + c.t : 'Sell $' + c.t; }
  };
}

/* ---- render ---- */
function render() {
  const h = location.hash.replace(/^#/, '') || '/', mc = h.match(/^\/coin\/([A-Za-z0-9]+)/), mt = h.match(/^\/trader\/(0x[0-9a-fA-F]{40})/), lb = h.startsWith('/leaderboard') || mt; const cols = $('#cols');
  $$('[data-r]').forEach((a) => a.classList.toggle('on', a.dataset.r === (lb ? 'lb' : 'home')));
  const si = $('#r-signin'); if (si) si.innerHTML = W.address ? `<span class="av" style="width:26px;height:26px">${tri(W.address)}</span>` : '<svg class="ico" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>';
  const ms = $('#m-signin'); if (ms) ms.textContent = W.address ? short(W.address) : 'Sign in';
  $('#ticker').innerHTML = tickerHtml();
  if (!ST) { cols.className = 'cols home'; cols.innerHTML = `<div class="list"><div class="grey" style="padding:24px 10px;font-size:13px">Loading Ethereum…</div></div>`; return; }
  if (lb) { const w = mt ? low(mt[1]) : (walletStats()[0] || {}).w; cols.className = 'cols ' + (mt ? 'coin' : 'home'); cols.innerHTML = `<div class="list"><div class="rows" style="margin-top:0">${lbView(w)}</div></div>${w ? profView(w) : '<div class="center" style="grid-column:2/-1"><div class="card empty">No traders yet.</div></div>'}`; if (w) profCharts(w); window.scrollTo(0, 0); return; }
  const c = mc ? findCoin(mc[1]) : (COINS.find((x) => x.v) || COINS[0]);
  if (!c) { cols.className = 'cols home'; cols.innerHTML = `<div class="list">${listHtml()}</div><div class="center" style="grid-column:2/-1"><div class="card empty">${mc ? 'That coin is not indexed yet. It shows up a few seconds after its launch.' : 'No coins yet.'}</div></div>`; $$('#sort button').forEach((b) => b.onclick = () => { sort = b.dataset.s; render(); }); return; }
  cur = c.addr; cols.className = 'cols ' + (mc ? 'coin' : 'home');
  cols.innerHTML = `<div class="list">${listHtml()}</div>${coinView(c)}`;
  $$('#sort button').forEach((b) => b.onclick = () => { sort = b.dataset.s; render(); });
  drawChart(c, cmode); $$('#tf button').forEach((b) => b.onclick = () => { tf = b.dataset.k; $$('#tf button').forEach((x) => x.classList.toggle('on', x === b)); drawChart(c, cmode); }); $$('#cmode button').forEach((b) => b.onclick = () => { cmode = b.dataset.k; $$('#cmode button').forEach((x) => x.classList.toggle('on', x === b)); drawChart(c, cmode); });
  if (isPhone() && !tabTouched) tab = 'trade';
  const showTab = () => { const t = tab === 'trade' && !isPhone() ? 'holders' : tab; cols.classList.toggle('trade', t === 'trade'); $('#tabbody').innerHTML = t === 'trade' ? '' : tabBody(c, t); $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.k === t)); $$('#hmode button').forEach((b) => b.onclick = () => { hmode = b.dataset.k; showTab(); }); if (t === 'holders' && hmode === 'bubbles') bubbles(c); };
  $$('#tabs button').forEach((b) => b.onclick = () => { tab = b.dataset.k; tabTouched = true; showTab(); }); showTab();
  $$('.bs button[data-x]').forEach((b) => b.onclick = () => { side = b.dataset.x; render(); });
  $('[data-slip]').onclick = slipModal; $('[data-gear]').onclick = () => toast('Chart settings come with the next release.');
  tradePanel(c);
  $$('#per button').forEach((b) => b.onclick = () => { per = b.dataset.k; $$('#per button').forEach((x) => x.classList.toggle('on', x === b)); splits(c); }); splits(c);
  $$('.faces button').forEach((b) => b.onclick = () => toast('Sign in to vote. Coming with the next release.'));
  if (!render._kept) window.scrollTo(0, 0);
}
addEventListener('hashchange', () => { tabTouched = false; render(); });
addEventListener('resize', () => { const c = BY.get(cur); if (c && $('#chart')) drawChart(c, cmode); if (c && $('#bub')) bubbles(c); const mt = location.hash.match(/trader\/(0x[0-9a-fA-F]{40})/); if (mt) profCharts(low(mt[1])); });
// a quiet refresh keeps numbers live without resetting what the visitor is typing or reading
async function tick() { if (document.hidden) return; const b = ST && ST.block; try { await load(); } catch {} if (ST && ST.block !== b) { const amt = $('#amt'), typing = amt && (document.activeElement === amt || amt.value); if (!typing && !scrim.classList.contains('on')) { render._kept = true; const y = scrollY; render(); scrollTo(0, y); render._kept = false; } else { $('#ticker').innerHTML = tickerHtml(); } } }
render(); load().then(render).catch((e) => { toast('Could not load Ethereum state: ' + e.message, 6000); });
setInterval(tick, 5000); setInterval(() => { if (W.address) refreshMine(); }, 20000);
})();
