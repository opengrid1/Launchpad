/* Hypex's live data layer: the DATA interface on the Hypex floor contracts on both chains (Elysium and HyperEVM).
   Loaded after the shared chain.js, which runs the design preview (sample coins) while no chain has contracts; once
   one has, this replaces window.DATA.
   Every coin lives on both chains, each with its own address (like Pangea), a pool and a floor on each; the launch
   service pairs the addresses, and the coin's view merges both (price, floor, holders, trades; `cas` per chain), and every trade or claim goes to the chain the user picks (the coin's
   `net`, its home chain, by default).
   Reads: /api/state?chain=<key> per chain (an indexer over each chain's logs, cached by the CDN), every few seconds.
   Quotes: from the pool price and the fixed 2.5% tax (an estimate; the swap itself is bounded by the Quoter's answer).
   Writes, through the connected wallet: HypexFactory.launch (logo uploaded first, start signed by /api/sign, the leg on
   the other chain put there by /api/leg), buys and sells through Uniswap's UniversalRouter (native HYPE in or out),
   the trader airdrop and creator fee claims, and HypexBridge.send to move coins to the other chain. */
(function () {
  const C = window.CFG, X = window.ethers;
  if (!C.liveChains || !C.liveChains().length) return; // preview: the shared chain.js keeps the sample coins
  const E = C.econ, SUPPLY = E.supply, low = (a) => String(a || '').toLowerCase(), now = () => Math.floor(Date.now() / 1000);
  const NETS = () => C.liveChains().map((c) => c.key), K = (net) => C.chainOf(net).contracts, Q96 = 2 ** 96;
  const LP = '(string name,string ticker,string metadataURI,bytes32 salt,address quote,uint256 devBuyTokens,uint256 devBuyMaxCost,int24 tickStart,uint256 deadline,bytes signature,uint8 vestMonths)';
  const I = {
    erc20: new X.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']),
    permit2: new X.Interface(['function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)', 'function approve(address token, address spender, uint160 amount, uint48 expiration)']),
    factory: new X.Interface([`function launch(${LP} lp) payable returns (address token, bytes32 poolId)`, 'function launchFeeEth() view returns (uint256)', 'function predictToken(address creator, bytes32 salt, string name, string ticker) view returns (address)', 'event TokenLaunched(address indexed token, bytes32 indexed poolId, address indexed creator, address quote, int24 tickStart, uint256 devBuyTokens, string name, string ticker, string metadataURI)',
      'error DevBuyTooBig()', 'error DevBuyTooExpensive()', 'error StartExpired()', 'error StartUsed()', 'error StartOutOfBand()', 'error FeeNotPaid()', 'error Paused()', 'error BadSalt()']),
    hook: new X.Interface(['function claimCreator((address,address,uint24,int24,address) key, address to)', 'error PartialFill()', 'error NeedGas()', 'error FloorBroken()', 'error UnknownPool()', 'error NotCreator()']),
    revenue: new X.Interface(['function claim(address account, address currency, address to) returns (uint256)', 'function owed(address,address) view returns (uint256)']),
    bridge: new X.Interface(['function send(address token, uint256 amount, uint16 toChain, address to) payable returns (uint64)', 'error NoPeer()', 'error BadAmount()']),
    quoter: new X.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)']),
    router: new X.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable', 'error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)', 'error DeadlinePassed(uint256 deadline)']),
    mc: new X.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])', 'function getEthBalance(address) view returns (uint256)']),
  };
  const AC = X.AbiCoder.defaultAbiCoder(), PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3', ZERO = X.ZeroAddress;
  const ERR = { PartialFill: 'The pool could not fill the whole amount. Try a smaller amount.', V4TooLittleReceived: 'The price moved past your slippage. Raise the slippage or trade a smaller amount.', DeadlinePassed: 'The transaction waited too long. Try again.', StartExpired: 'The launch start expired. Try again.', StartUsed: 'That launch was already sent.', StartOutOfBand: 'HYPE moved too far for this start. Try again.', FeeNotPaid: 'The launch fee was not paid.', Paused: 'Launches are paused right now.', NoPeer: 'That chain is not connected yet.', NotCreator: 'Only the creator can do that.' };

  // ---- RPC per chain (reads and receipts; public endpoints rate-limit, so every call retries)
  let rid = 0;
  async function rpc(method, params, net, tries = 7) {
    let last = ''; const ch = C.chainOf(net), urls = ch.rpcs && ch.rpcs.length ? ch.rpcs : [ch.rpc];
    for (let i = 0; i < tries; i++) {
      try { const r = await fetch(urls[i % urls.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) }); const j = await r.json().catch(() => null); if (j && !j.error) return j.result; last = (j && j.error && j.error.message) || 'HTTP ' + r.status; if (j && j.error && !/rate|limit|busy|timed out|unavailable/i.test(last)) { const e = new Error(last); e.data = j.error.data; throw e; } }
      catch (e) { if (e.data !== undefined) throw e; last = e.message; }
      await new Promise((r) => setTimeout(r, Math.min(5000, 400 * 2 ** i)));
    }
    throw new Error(ch.name + ' RPC is busy, try again in a moment (' + last + ')');
  }
  const call = async (to, iface, fn, args, net) => iface.decodeFunctionResult(fn, await rpc('eth_call', [{ to, data: iface.encodeFunctionData(fn, args || []) }, 'latest'], net));
  async function receipt(hash, net, ms = 240000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const r = await rpc('eth_getTransactionReceipt', [hash], net, 3).catch(() => null); if (r) { if (parseInt(r.status, 16) !== 1) throw new Error('Transaction reverted on ' + C.chainOf(net).name); return r; } await new Promise((s) => setTimeout(s, 1200)); }
    throw new Error('Still waiting for the transaction; check it on the explorer');
  }
  function revertText(e) {
    const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof d === 'string' && d.length >= 10) for (const f of Object.values(I)) { try { const p = f.parseError(d); if (p) return ERR[p.name] || p.name; } catch {} }
    return APP.errMsg(e);
  }
  // the wallet on `net` before anything is sent: asked for that chain by id (not through the site's current chain,
  // which a page may move back to the coin's home chain while it renders)
  async function onChain(net) {
    const ch = C.chainOf(net); C.useChain(net, false);
    const p = APP.W.provider; if (!p) return;
    const cid = await p.request({ method: 'eth_chainId' }).catch(() => null);
    if (cid && parseInt(cid, 16) === ch.id) { APP.W.chainOk = true; return; }
    try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ch.hex }] }); }
    catch (e) { if (e && (e.code === 4902 || /unrecognized|not added|4902/i.test(e.message || ''))) await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: ch.hex, chainName: ch.name, nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: [ch.rpc], blockExplorerUrls: ch.explorer ? [String(ch.explorer).replace(/\/#$/, '')] : [] }] }); else throw e; }
    const now2 = await p.request({ method: 'eth_chainId' }).catch(() => null);
    if (!now2 || parseInt(now2, 16) !== ch.id) throw new Error('Switch your wallet to ' + ch.name);
    APP.W.chainOk = true;
  }
  async function send(tx, label, net) {
    if (!APP.W.connected || !APP.W.provider) { APP.W.connect(); throw new Error('Connect a wallet to ' + label); }
    await onChain(net);
    const signer = await new X.BrowserProvider(APP.W.provider).getSigner();
    try { await rpc('eth_call', [{ from: APP.W.address, to: tx.to, data: tx.data, value: tx.value ? '0x' + BigInt(tx.value).toString(16) : '0x0' }, 'latest'], net, 4); }
    catch (e) { if (e.data !== undefined) throw new Error(revertText(e)); }
    let sent; try { sent = await signer.sendTransaction(tx); } catch (e) { throw new Error(revertText(e)); }
    return receipt(sent.hash, net).then((r) => ({ hash: sent.hash, receipt: r }));
  }

  // ---- state: one indexer answer per chain, merged by coin address
  const SS = {}; let BY = new Map(), ALL = [], listeners = 0, lastLoad = 0;
  const myBal = new Map(), hypeBal = {};
  async function load(fresh) {
    if (!fresh && Date.now() - lastLoad < 2500) return; lastLoad = Date.now();
    await Promise.all(NETS().map(async (net) => { try { const r = await fetch('/api/state?chain=' + net + (fresh ? '&t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' }); if (r.ok) SS[net] = await r.json(); } catch {} }));
    index();
  }
  // every chain has its own address for a coin (like Pangea); the launch service pairs them (RemoteRecorded), and the
  // site shows one coin per pair: its home chain's address names it, BY finds it by any of its addresses
  function index() {
    const leg = new Map(); // "net:addr" -> leg
    for (const net of NETS()) {
      const st = SS[net]; if (!st || !st.tokens) continue;
      const wh = C.chainOf(net).whChain;
      for (const t of st.tokens) leg.set(net + ':' + t.addr, { ...t, net, wh, trades: st.trades.filter((x) => x.t === t.addr).map((x) => ({ ...x, net })) });
    }
    const byWh = Object.fromEntries(NETS().map((n) => [C.chainOf(n).whChain, n])), seen = new Set(), by = new Map(), all = [];
    for (const [k, l] of leg) {
      if (seen.has(k)) continue;
      const group = [l]; seen.add(k);
      for (const [wh, ra] of Object.entries(l.remotes || {})) { const n = byWh[wh], o = n && leg.get(n + ':' + ra); if (o && !seen.has(n + ':' + ra)) { group.push(o); seen.add(n + ':' + ra); } }
      const legs = group.sort((a, b) => a.createdAt - b.createdAt), home = legs[0];
      const m = { addr: home.addr, legs: Object.fromEntries(legs.map((g) => [g.net, g])), net: home.net, name: home.name, symbol: home.ticker, creator: home.creator, createdAt: home.createdAt, tx: home.tx, meta: home.meta || {} };
      m.trades = legs.flatMap((g) => g.trades).filter((x) => !x.bb).sort((a, b) => a.ts - b.ts);
      for (const g of legs) by.set(g.addr, m);
      all.push(m);
    }
    BY = by; ALL = all; VIEW.clear();
  }
  const VIEW = new Map();
  function legView(l) {
    const t24 = now() - 86400, tr = l.trades.filter((x) => !x.bb), last24 = tr.filter((x) => x.ts >= t24), p24 = (tr.filter((x) => x.ts < t24).pop() || { p: l.p0 }).p;
    return { net: l.net, px: l.p, pxUsd: l.p * APP.hypeUsd, mcap: l.p * l.supply, floorPx: l.floorP, floorCover: l.p > 0 ? Math.min(1, l.floorP / l.p) : 0, supply: l.supply, circulating: l.circulating,
      vol24: last24.reduce((s, x) => s + x.h, 0), volAll: tr.reduce((s, x) => s + x.h, 0), feesAll: tr.reduce((s, x) => s + x.tax, 0), buys24: last24.filter((x) => x.b).length, sells24: last24.filter((x) => !x.b).length, c24: p24 > 0 ? (l.p / p24 - 1) * 100 : 0, holders: l.holderCount };
  }
  function view(m) {
    const c = VIEW.get(m.addr); if (c && c._usd === APP.hypeUsd) return c;
    const byChain = {}; for (const [net, l] of Object.entries(m.legs)) byChain[net] = legView(l);
    const legs = Object.values(byChain), h = byChain[m.net], sum = (k) => legs.reduce((s, x) => s + x[k], 0), meta = m.meta || {};
    const v = { addr: m.addr, name: m.name, symbol: m.symbol, img: meta.image || APP.defaultImg(m.symbol, m.addr), desc: meta.description || '', links: { x: meta.x || '', tg: meta.telegram || '', web: meta.website || '' },
      creator: m.creator, feeRecipient: m.creator, createdAt: m.createdAt, cas: Object.fromEntries(Object.values(m.legs).map((l) => [l.net, l.addr])), age: APP.ago(m.createdAt), net: m.net, chains: Object.keys(byChain), byChain, chainName: C.chainOf(m.net).name,
      px: h.px, pxUsd: h.pxUsd, mcap: sum('mcap'), mcapUsd: sum('mcap') * APP.hypeUsd, liqHype: 0, vol24: sum('vol24'), volAll: sum('volAll'), feesAll: sum('feesAll'), buys24: sum('buys24'), sells24: sum('sells24'), c24: h.c24,
      holders: new Set(Object.values(m.legs).flatMap((l) => l.holders.map(([w]) => w))).size, floor: h.floorCover, floorPx: h.floorPx, feeBps: E.feeBps, creatorShareBps: E.split.creator * 10000 / E.feeBps, tx: m.tx, v: 3, pair: ZERO, pairSym: 'HYPE', bridges: (SS[m.net] && SS[m.net].bridges || []).filter((b) => b.t === m.addr).length };
    v._usd = APP.hypeUsd; VIEW.set(m.addr, v); return v;
  }
  const trView = (x) => ({ wallet: x.w, buy: !!x.b, hype: x.h, tokens: x.k, usd: x.h * APP.hypeUsd, px: x.p, ts: x.ts, tx: x.tx, net: x.net, tax: x.tax });
  function candles(a, step) {
    const m = BY.get(low(a)); if (!m) return []; const out = []; let cur = null, last = (m.legs[m.net] || {}).p0 || 0;
    for (const x of [{ ts: m.createdAt, p: last, h: 0 }, ...m.trades.filter((t) => t.net === m.net)]) { const b = Math.floor(x.ts / step) * step; if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: last, h: Math.max(last, x.p), l: Math.min(last, x.p), c: x.p, v: 0 }; } cur.h = Math.max(cur.h, x.p); cur.l = Math.min(cur.l, x.p); cur.c = x.p; cur.v += x.h; last = x.p; }
    if (cur) out.push(cur); return out;
  }
  function holders(a) {
    const m = BY.get(low(a)); if (!m) return []; const tot = {};
    for (const l of Object.values(m.legs)) for (const [w, b] of l.holders) { const r = tot[w] || (tot[w] = { wallet: w, bal: 0, chains: {} }); r.bal += b; r.chains[l.net] = b; }
    const supply = Object.values(m.legs).reduce((s, l) => s + l.supply, 0) || SUPPLY;
    return Object.values(tot).map((r) => ({ ...r, chain: Object.keys(r.chains).join(' + '), share: (r.bal / supply) * 100, creator: r.wallet === m.creator, pool: false })).sort((x, y) => y.bal - x.bal);
  }
  // the coin's floor on each chain: where its band sits and how much of the price it covers
  const positions = (a) => { const m = BY.get(low(a)); if (!m) return []; return Object.values(m.legs).map((l) => ({ net: l.net, floorPx: l.floorP, px: l.p, cover: l.p > 0 ? Math.min(1, l.floorP / l.p) : 0, raises: l.raises.length })); };
  const feeState = () => ({ kind: 'base', bps: E.feeBps, total: E.feeBps });
  const tax = E.feeBps / 1e4;
  // estimates from the pool price (the swap is bounded by the Quoter at send time)
  function quoteBuy(a, net, hypeIn) { const m = BY.get(low(a)), l = m && m.legs[net || m.net]; if (!l || !l.p) return { tokens: 0, impact: 0 }; const tokens = (hypeIn * (1 - tax)) / l.p; return { tokens, impact: Math.min(99, (hypeIn / Math.max(1e-9, l.p * l.supply * 0.05)) * 100) }; }
  function quoteSell(a, net, tokensIn) { const m = BY.get(low(a)), l = m && m.legs[net || m.net]; if (!l || !l.p) return { hype: 0, impact: 0 }; return { hype: tokensIn * l.p * (1 - tax), impact: 0 }; }
  function balance(a, net, w) { const m = BY.get(low(a)); if (!m) return 0; w = low(w); let s = 0; for (const l of Object.values(m.legs)) { const h = l.holders.find(([x]) => x === w); if (h && (!net || net === 'hyper' || net === l.net)) s += h[1]; } return s; }
  async function refreshMine() {
    if (!APP.W.connected) return; const me = APP.W.address;
    await Promise.all(NETS().map(async (net) => { try { hypeBal[net] = Number(X.formatEther(BigInt(await rpc('eth_getBalance', [me, 'latest'], net, 3)))); } catch {} }));
  }

  // ---- writes
  const deadline = () => BigInt(now() + 900);
  const keyOf = (net, a) => [ZERO, X.getAddress(a), 0, 60, X.getAddress(K(net).hook)];
  function v4Swap(net, a, buy, amountIn, minOut) {
    const key = keyOf(net, a), cur1 = X.getAddress(a), actions = '0x060c0f'; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const swap = C.chainOf(net).hopLayout
      ? AC.encode(['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'], [[key, buy, amountIn, minOut, 0n, '0x']])
      : AC.encode(['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'], [[key, buy, amountIn, minOut, '0x']]);
    const params = [swap, AC.encode(['address', 'uint256'], [buy ? ZERO : cur1, amountIn]), AC.encode(['address', 'uint256'], [buy ? cur1 : ZERO, minOut])];
    return I.router.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], [actions, params])], deadline()]);
  }
  async function quoted(net, a, buy, amountIn) { try { const [out] = await call(K(net).quoter, I.quoter, 'quoteExactInputSingle', [[keyOf(net, a), buy, amountIn, '0x']], net); return out; } catch { return 0n; } }
  const wei = (v) => X.parseEther((Math.floor(Number(v) * 1e12) / 1e12).toFixed(12));
  async function allowUR(net, token, amount) {
    const me = APP.W.address, UR = K(net).router;
    const [[allow], p2] = await Promise.all([call(token, I.erc20, 'allowance', [me, PERMIT2], net), call(PERMIT2, I.permit2, 'allowance', [me, token, UR], net)]);
    if (allow < amount) { APP.toast('Approve the coin for trading (once per chain)', 'info', 6000); await send({ to: token, data: I.erc20.encodeFunctionData('approve', [PERMIT2, X.MaxUint256]) }, 'approve', net); }
    if (p2.amount < amount || Number(p2.expiration) < now() + 120) { APP.toast('Allow the swap router through Permit2', 'info', 6000); await send({ to: PERMIT2, data: I.permit2.encodeFunctionData('approve', [token, UR, (1n << 160n) - 1n, BigInt(now() + 30 * 86400)]) }, 'approve', net); }
  }
  async function after(blk, net) { for (let i = 0; i < 10; i++) { await load(true); if (!blk || ((SS[net] || {}).block || 0) >= blk) break; await new Promise((s) => setTimeout(s, 1500)); } await refreshMine(); APP.emit(); }

  const DATA = window.DATA = {
    mode: 'live',
    async ready() {
      await load(true);
      if (!listeners++) { setInterval(() => { if (!document.hidden) load(); }, 6000); setInterval(() => { if (!document.hidden) refreshMine(); }, 20000); APP.onWallet(() => { myBal.clear(); refreshMine(); }); refreshMine(); }
      return true;
    },
    async find(addr, ms = 45000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { await load(true); if (BY.has(low(addr))) return DATA.token(addr); await new Promise((r) => setTimeout(r, 2500)); } return null; },
    tokens() { return ALL.filter((m) => m.name).map(view).sort((a, b) => b.createdAt - a.createdAt); },
    raw(net) { return SS[net || C.chain.key] || null; },
    token(a) { const m = BY.get(low(a)); return m ? view(m) : null; },
    trades(a) { const m = BY.get(low(a)); return m ? m.trades.map(trView).reverse() : []; },
    candles, holders, positions, feeState, quoteBuy, quoteSell, balance,
    pairOf: () => null, pairBalance: async () => 0, refreshStockFees: async () => false,
    hypeBalance() { return APP.W.connected ? hypeBal[C.chain.key] || 0 : 0; },
    wallet(w) {
      w = low(w); const holdings = [], activity = []; let joined = 0;
      for (const m of ALL) {
        if (!m.name) continue; const v = view(m); let cost = 0;
        for (const tr of m.trades.filter((x) => x.w === w)) { cost += (tr.b ? 1 : -1) * tr.h * APP.hypeUsd; activity.push({ kind: tr.b ? 'buy' : 'sell', tokens: tr.k, hype: tr.h, usd: tr.h * APP.hypeUsd, ts: tr.ts, tx: tr.tx, token: v, net: tr.net }); if (!joined || tr.ts < joined) joined = tr.ts; }
        if (m.creator === w) { activity.push({ kind: 'launch', ts: m.createdAt, tx: m.tx, token: v }); if (!joined || m.createdAt < joined) joined = m.createdAt; }
        const bal = balance(m.addr, null, w); if (bal > 1) holdings.push({ token: v, bal, pxUsd: v.pxUsd, usd: bal * v.pxUsd, cost: Math.max(0, cost) });
      }
      return { address: w, joined, holdings: holdings.sort((a, b) => b.usd - a.usd), activity: activity.sort((a, b) => b.ts - a.ts), launches: ALL.filter((m) => m.name && m.creator === w).map(view) };
    },
    // the trader airdrop owed to `w` on each chain (earned minus claimed, from the indexer)
    airdrop(w) { w = low(w); const by = {}; for (const net of NETS()) { const a = ((SS[net] || {}).airdrops || {})[w] || { earned: 0, claimed: 0, n: 0 }; by[net] = { ...a, owed: Math.max(0, a.earned - a.claimed) }; } return { byChain: by, owed: Object.values(by).reduce((s, x) => s + x.owed, 0), earned: Object.values(by).reduce((s, x) => s + x.earned, 0) }; },
    creator(w) {
      w = low(w); const mine = ALL.filter((m) => m.name && m.creator === w).map((m) => {
        const v = view(m), earned = m.trades.reduce((s, x) => s + (x.toCreator || 0), 0);
        return { ...v, creatorFees: earned, pending: earned, unswept: 0, byChainFees: {} };
      });
      const air = DATA.airdrop(w);
      return { tokens: mine, lifetime: mine.reduce((s, x) => s + x.creatorFees, 0), pending: mine.reduce((s, x) => s + x.pending, 0) + air.owed, claimable: mine.reduce((s, x) => s + x.pending, 0) + air.owed, airdrop: air, stockFees: [], payout: 0, unswept: 0 };
    },
    stats() { const ts = DATA.tokens(); return { launches: ts.length, launches24: ts.filter((t) => t.createdAt > now() - 86400).length, vol24: ts.reduce((s, x) => s + x.vol24, 0), feesAll: ts.reduce((s, x) => s + x.feesAll, 0) }; },

    async buy(a, net, hype, minTokens) {
      const m = BY.get(low(a)); if (!m) throw new Error('Unknown coin'); net = m.legs[net] ? net : m.net;
      a = m.legs[net].addr; const amountIn = wei(hype), q = await quoted(net, a, true, amountIn);
      let minOut = wei(minTokens || 0); if (q && minOut > q) minOut = (q * 97n) / 100n; // the estimate overshot: bound by the Quoter
      const r = await send({ to: K(net).router, data: v4Swap(net, a, true, amountIn, minOut), value: amountIn }, 'buy', net);
      await after(parseInt(r.receipt.blockNumber, 16), net); return { tokens: Number(X.formatEther(q || minOut)), hash: r.hash };
    },
    async sell(a, net, tokens, minHype) {
      const m = BY.get(low(a)); if (!m) throw new Error('Unknown coin'); net = m.legs[net] ? net : m.net;
      a = m.legs[net].addr; const amountIn = wei(tokens); await allowUR(net, X.getAddress(a), amountIn);
      const q = await quoted(net, a, false, amountIn); let minOut = wei(minHype || 0); if (q && minOut > q) minOut = (q * 97n) / 100n;
      const r = await send({ to: K(net).router, data: v4Swap(net, a, false, amountIn, minOut) }, 'sell', net);
      await after(parseInt(r.receipt.blockNumber, 16), net); return { hype: Number(X.formatEther(q || minOut)), hash: r.hash };
    },
    // a coin on the current chain; the launch service puts it on the other chain right after (same address)
    async launch(p) {
      const net = C.chain.key, me = X.getAddress(APP.W.address), name = String(p.name).trim(), ticker = String(p.symbol).trim().toUpperCase();
      const post = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || u + ' failed'); return j; });
      const img = await post('/api/upload', { data: p.image }); // the logo, then the metadata JSON that names it (the launch's URI)
      const meta = await post('/api/meta', { name, ticker, description: p.description || '', image: img.url, x: p.x || '', telegram: p.telegram || '', website: p.website || '' });
      const salt = X.hexlify(X.randomBytes(32));
      const s = await fetch('/api/sign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: net, creator: me, salt, name, ticker }) }).then((r) => r.json());
      if (!s || !s.signature) throw new Error((s && s.error) || 'Could not sign the launch start');
      const [fee] = await call(K(net).factory, I.factory, 'launchFeeEth', [], net);
      const lp = [name, ticker, meta.url, salt, ZERO, 0n, 0n, s.tickStart, BigInt(s.deadline), s.signature, 0];
      const r = await send({ to: K(net).factory, data: I.factory.encodeFunctionData('launch', [lp]), value: fee }, 'launch', net);
      const log = r.receipt.logs.find((l) => low(l.address) === low(K(net).factory)); const token = log ? low(X.getAddress('0x' + log.topics[1].slice(26))) : '';
      fetch('/api/leg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chain: net, tx: r.hash, salt }) }).catch(() => {}); // the other chain, in the background
      await after(parseInt(r.receipt.blockNumber, 16), net); return { addr: token, hash: r.hash };
    },
    // claims everything the connected wallet is owed on the current chain: its trader airdrop and its coins' creator fees
    async claim() {
      const net = C.chain.key, me = X.getAddress(APP.W.address); let got = 0;
      const [owed] = await call(K(net).revenue, I.revenue, 'owed', [me, ZERO], net);
      if (owed > 0n) { await send({ to: K(net).revenue, data: I.revenue.encodeFunctionData('claim', [me, ZERO, me]) }, 'claim', net); got += Number(X.formatEther(owed)); }
      for (const m of ALL.filter((x) => x.creator === low(me) && x.legs[net])) { try { await send({ to: K(net).hook, data: I.hook.encodeFunctionData('claimCreator', [keyOf(net, m.legs[net].addr), me]) }, 'claim', net); } catch {} }
      await after(0, net); return got;
    },
    // moves `amount` of a coin from chain `from` to the other chain (its floor HYPE goes with it); the keeper delivers it
    async bridge(a, from, amount) {
      const to = C.liveChains().find((c) => c.key !== from); if (!to) throw new Error('No other chain');
      const m = BY.get(low(a)); if (!m || !m.legs[from] || !m.legs[to.key]) throw new Error('This coin is not on both chains yet');
      const r = await send({ to: K(from).bridge, data: I.bridge.encodeFunctionData('send', [X.getAddress(m.legs[from].addr), wei(amount), to.whChain, APP.W.address]) }, 'bridge', from);
      await after(parseInt(r.receipt.blockNumber, 16), from); return { hash: r.hash, to: to.key };
    },
  };
  DATA.demo = false;
})();
