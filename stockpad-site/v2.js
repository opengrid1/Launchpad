/* Equo v2 on the site. Every coin launches on several EVM chains at once, one 1B pool per chain, each chain with
   its own coin address. This replaces the first contracts' coin list: the site lists Equo v2 coins only.
   - list: the indexer's v2 coins (/api/coins?gen=2) with their metadata (/api/v2/meta);
   - live reads per chain: pool price and liquidity, the last-buyer pot, the crash shield and the fee right now;
   - trades on any chain through that chain's Equo router, in its native coin, with the wallet switched there;
   - launch: a signed snapshot from the launch service, the creator's own leg from their wallet (paying the launch
     fee and their buy), then the service launches every other leg;
   - the admin's collect on every chain of a coin, signed by the admin wallet and sent by the service.
   Coin amounts on chain have 9 decimals; native amounts 18. Exposes window.V2. Loaded after api.js. */
(function () {
  const cfg = window.INKY || {}, C = window.CHAIN;
  if (!C || !C._lib) return;
  const E = C._lib.ethers;
  const lc = (a) => String(a || '').toLowerCase();
  const CH = (cfg.chains || []).filter((c) => c.v2 && c.evm !== false);
  const chain = (k) => CH.find((c) => c.key === k) || null;
  const Q96 = 2n ** 96n;
  const POOLS_SLOT = 6n;
  const OPEN_USD = 3000 / 1e9; // every chain's 1B opens at a $3,000 market cap

  const FACTORY = [
    'function launch((bytes32 launchId,address creator,string name,string symbol,string metadataURI,uint16 feeBps,uint64 deadline,uint32 feeEid,uint256 launchFeeUsd18,(uint32 eid,bytes32 coin,bytes32 legSalt,bytes32 pair,uint256 slice,uint256 quoteUsd18)[] legs) s, bytes signature, uint256 pairIn) payable returns (address)',
    'function launched(bytes32) view returns (bool)',
    'function positions(address) view returns (int24 tickLower, int24 tickUpper, uint128 liquidity)',
    'function transferCreator(address token, address to)',
    'function acceptCreator(address token)',
  ];
  const HOOK = [
    'function pots(address) view returns (uint128 amount, uint128 minBuy, address lastBuyer, uint64 deadline, uint32 round)',
    'function shieldOf(address) view returns (uint256)',
    'function feeNow(address token, bool sell) view returns (uint256)',
    'function creatorOwed(address) view returns (uint256)',
    'function creatorOf(address) view returns (address)',
    'function wonOf(address token, address winner) view returns (uint256)',
    'function config(address) view returns ((address token, address pair, uint16 feeBps, bool registered, uint160 floorSqrtPriceX96))',
    'function payCreator(address token) returns (uint256)',
    'function settleRound(address token) returns (address winner, uint256 amount)',
    'function payWinner(address token, address winner) returns (uint256)',
  ];
  const ROUTER = [
    'function buy(address coin, bytes route, uint256 minCoinOut) payable returns (uint256)',
    'function sell(address coin, uint256 amountIn, bytes route, uint256 minEthOut) returns (uint256)',
  ];
  const COIN = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
    'function approve(address, uint256) returns (bool)',
  ];
  const PM = ['function extsload(bytes32) view returns (bytes32)'];

  // ---------------------------------------------------------------- reads
  const provs = new Map();
  const prov = (k) => { if (!provs.has(k)) { const c = chain(k); provs.set(k, new E.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true })); } return provs.get(k); };
  const ro = (k, a, abi) => new E.Contract(a, abi, prov(k));
  const api = (p, opt) => fetch(p, { ...(opt || {}), signal: AbortSignal.timeout(opt && opt.timeout || 20000) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; });

  const COINS = new Map(); // main address -> coin
  const BY = new Map(); // any leg address -> main address
  const META = new Map();
  const ORDER = CH.map((c) => c.key);

  async function meta(uri) {
    if (!uri) return {};
    if (META.has(uri)) return META.get(uri);
    let m = {};
    try { const u = new URL(uri, location.origin); if (/\/api\/v2\/meta$/.test(u.pathname)) m = await api(u.pathname + u.search); } catch { m = {}; }
    META.set(uri, m);
    return m;
  }

  const ageOf = (ts) => { const s = Math.max(0, Math.floor(Date.now() / 1000) - ts); return s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
  function build(j, m, old) {
    const keys = ORDER.filter((k) => j.chains[k]);
    const main = (j.chains.eth || j.chains[keys[0]]).token;
    const x = old || {};
    Object.assign(x, {
      v2: true, addr: lc(main), addrs: Object.fromEntries(keys.map((k) => [k, lc(j.chains[k].token)])), chains: keys,
      launchId: j.launchId, n: j.name || '', t: j.symbol || '', creator: lc(j.creator), createdAt: j.createdAt, age: ageOf(j.createdAt),
      feeBps: j.feeBps || 100, img: m.image || '', desc: m.description || '', links: { web: m.website || '', x: m.x || '', tg: m.telegram || '' },
      mc: j.mc || x.mc || 0, vol: j.vol24 || 0, trades: j.trades || 0, c24: j.change24 || 0, px: j.price || x.px || 0,
      supplyAll: j.supply || keys.length * 1e9, pair: (chain(keys[0]) || {}).native || 'ETH',
    });
    x.byChain = x.byChain || {};
    x.pools = x.pools || {};
    for (const k of keys) {
      const c = j.chains[k], b = x.byChain[k] || (x.byChain[k] = {});
      b.token = lc(c.token); b.poolId = c.poolId; if (c.price) b.px = c.price; b.vol = c.vol24 || 0; b.trades = c.trades24 || 0;
      if (c.supply) b.supply = Number(c.supply) / 1e18;
      if (c.pool) { x.pools[k] = c.pool; if (c.pool.priceUsd && c.pool.priceInPair) b.pairUsd = c.pool.priceUsd / c.pool.priceInPair; if (c.pool.liquidityUsd != null) b.liq = c.pool.liquidityUsd; if (c.pool.priceUsd) b.px = c.pool.priceUsd; }
      if (!b.pairUsd && NUSD[k]) b.pairUsd = NUSD[k];
    }
    if (j.holders != null) x.h = j.holders;
    if (j.liquidity) x.liq = j.liquidity;
    if (j.poolsLive != null) x.poolsLive = j.poolsLive;
    if (!x.px) { const p = keys.map((k) => x.byChain[k].px).filter(Boolean); x.px = p.length ? p.reduce((a, b) => a + b, 0) / p.length : OPEN_USD; }
    if (!x.mc && x.px) x.mc = x.px * x.supplyAll;
    const pu = (x.byChain[keys[0]] || {}).pairUsd; x.pairUsd = pu || 0; x.pxPair = pu ? x.px / pu : 0;
    for (const k of keys) BY.set(lc(j.chains[k].token), x.addr);
    return x;
  }

  let loaded = false;
  async function loadAll() {
    const j = await api('/api/coins?gen=2&limit=200');
    const hide = new Set((cfg.hiddenCoins || []).map(lc));
    await Promise.all((j.coins || []).map(async (c) => {
      const m = await meta(c.metadataURI);
      const main = lc((c.chains.eth || Object.values(c.chains)[0]).token);
      const x = build(c, m, COINS.get(main));
      if (hide.has(x.addr)) x.hidden = true;
      COINS.set(x.addr, x);
    }));
    loaded = true;
    dispatchEvent(new Event('chain-update'));
  }

  /** One coin from the indexer with every chain's pool read live (holders, liquidity, pool prices). */
  async function detail(addr) {
    const j = await api('/api/coin?coin=' + lc(addr));
    const main = lc((j.chains.eth || Object.values(j.chains)[0]).token);
    const x = build(j, await meta(j.metadataURI), COINS.get(main));
    COINS.set(x.addr, x);
    return x;
  }

  /** The pool's price and in-range liquidity on chain k, from the PoolManager's storage. */
  async function poolState(k, poolId) {
    const c = chain(k), pm = ro(k, c.poolManager, PM);
    const base = BigInt(E.keccak256(E.AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [poolId, POOLS_SLOT])));
    const [s0, liq] = await Promise.all([pm.extsload(E.toBeHex(base, 32)), pm.extsload(E.toBeHex(base + 3n, 32))]);
    return { sqrtP: BigInt(s0) & ((1n << 160n) - 1n), L: BigInt(liq) & ((1n << 128n) - 1n) };
  }

  /** Everything live about a coin on chain k: pool, pot, shield, fees, creator fees. */
  async function live(x, k) {
    const token = x.addrs[k], c = chain(k), h = ro(k, c.v2.hook, HOOK);
    const poolId = (x.byChain[k] || {}).poolId;
    const [pool, pot, shield, feeBuy, feeSell, owed, conf] = await Promise.all([
      poolId ? poolState(k, poolId) : null, h.pots(token), h.shieldOf(token), h.feeNow(token, false), h.feeNow(token, true), h.creatorOwed(token), h.config(token),
    ]);
    const out = {
      chain: k, token, pool, floor: BigInt(conf.floorSqrtPriceX96), shieldBps: Number(shield), feeBuyBps: Number(feeBuy), feeSellBps: Number(feeSell), creatorOwed: owed,
      pot: { amount: pot.amount, minBuy: pot.minBuy, lastBuyer: lc(pot.lastBuyer), deadline: Number(pot.deadline), round: Number(pot.round) },
    };
    // price in native per whole coin: (sqrtP / 2^96)^2 is native wei per coin unit (9 decimals)
    if (pool && pool.sqrtP) { const s = Number(pool.sqrtP) / 2 ** 96; out.priceNative = s * s * 1e9 / 1e18; }
    x.live = x.live || {}; x.live[k] = out;
    return out;
  }

  /** What a trade gets right now on chain k: buy with `amountIn` native wei, or sell `amountIn` coin units. */
  function quote(lv, side, amountIn) {
    const { sqrtP, L } = lv.pool || {};
    amountIn = BigInt(amountIn);
    if (!sqrtP || !L || amountIn <= 0n) return { out: 0n, limited: false };
    if (side === 'buy') {
      const fee = (amountIn * BigInt(lv.feeBuyBps)) / 10000n, x = amountIn - fee;
      const sNew = sqrtP + (x * Q96) / L;
      return { out: (L * Q96 * (sNew - sqrtP)) / sNew / sqrtP, fee, limited: false };
    }
    let sNew = (L * Q96 * sqrtP) / (L * Q96 + amountIn * sqrtP), limited = false;
    if (lv.floor && sNew < lv.floor) { sNew = lv.floor; limited = true; }
    const gross = (L * (sqrtP - sNew)) / Q96, fee = (gross * BigInt(lv.feeSellBps)) / 10000n;
    return { out: gross - fee, fee, limited };
  }

  // ---------------------------------------------------------------- wallet
  const wallet = () => window.inkyWallet;
  const me = () => (wallet() && wallet().connected && wallet().address ? lc(wallet().address) : '');
  async function signerOn(k) {
    const W = wallet(), c = chain(k);
    if (!W || !W.connected) throw new Error('Connect a wallet');
    let s = await W.getSigner();
    if (Number((await s.provider.getNetwork()).chainId) === c.chainId) return s;
    const hex = '0x' + c.chainId.toString(16);
    try { await s.provider.send('wallet_switchEthereumChain', [{ chainId: hex }]); }
    catch (e) {
      const m = String((e && (e.message || (e.error && e.error.message))) || '');
      if ((e && (e.code === 4902 || (e.error && e.error.code === 4902))) || /unrecognized|not been added|unknown chain|4902/i.test(m)) {
        await s.provider.send('wallet_addEthereumChain', [{ chainId: hex, chainName: c.name, nativeCurrency: { name: c.native, symbol: c.native, decimals: 18 }, rpcUrls: [c.rpc], blockExplorerUrls: [c.explorer] }]);
      } else throw e;
    }
    s = await W.getSigner();
    if (Number((await s.provider.getNetwork()).chainId) !== c.chainId) throw new Error('Switch your wallet to ' + c.name);
    return s;
  }
  const mined = async (tx) => { const rc = await tx.wait(); if (!rc || rc.status !== 1) throw new Error('Transaction failed'); return rc; };

  async function balances(x, k, who) {
    who = who || me();
    if (!who) return { coin: 0n, native: 0n };
    const [coin, native] = await Promise.all([ro(k, x.addrs[k], COIN).balanceOf(who), prov(k).getBalance(who)]);
    return { coin, native };
  }

  async function buy(x, k, weiIn, minOut) {
    const s = await signerOn(k);
    const r = new E.Contract(chain(k).v2.router, ROUTER, s);
    return mined(await r.buy(x.addrs[k], '0x', minOut, { value: weiIn }));
  }
  async function sell(x, k, coinIn, minOut) {
    const s = await signerOn(k), who = lc(await s.getAddress()), c = chain(k);
    const coin = new E.Contract(x.addrs[k], COIN, s);
    if ((await coin.allowance(who, c.v2.router)) < coinIn) await mined(await coin.approve(c.v2.router, E.MaxUint256));
    const r = new E.Contract(c.v2.router, ROUTER, s);
    return mined(await r.sell(x.addrs[k], coinIn, '0x', minOut));
  }
  async function payCreator(x, k) { const s = await signerOn(k); return mined(await new E.Contract(chain(k).v2.hook, HOOK, s).payCreator(x.addrs[k])); }
  async function settle(x, k) { const s = await signerOn(k); return mined(await new E.Contract(chain(k).v2.hook, HOOK, s).settleRound(x.addrs[k])); }

  // ---------------------------------------------------------------- launch
  const feeQuote = (keys, home) => api(`/api/v2/quote-fee?chains=${keys.join(',')}&home=${home}`);

  /** Launch: quote and sign, the creator's own leg from their wallet, then the service's legs. `on(step, info)`
   *  reports progress: 'quote', 'wallet', 'sent', 'home', 'others', 'done'. */
  async function launch(form, on = () => {}) {
    const creator = me();
    if (!creator) throw new Error('Connect a wallet');
    on('quote');
    const q = await api('/api/v2/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...form, creator }), timeout: 60000 });
    const s = await signerOn(q.home);
    const f = new E.Contract(q.factory, FACTORY, s);
    const value = BigInt(q.launchFeeWei) + BigInt(form.devBuyWei || 0);
    on('wallet', q);
    const tx = await f.launch(q.snapshot, q.signature, 0n, { value });
    on('sent', { ...q, tx: tx.hash });
    await mined(tx);
    on('home', q);
    let done = null;
    if (q.snapshot.legs.length > 1) {
      for (let i = 0; i < 4 && !done; i++) {
        try { done = await api('/api/v2/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: q.snapshot, signature: q.signature }), timeout: 60000 }); }
        catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 4000)); }
      }
      on('others', { ...q, sent: done.sent });
    }
    return q;
  }
  const launchStatus = (q) => api('/api/v2/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: q.snapshot }) });
  /** Another round of the service's work on a launch (a Solana leg takes a few). */
  const complete = (q) => api('/api/v2/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snapshot: q.snapshot, signature: q.signature }), timeout: 70000 });

  /** The admin's collect of `bps` of a coin's pools on every chain, sent by the service, paid to the admin. */
  async function collect(x, bps) {
    const W = wallet();
    if (!W || !W.connected) throw new Error('Connect the admin wallet');
    const s = await W.getSigner(), ts = Math.floor(Date.now() / 1000);
    const msg = `Equo collect\nlaunch: ${lc(x.launchId)}\nshare: ${bps} bps\ntime: ${ts}`;
    const signature = await s.signMessage(msg);
    return api('/api/v2/collect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ launchId: lc(x.launchId), bps, ts, signature }), timeout: 60000 });
  }

  // ---------------------------------------------------------------- the chain layer's coin list is v2 only
  C.tokens = () => [...COINS.values()];
  C.token = (a) => { const m = BY.get(lc(a)); return (m && COINS.get(m)) || null; };
  const tp = C.tradePrice;
  C.tradePrice = (t) => (t && t.usd != null ? t.usd : tp ? tp(t) : 0);
  const tr = C.trades;
  C.trades = async (a, ...r) => {
    const x = C.token(a);
    if (!x) return tr ? tr(a, ...r) : [];
    const j = await api(`/api/trades?coin=${x.addr}&limit=500`);
    return j.trades.map((t) => ({ token: t.token, wallet: t.wallet, buy: t.buy, coin: t.coin, pair: t.pair, fee: t.fee, block: t.block, ts: t.ts, tx: t.tx, index: t.index, chain: t.chain, usd: t.priceUsd, value: t.valueUsd })).reverse();
  };
  const rf = C.refresh;
  C.refresh = async (a, ...r) => { const x = C.token(a); if (!x) return rf ? rf(a, ...r) : null; return detail(x.addr).catch(() => x); };

  // native prices for the shell (the ETH price in the footer and USD values): the service's, refreshed every minute
  const NUSD = {};
  const WETH = lc(cfg.weth);
  async function prices() {
    try { Object.assign(NUSD, (await api('/api/v2/prices')).nativeUsd || {}); } catch { /* keep the last */ }
    // coins read before the prices arrived take each chain's native price now
    for (const x of COINS.values()) { for (const k of x.chains) { const b = x.byChain[k]; if (b && !b.pairUsd && NUSD[k]) b.pairUsd = NUSD[k]; } if (!x.pairUsd) x.pairUsd = (x.byChain[x.chains[0]] || {}).pairUsd || 0; if (x.pairUsd && x.px) x.pxPair = x.px / x.pairUsd; }
    return NUSD;
  }
  const pricesP = prices();
  setInterval(prices, 60000);
  const pu = C.pairUsd;
  C.pairUsd = async (a) => (lc(a) === WETH ? (await pricesP, NUSD.eth || 0) : pu ? pu(a) : 0);
  C.ethUsd = async () => (await pricesP, NUSD.eth || 0);
  if (C.equo) C.equo.pairPrices = async () => { await pricesP; return NUSD.eth ? { [WETH]: NUSD.eth } : {}; };

  const ready = loadAll().catch((e) => console.warn('v2 coins', e.message));
  const evm = C.ready;
  C.ready = Promise.all([evm, Promise.race([ready, new Promise((r) => setTimeout(r, 8000))])]).then(([ok]) => ok);
  setInterval(() => { if (document.visibilityState !== 'hidden') loadAll().catch(() => {}); }, 20000);

  window.V2 = { nativeUsd: () => NUSD, prices,
    chains: CH, chain, coin: (a) => C.token(a), coins: () => [...COINS.values()], loaded: () => loaded, reload: loadAll, detail, live, quote, balances, buy, sell, payCreator, settle, signerOn, feeQuote, launch, launchStatus, complete, collect, me, api };
})();
