/* Live data layer: the DATA interface on the LiquidFi contracts on every live chain (HyperEVM, Elysium).
   Reads: /api/state?chain=<key> (an indexer over each chain's event logs, cached by the CDN), refreshed every few
   seconds; every token carries the key of the chain it lives on (`net`), and trades go to that chain.
   Quotes: computed here from each pool's three locked liquidity bands and the hook's fee terms (no RPC per keystroke).
   Writes, through the connected wallet: factory.launch (logo uploaded first), buys and sells through Uniswap's
   UniversalRouter (V4 swap, native HYPE in or out), fee claims from the fee escrow.
   DATA: ready(), tokens(), token(addr), trades(addr), candles(addr, step), holders(addr), positions(addr), feeState(addr),
   quoteBuy(addr, chain, hype), quoteSell(addr, chain, tokens), balance(addr, chain, wallet), hypeBalance(), wallet(w),
   creator(w), stats(), buy(), sell(), launch(params), claim(). */
(function () {
  const C = window.CFG, E = C.econ, SUPPLY = E.supply, X = window.ethers;
  const KK = (net) => C.chainOf(net || C.chain.key).contracts, NETS = () => C.liveChains().map((c) => c.key);
  const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
  const Q96 = 2 ** 96, low = (a) => String(a || '').toLowerCase();
  const I = {
    factory: new X.Interface(['function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt,uint256 openingBuy,uint256 minTokensOut) params, uint256 launchConfigId) payable returns (address)', 'function previewLaunchEconomics(uint256) view returns (bytes32)', 'function launchFee() view returns (uint256)', 'function launchEnabled() view returns (bool)', 'function canLaunch(address) view returns (bool)', 'event TokenLaunched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 launchConfigId, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, uint256[3] positionIds)', 'error NotWhitelisted()', 'error LaunchFeeNotPaid()', 'error LogoRequired()', 'error InvalidTokenParams()', 'error LinkInDescription()', 'error CreatorTaxTooHigh()', 'error OpeningBuyTooLarge()', 'error EconomicsMismatch()', 'error LaunchConfigDisabled()']),
    erc20: new X.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']),
    permit2: new X.Interface(['function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)', 'function approve(address token, address spender, uint160 amount, uint48 expiration)']),
    router: new X.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']),
    escrow: new X.Interface(['function claim() returns (uint256)', 'function balanceOf(address) view returns (uint256)']),
    mc: new X.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])', 'function getEthBalance(address) view returns (uint256)']),
  };
  const AC = X.AbiCoder.defaultAbiCoder();

  // ---- RPC (reads and receipts; the public endpoint rate-limits, so every call retries)
  let rid = 0;
  async function rpc(method, params, tries = 7, net) {
    let last = ''; const ch = C.chainOf(net || C.chain.key);
    for (let i = 0; i < tries; i++) {
      try { const r = await fetch(ch.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) }); const j = await r.json().catch(() => null); if (j && !j.error) return j.result; last = (j && j.error && j.error.message) || 'HTTP ' + r.status; if (j && j.error && !/rate|limit|busy|not ready|timed out|unavailable/i.test(last)) { const e = new Error(last); e.data = j.error.data; throw e; } }
      catch (e) { if (e.data !== undefined || (e.message && !/rate|limit|busy|not ready|timed out|unavailable|fetch|HTTP/i.test(e.message))) throw e; last = e.message; }
      await new Promise((r) => setTimeout(r, Math.min(5000, 400 * 2 ** i)));
    }
    throw new Error(ch.name + ' RPC is busy, try again in a moment (' + last + ')');
  }
  const call = async (to, iface, fn, args, net) => iface.decodeFunctionResult(fn, await rpc('eth_call', [{ to, data: iface.encodeFunctionData(fn, args || []) }, 'latest'], 7, net));
  async function multicall(calls, net) {
    const data = I.mc.encodeFunctionData('aggregate3', [calls.map(([t, f, n, a]) => [t, true, f.encodeFunctionData(n, a || [])])]);
    const [res] = I.mc.decodeFunctionResult('aggregate3', await rpc('eth_call', [{ to: KK(net).multicall, data }, 'latest'], 7, net));
    return res.map(([ok, rd], i) => { if (!ok) return null; try { const r = calls[i][1].decodeFunctionResult(calls[i][2], rd); return r.length === 1 ? r[0] : r; } catch { return null; } });
  }
  async function receipt(hash, ms = 240000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const r = await rpc('eth_getTransactionReceipt', [hash], 3, C.chain.key).catch(() => null); if (r) { if (parseInt(r.status, 16) !== 1) throw new Error('Transaction reverted on ' + C.chain.name); return r; } await new Promise((s) => setTimeout(s, 1500)); }
    throw new Error('Still waiting for the transaction after 4 minutes; check it on the explorer');
  }
  function revertText(e) {
    const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof d === 'string' && d.length >= 10) for (const f of Object.values(I)) { try { const p = f.parseError(d); if (p) return p.name; } catch {} }
    const m = APP.errMsg(e); if (/timed? ?out|busy|unavailable/i.test(m)) return C.chain.name + "'s RPC is busy, so the wallet could not send. Try again in a moment.";
    return m;
  }
  async function send(tx, label) {
    await APP.W.require(); if (!APP.W.provider) throw new Error('Connect a wallet to ' + label);
    const signer = await new X.BrowserProvider(APP.W.provider).getSigner();
    try { await rpc('eth_call', [{ from: APP.W.address, to: tx.to, data: tx.data, value: tx.value ? '0x' + BigInt(tx.value).toString(16) : '0x0' }, 'latest'], 4); }
    catch (e) { if (e.data !== undefined) throw new Error(revertText(e)); } // a busy RPC does not block the send
    let sent; try { sent = await signer.sendTransaction(tx); } catch (e) { throw new Error(revertText(e)); }
    return receipt(sent.hash).then((r) => ({ hash: sent.hash, receipt: r }));
  }

  // ---- state from the indexer
  // one indexer state per chain; ALL is every token across chains, each tagged with its chain key
  const SS = {}, BY = new Map(), TR = new Map(); let ALL = [], VIEW = new Map(), loading = {}, listeners = 0;
  const myBal = new Map(), hypeBal = {}; let hypeFor = '';
  const stOf = (net) => SS[net] || { tokens: [], trades: [], escrow: {}, block: 0, skew: 0, poolManager: low(KK(net).poolManager) };
  const now = (net) => Math.floor(Date.now() / 1000) + (stOf(net || C.chain.key).skew || 0); // chain time: block timestamps can run ahead of this clock
  function index() {
    ALL = []; BY.clear(); TR.clear(); VIEW = new Map();
    for (const net of Object.keys(SS)) { for (const t of SS[net].tokens) { t.net = net; ALL.push(t); BY.set(t.addr, t); } for (const tr of SS[net].trades) (TR.get(tr.t) || TR.set(tr.t, []).get(tr.t)).push(tr); }
    for (const a of TR.values()) a.sort((x, y) => x.ts - y.ts || x.blk - y.blk);
  }
  async function load1(net, fresh) {
    if (loading[net]) return loading[net];
    loading[net] = (async () => { const r = await fetch('/api/state?chain=' + net + (fresh ? '&t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' }); if (!r.ok) throw new Error('state ' + r.status); const j = await r.json(); if (j.error) throw new Error(j.error); if (!SS[net] || j.block >= SS[net].block || fresh) { SS[net] = j; index(); APP.emit(); } })().finally(() => { loading[net] = null; });
    return loading[net];
  }
  const load = (fresh, net) => Promise.all((net ? [net] : NETS()).map((n) => load1(n, fresh).catch((e) => console.warn('state ' + n, e.message))));
  async function refreshMine() {
    const w = APP.W.connected ? APP.W.address : ''; if (!w) { hypeFor = ''; return; }
    const net = C.chain.key; try { hypeBal[net] = Number(X.formatEther(await rpc('eth_getBalance', [w, 'latest'], 4, net))); hypeFor = w; APP.emit(); } catch {}
  }

  // ---- pool math over the locked bands (floats in wei units; quotes only, the chain enforces the minimum)
  const sqrtAt = (tick) => Math.pow(1.0001, tick / 2);
  const poolOf = (t) => { const sq = t.sqrtP ? Number(t.sqrtP) / Q96 : null; return { sq, ranges: t.ranges.map((r) => ({ a: sqrtAt(r.lo), b: sqrtAt(r.hi), L: Number(r.liq) })) }; };
  const pxOf = (sq) => (sq > 0 ? 1 / (sq * sq) : 0); // HYPE per token: currency0 is HYPE, sqrtP is sqrt(token/HYPE)
  function swapSim(t, buy, amountIn) { // amountIn in wei (float); returns gross out in wei and the end sqrt price
    const P = poolOf(t); let sq = P.sq, rem = amountIn, out = 0; if (!sq || !P.ranges.length) return { out: 0, sq };
    for (let guard = 0; rem > 0 && guard < 12; guard++) {
      const L = P.ranges.reduce((s, r) => s + (buy ? (sq > r.a && sq <= r.b) : (sq >= r.a && sq < r.b)) * r.L, 0);
      const edges = P.ranges.flatMap((r) => [r.a, r.b]);
      const next = buy ? Math.max(...edges.filter((e) => e < sq * (1 - 1e-12)), -Infinity) : Math.min(...edges.filter((e) => e > sq * (1 + 1e-12)), Infinity);
      if (!isFinite(next)) break;
      if (!L) { sq = next; continue; }
      if (buy) { const need = L * (1 / next - 1 / sq); if (rem >= need) { out += L * (sq - next); rem -= need; sq = next; } else { const n = (L * sq) / (L + rem * sq); out += L * (sq - n); sq = n; rem = 0; } }
      else { const need = L * (next - sq); if (rem >= need) { out += L * (1 / sq - 1 / next); rem -= need; sq = next; } else { const n = sq + rem / L; out += L * (1 / sq - 1 / n); sq = n; rem = 0; } }
    }
    return { out, sq };
  }
  function bandsHeld(t) { // HYPE and tokens sitting in the pool now
    const P = poolOf(t); let h = 0, k = 0; if (!P.sq) return { hype: 0, tokens: 0 };
    for (const r of P.ranges) { const s = Math.min(Math.max(P.sq, r.a), r.b); h += r.L * (1 / s - 1 / r.b) / 1e18; k += r.L * (s - r.a) / 1e18; }
    return { hype: h, tokens: k };
  }

  // ---- fees, as the hook applies them
  function feeState(a) {
    const t = BY.get(low(a)); if (!t) return null; const T = t.terms || { launchedAt: t.createdAt, snipeStartBps: E.snipeStartBps, snipeSeconds: E.snipeSeconds, volExtraBps: 200, volDecay: E.volDecaySec, hookFeeBps: E.feeBps };
    const base = T.hookFeeBps ?? E.feeBps, n = now(t.net), el = n - T.launchedAt;
    let extra = 0, left = 0; if (t.lastSpike && T.volExtraBps && n - t.lastSpike < T.volDecay) { extra = Math.round(T.volExtraBps * (1 - (n - t.lastSpike) / T.volDecay)); left = T.volDecay - (n - t.lastSpike); }
    if (T.snipeSeconds && el >= 0 && el < T.snipeSeconds) { const s = T.snipeStartBps >> Math.floor((el * 14) / T.snipeSeconds); const sn = Math.min(s, 9900 - base - t.taxBps); return { kind: 'snipe', bps: base + t.taxBps, snipeBps: sn, left: T.snipeSeconds - el, total: base + t.taxBps + sn, extraBps: 0 }; }
    return { kind: extra > 0 ? 'vol' : 'base', bps: base + t.taxBps, extraBps: extra, left, total: base + t.taxBps + extra };
  }
  function quoteBuy(a, chain, hypeIn) {
    const t = BY.get(low(a)); const px = t ? pxOf(poolOf(t).sq) : 0; if (!t || !(hypeIn > 0)) return { tokens: 0, fee: 0, snipe: 0, px, impact: 0, feeBps: 0 };
    const fs = feeState(a), snipe = fs.kind === 'snipe' ? fs.snipeBps : 0, cutBps = Math.min(9900, fs.total);
    const sim = swapSim(t, true, hypeIn * 1e18), gross = sim.out / 1e18, tokens = gross * (1 - cutBps / 1e4), avg = gross > 0 ? hypeIn / gross : px;
    return { tokens, fee: gross * ((cutBps - snipe) / 1e4) * avg, snipe: gross * (snipe / 1e4) * avg, feeBps: cutBps, px, impact: px ? (pxOf(sim.sq) / px - 1) * 100 : 0 };
  }
  function quoteSell(a, chain, tokensIn) {
    const t = BY.get(low(a)); const px = t ? pxOf(poolOf(t).sq) : 0; if (!t || !(tokensIn > 0)) return { hype: 0, fee: 0, px, impact: 0, feeBps: 0 };
    const fs = feeState(a), cutBps = fs.kind === 'snipe' ? fs.bps : fs.total; const sim = swapSim(t, false, tokensIn * 1e18), gross = sim.out / 1e18;
    return { hype: gross * (1 - cutBps / 1e4), fee: gross * cutBps / 1e4, feeBps: cutBps, px, impact: px ? (pxOf(sim.sq) / px - 1) * 100 : 0 };
  }

  // ---- views in the shape the pages use
  const trView = (tr) => ({ tx: tr.tx, chain: 'hyper', wallet: tr.w, buy: !!tr.b, hype: tr.h, tokens: tr.k, fee: tr.f, feeBps: tr.fb, snipeBps: tr.s, volBps: tr.v, px: tr.p, ts: tr.ts });
  function startPx(t) { const r = t.ranges.length ? Math.max(...t.ranges.map((x) => x.hi)) : 0; return r ? pxOf(sqrtAt(r)) : E.openMcapHype / SUPPLY; }
  function poolView(t) {
    const trs = TR.get(t.addr) || [], px = t.sqrtP ? pxOf(poolOf(t).sq) : startPx(t), n = now(t.net), held = bandsHeld(t);
    const pxAgo = (s) => { const cut = n - s; for (let i = trs.length - 1; i >= 0; i--) if (trs[i].ts <= cut) return trs[i].p; return t.createdAt <= cut ? (trs[0] ? startPx(t) : px) : startPx(t); };
    let vol24 = 0, volAll = 0, feesAll = 0, buys24 = 0, sells24 = 0; for (const tr of trs) { volAll += tr.h; feesAll += tr.f; if (tr.ts > n - 86400) { vol24 += tr.h; tr.b ? buys24++ : sells24++; } }
    return { chain: 'hyper', px, pxUsd: px * APP.hypeUsd, mcap: px * SUPPLY, liqHype: held.hype + held.tokens * px, hypeInPool: held.hype, vol24, volAll, feesAll, trades: trs.length, buys24, sells24, c5: (px / pxAgo(300) - 1) * 100, c1: (px / pxAgo(3600) - 1) * 100, c24: (px / pxAgo(86400) - 1) * 100, inPool: held.tokens, poolId: t.poolId, lockedIds: t.posIds, fee: feeState(t.addr), lastTs: trs.length ? trs[trs.length - 1].ts : t.createdAt };
  }
  const isPool = (t, w) => { const k = KK(t.net); return w === low(k.poolManager) || w === low(k.locker) || w === low(k.factory) || w === low(k.hook); };
  function view(t) {
    if (VIEW.has(t.addr)) return VIEW.get(t.addr);
    const m = poolView(t), T = t.terms || {};
    const v = { addr: t.addr, mint: '', name: t.name, symbol: t.symbol, emoji: '', img: t.logo || APP.defaultImg(t.symbol, t.addr), desc: t.desc, links: { x: (t.socials || {}).x || '', tg: (t.socials || {}).tg || '', web: (t.socials || {}).web || '' }, creator: t.creator, feeRecipient: t.feeRecipient, creatorSol: '', createdAt: t.createdAt, age: APP.ago(t.createdAt), chains: ['hyper'], byChain: { hyper: m }, net: t.net, chainName: C.chainOf(t.net).name,
      px: m.px, pxUsd: m.pxUsd, mcap: m.mcap, mcapUsd: m.mcap * APP.hypeUsd, liqHype: m.liqHype, vol24: m.vol24, volAll: m.volAll, feesAll: m.feesAll, trades: m.trades, buys24: m.buys24, sells24: m.sells24, holders: t.holders.filter(([w]) => !isPool(t, w)).length, c5: m.c5, c1: m.c1, c24: m.c24,
      creatorTaxBps: t.taxBps, buyback: t.buyback, feeBps: T.hookFeeBps ?? E.feeBps, creatorShareBps: 10000 - (T.protocolShareBps ?? E.protocolShareBps), lastTs: m.lastTs, fee: m.fee, tx: t.tx, poolId: t.poolId };
    VIEW.set(t.addr, v); return v;
  }
  function holders(a) {
    const t = BY.get(low(a)); if (!t) return [];
    return t.holders.map(([w, bal]) => ({ wallet: w === low(KK(t.net).poolManager) ? 'Pool (Uniswap v4)' : w, chain: 'hyper', bal, share: (bal / SUPPLY) * 100, creator: w === t.creator, pool: isPool(t, w) })).sort((x, y) => y.bal - x.bal);
  }
  function candles(a, step) {
    const t = BY.get(low(a)); if (!t) return []; const trs = TR.get(t.addr) || []; const out = []; let cur = null; let last = startPx(t);
    const pts = [{ ts: t.createdAt, p: last, h: 0 }, ...trs.map((x) => ({ ts: x.ts, p: x.p, h: x.h }))];
    for (const x of pts) { const b = Math.floor(x.ts / step) * step; if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: last, h: Math.max(last, x.p), l: Math.min(last, x.p), c: x.p, v: 0 }; } cur.h = Math.max(cur.h, x.p); cur.l = Math.min(cur.l, x.p); cur.c = x.p; cur.v += x.h; last = x.p; }
    if (cur) out.push(cur); return out;
  }
  function positions(a) {
    const t = BY.get(low(a)); if (!t) return []; const mc = view(t).mcap;
    return E.bands.map(([lo, hi, pct], i) => ({ id: t.posIds[i], pct, lo, hi, tokens: (SUPPLY * pct) / 100, active: mc >= lo && mc < hi, filled: Math.max(0, Math.min(1, (mc - lo) / ((hi === Infinity ? lo * 20 : hi) - lo))) }));
  }
  function balance(a, chain, w) {
    const k = low(a) + ':' + low(w); if (myBal.has(k)) return myBal.get(k);
    const t = BY.get(low(a)); if (!t || !w) return 0; const r = t.holders.find(([x]) => x === low(w)); return r ? r[1] : 0;
  }
  async function exactBalance(a, w) { const t = BY.get(low(a)); const [b] = await call(a, I.erc20, 'balanceOf', [w], t && t.net); myBal.set(low(a) + ':' + low(w), Number(X.formatEther(b))); return b; }
  function creatorAccrued(t) { const T = t.terms || {}, share = 1 - (T.protocolShareBps ?? 3000) / 1e4; let acc = 0; for (const tr of TR.get(t.addr) || []) acc += (tr.ft || 0) * share + (tr.fx || 0); return acc; }

  // ---- writes
  const deadline = () => BigInt(now() + 900);
  const keyOf = (t) => [X.ZeroAddress, X.getAddress(t.addr), 0, 200, X.getAddress(KK(t.net).hook)];
  const onChainOf = async (t) => { if (C.chain.key !== t.net) await APP.setChain(t.net, false); }; // trade on the token's chain
  function v4Swap(t, buy, amountIn, minOut) {
    const key = keyOf(t), cur0 = X.ZeroAddress, cur1 = X.getAddress(t.addr);
    const actions = '0x060c0f'; // SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL
    const params = [
      AC.encode(['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'], [[key, buy, amountIn, minOut, '0x']]),
      AC.encode(['address', 'uint256'], [buy ? cur0 : cur1, amountIn]),
      AC.encode(['address', 'uint256'], [buy ? cur1 : cur0, minOut]),
    ];
    return I.router.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], [actions, params])], deadline()]);
  }
  const wei = (v) => X.parseEther((Math.floor(Number(v) * 1e12) / 1e12).toFixed(12));
  async function afterTrade(a) { const t = BY.get(low(a)); await Promise.all([load(true, t && t.net), refreshMine(), APP.W.connected ? exactBalance(a, APP.W.address).catch(() => {}) : null]); APP.emit(); }

  const DATA = window.DATA = {
    mode: 'live',
    async ready() {
      await load(); if (!ALL.length && !Object.keys(SS).length) setTimeout(() => load(), 3000);
      if (!listeners++) { setInterval(() => { if (!document.hidden) load(); }, 6000); setInterval(() => { if (!document.hidden) refreshMine(); }, 20000); APP.onWallet(() => { myBal.clear(); refreshMine(); }); refreshMine(); }
      return true;
    },
    tokens() { return ALL.filter((t) => t.name).map(view).sort((a, b) => b.createdAt - a.createdAt); },
    token(a) { const t = BY.get(low(a)); return t ? view(t) : null; },
    trades(a) { return (TR.get(low(a)) || []).map(trView).reverse(); },
    candles, holders, positions, feeState, quoteBuy, quoteSell, balance,
    hypeBalance() { return APP.W.connected && low(hypeFor) === low(APP.W.address) ? hypeBal[C.chain.key] || 0 : 0; },
    wallet(w) {
      w = low(w); const holdings = [], activity = []; let joined = 0;
      for (const t of ALL) {
        if (!t.name) continue; const v = view(t); const mine = (TR.get(t.addr) || []).filter((x) => x.w === w); let cost = 0;
        for (const tr of mine) { cost += (tr.b ? 1 : -1) * tr.h * APP.hypeUsd; activity.push({ kind: tr.b ? 'buy' : 'sell', tokens: tr.k, hype: tr.h, usd: tr.h * APP.hypeUsd, ts: tr.ts, tx: tr.tx, token: v }); if (!joined || tr.ts < joined) joined = tr.ts; }
        if (t.creator === w) { activity.push({ kind: 'launch', ts: t.createdAt, tx: t.tx, token: v }); if (!joined || t.createdAt < joined) joined = t.createdAt; }
        const bal = balance(t.addr, 'hyper', w); if (bal > 1) holdings.push({ token: v, bal, pxUsd: v.pxUsd, usd: bal * v.pxUsd, cost: Math.max(0, cost) });
      }
      const hb = Object.values(hypeBal).reduce((s, x) => s + x, 0); if (w === low(APP.W.address) && hb > 0) holdings.unshift({ native: true, bal: hb, pxUsd: APP.hypeUsd, usd: hb * APP.hypeUsd, cost: 0 });
      return { address: w, joined, holdings: holdings.sort((a, b) => b.usd - a.usd), activity: activity.sort((a, b) => b.ts - a.ts), launches: ALL.filter((t) => t.name && t.creator === w).map(view).sort((a, b) => b.createdAt - a.createdAt) };
    },
    creator(w) {
      w = low(w); const byNet = {}; for (const net of Object.keys(SS)) { const e = SS[net].escrow[w] || { credited: 0, claimed: 0 }; byNet[net] = Math.max(0, e.credited - e.claimed); }
      const claimable = Object.values(byNet).reduce((s, x) => s + x, 0);
      const mine = ALL.filter((t) => t.name && (t.feeRecipient === w || t.creator === w)).map((t) => { const v = view(t); const acc = creatorAccrued(t); const paid = t.swept.creator + t.swept.buyback, unswept = Math.max(0, acc - paid); return { ...v, creatorFees: Math.max(acc, paid), pending: unswept, unswept, byChainFees: { hyper: acc }, bbVested: t.vest.released }; });
      return { tokens: mine, lifetime: mine.reduce((s, x) => s + x.creatorFees, 0), pending: claimable, claimable, claimableByChain: byNet, unswept: mine.reduce((s, x) => s + x.unswept, 0) };
    },
    stats() { const ts = DATA.tokens(); return { launches: ts.length, launches24: ts.filter((t) => t.createdAt > now() - 86400).length, vol24: ts.reduce((s, x) => s + x.vol24, 0), feesAll: ts.reduce((s, x) => s + x.feesAll, 0), creatorsPaid: Object.values(SS).reduce((s, st) => s + Object.values(st.escrow).reduce((u, x) => u + x.credited, 0), 0) }; },

    async buy(a, chain, hype, minOut) {
      const t = BY.get(low(a)); if (!t) throw new Error('Unknown token'); await onChainOf(t);
      const amountIn = wei(hype), min = wei(Math.max(0, minOut)), hb = hypeBal[t.net];
      if (hb && hype > hb) throw new Error('Not enough HYPE on ' + C.chain.name);
      const r = await send({ to: KK(t.net).router, data: v4Swap(t, true, amountIn, min), value: amountIn, gasLimit: 700000n }, 'buy');
      await afterTrade(a); return { tx: r.hash, buy: true, hype, tokens: quoteBuy(a, chain, hype).tokens };
    },
    async sell(a, chain, tokens, minOut) {
      const t = BY.get(low(a)); if (!t) throw new Error('Unknown token'); await onChainOf(t); await APP.W.require(); const me = APP.W.address, UR = KK(t.net).router;
      const have = await exactBalance(a, me); let amount = wei(tokens); if (amount > have || Number(X.formatEther(have)) - tokens < 1e-6) amount = have; if (amount <= 0n) throw new Error('Not enough tokens');
      const [[allow], p2] = await Promise.all([call(a, I.erc20, 'allowance', [me, PERMIT2], t.net), call(PERMIT2, I.permit2, 'allowance', [me, a, UR], t.net)]);
      if (allow < amount) { APP.toast('Approve the token for trading (once)', 'info', 6000); await send({ to: a, data: I.erc20.encodeFunctionData('approve', [PERMIT2, X.MaxUint256]), gasLimit: 120000n }, 'approve'); }
      if (p2.amount < amount || Number(p2.expiration) < now() + 120) { APP.toast('Allow the swap router through Permit2 (once a month)', 'info', 6000); await send({ to: PERMIT2, data: I.permit2.encodeFunctionData('approve', [a, UR, (1n << 160n) - 1n, BigInt(now() + 30 * 86400)]), gasLimit: 120000n }, 'approve'); }
      const r = await send({ to: UR, data: v4Swap(t, false, amount, wei(Math.max(0, minOut))), gasLimit: 700000n }, 'sell');
      await afterTrade(a); return { tx: r.hash, buy: false, tokens, hype: quoteSell(a, chain, tokens).hype };
    },
    async launch(p) {
      await APP.W.require(); const me = APP.W.address, net = C.chain.key, K = KK(net);
      if (!C.live(C.chain)) throw new Error('LiquidFi is not live on ' + C.chain.name + ' yet');
      if (!p.image) throw new Error('Add an image for the token');
      const logo = await uploadLogo(p.image);
      const [econ, fee, enabled, can] = await multicall([[K.factory, I.factory, 'previewLaunchEconomics', [0]], [K.factory, I.factory, 'launchFee'], [K.factory, I.factory, 'launchEnabled'], [K.factory, I.factory, 'canLaunch', [me]]], net);
      if (!enabled && !can) throw new Error('Launches are paused right now');
      const opening = wei(p.devBuy || 0), salt = X.hexlify(X.randomBytes(32));
      const params = { name: p.name, symbol: p.symbol, logo, description: p.description || '', socials: { twitter: p.x || '', telegram: p.telegram || '', discord: '', website: p.website || '', farcaster: '' }, creatorFeeRecipient: p.feeWallet && X.isAddress(p.feeWallet) ? X.getAddress(p.feeWallet) : X.ZeroAddress, creatorTaxBps: p.creatorTaxBps || 0, buybackEnabled: !!p.buyback, expectedEconomics: econ || X.ZeroHash, salt, openingBuy: opening, minTokensOut: opening > 0n ? 1n : 0n };
      const r = await send({ to: K.factory, data: I.factory.encodeFunctionData('launch', [params, 0]), value: (fee ?? X.parseEther(String(E.launchFeeHype))) + opening, gasLimit: 2500000n }, 'launch'); // under HyperEVM's 3M small-block limit (a launch uses about 1.6M)
      const lg = r.receipt.logs.map((l) => { try { return I.factory.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
      const addr = lg ? low(lg.args.token) : '';
      for (let i = 0; i < 20 && addr && !BY.has(addr); i++) { await load(true, net); if (!BY.has(addr)) await new Promise((s) => setTimeout(s, 3000)); }
      refreshMine(); return { addr, tx: r.hash };
    },
    async claim() { // every chain with something claimable, one transaction each, on that chain
      await APP.W.require(); const by = DATA.creator(APP.W.address).claimableByChain; let got = 0;
      for (const [net, amt] of Object.entries(by)) { if (!(amt > 0)) continue; if (C.chain.key !== net) await APP.setChain(net, false); await send({ to: KK(net).escrow, data: I.escrow.encodeFunctionData('claim()', []), gasLimit: 150000n }, 'claim'); got += amt; }
      if (!got) throw new Error('Nothing to claim yet'); await Promise.all([load(true), refreshMine()]); return got; },
  };

  // the logo: squared and scaled to 512 px (PNG), uploaded to the Blob store; the URL goes onchain
  async function uploadLogo(dataUrl) {
    const img = await new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('Could not read the image')); im.src = dataUrl; });
    const s = Math.min(img.width, img.height), size = Math.min(512, s), cv = document.createElement('canvas'); cv.width = cv.height = size;
    cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    let data = cv.toDataURL('image/webp', 0.9); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/png');
    const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) }); const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) throw new Error(j.error || 'Logo upload failed'); return j.url;
  }
})();
