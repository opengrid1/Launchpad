/* Solana coins on the site. Equo coins on Solana are Token-2022 mints with a Meteora DAMM v2 pool, made by the Equo
   Solana program (solana/ in the repo). This adds them to the chain layer, next to the EVM coins:
   - reads: the program's coin accounts, each coin's mint (name, symbol, link), pool (price, liquidity) and the
     pool's transactions (trades, chart, holders), all through /api/sol (public Solana RPCs refuse browser origins);
   - trades: buy and sell straight on the coin's DAMM v2 pool, signed by a Solana wallet (Phantom, Solflare,
     Backpack), and the permissionless fee claim that pays the creator 70% and the platform 30%.
   Numbers follow the EVM layer's units: coin amounts as 18-decimal wei (Solana coins have 6), SOL amounts as
   18-decimal wei (SOL has 9). Exposes window.SOLW (the Solana wallet). Loaded after api.js, before core.js. */
(function () {
  const cfg = window.INKY || {}, C = window.CHAIN;
  const S = (cfg.chains || []).find((c) => c.key === 'sol');
  if (!C || !S || !S.program) return;

  const RPC = '/api/sol';
  const PROGRAM = S.program, CONFIG = S.config;
  const DAMM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
  const POOL_AUTH = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
  const DAMM_EVENTS = '3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet';
  const WSOL = 'So11111111111111111111111111111111111111112';
  const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const COIN_DISC = [215, 195, 53, 238, 217, 196, 213, 51];
  const IX_SWAP2 = [65, 75, 63, 76, 235, 91, 91, 136];
  const IX_CLAIM = [82, 251, 233, 156, 12, 52, 184, 202];
  const TOTAL_RAW = 1e15; // 1B coins, 6 decimals, across every chain
  const W12 = 10n ** 12n, W9 = 10n ** 9n;
  const lc = (a) => String(a || '').toLowerCase();

  // ---------------------------------------------------------------- encoding
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) {
    let x = 0n; for (const b of bytes) x = x * 256n + BigInt(b);
    let s = ''; while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n; }
    for (const b of bytes) { if (b === 0) s = '1' + s; else break; }
    return s;
  }
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const u64 = (d, o) => { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i]); return v; };
  const u128 = (d, o) => u64(d, o) | (u64(d, o + 8) << 64n);
  const u256 = (d, o) => u128(d, o) | (u128(d, o + 16) << 128n);
  const u16 = (d, o) => d[o] | (d[o + 1] << 8);
  const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const key = (d, o) => b58(d.subarray(o, o + 32));
  const n128 = (v) => Number(v) / 2 ** 64; // Q64.64 -> float

  // ---------------------------------------------------------------- rpc
  let rid = 0;
  const busy = (m) => /too many requests|429|rate/i.test(String(m || ''));
  async function rpc(method, params) {
    for (let i = 0; ; i++) {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({ error: { message: 'HTTP ' + r.status } }));
      if (j.error && (busy(j.error.message) || r.status === 429) && i < 3) { await new Promise((ok) => setTimeout(ok, 1200 * (i + 1))); continue; }
      if (j.error) throw new Error('Solana RPC: ' + (j.error.message || JSON.stringify(j.error)));
      return j.result;
    }
  }
  async function rpcBatch(calls) {
    if (!calls.length) return [];
    const out = [];
    for (let i = 0; i < calls.length; i += 20) {
      const part = calls.slice(i, i + 20).map(([method, params], k) => ({ jsonrpc: '2.0', id: i + k, method, params }));
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(part), signal: AbortSignal.timeout(25000) });
      const j = await r.json();
      const arr = Array.isArray(j) ? j : [j];
      const byId = new Map(arr.map((x) => [x.id, x]));
      part.forEach((p) => { const x = byId.get(p.id); out.push(x && !x.error ? x.result : null); });
    }
    return out;
  }
  async function accounts(keys) {
    const out = [];
    for (let i = 0; i < keys.length; i += 100) {
      const r = await rpc('getMultipleAccounts', [keys.slice(i, i + 100), { encoding: 'base64' }]);
      r.value.forEach((a) => out.push(a ? b64(a.data[0]) : null));
    }
    return out;
  }

  // ---------------------------------------------------------------- prices
  let solUsd = 0;
  async function loadSolUsd() {
    try {
      const r = await fetch('https://lite-api.jup.ag/price/v3?ids=' + WSOL, { signal: AbortSignal.timeout(6000) });
      const v = (await r.json())[WSOL].usdPrice;
      if (v > 0) { solUsd = v; return v; }
    } catch { }
    try { // the Equo program's own SOL price (set by its price updater)
      const [d] = await accounts([CONFIG]);
      const v = Number(u64(d, 189)) / 1e8; if (v > 0) solUsd = v;
    } catch { }
    return solUsd;
  }

  // ---------------------------------------------------------------- state
  const COINS = new Map(); // mint -> token object
  const TR = new Map(); // mint -> trades (oldest first)
  const byKey = (a) => { a = lc(a); for (const x of COINS.values()) if (lc(x.addr) === a) return x; return null; };

  function parseMeta(d) {
    // Token-2022 mint: 165 bytes (base + padding), account type, then TLV extensions; TokenMetadata is type 19
    let o = 166; const out = { supply: Number(u64(d, 36)) };
    while (o + 4 <= d.length) {
      const t = u16(d, o), l = u16(d, o + 2);
      if (t === 19) {
        let p = o + 4 + 64; const str = () => { const n = u32(d, p); const v = new TextDecoder().decode(d.subarray(p + 4, p + 4 + n)); p += 4 + n; return v; };
        out.name = str(); out.symbol = str(); out.uri = str();
      }
      o += 4 + l;
    }
    return out;
  }
  async function readUri(uri) {
    try {
      if (!uri) return {};
      if (uri.startsWith('data:application/json,')) return JSON.parse(decodeURIComponent(uri.slice(22)));
      if (/^https:\/\//.test(uri)) { const r = await fetch(uri, { signal: AbortSignal.timeout(5000) }); return await r.json(); }
    } catch { }
    return {};
  }
  function parsePool(d) {
    return {
      cliff: Number(u64(d, 8)), periods: u16(d, 22), freq: Number(u64(d, 24)), reduction: Number(u64(d, 32)), mode: d[16],
      vaultA: key(d, 232), vaultB: key(d, 264),
      L: u128(d, 360), smin: u128(d, 424), smax: u128(d, 440), sp: u128(d, 456), activation: Number(u64(d, 472)),
      feeBPerLiq: u256(d, 520),
    };
  }
  /** the pool's fee right now (anti-snipe decays linearly to the base fee) */
  function feeNow(p) {
    if (!p.periods || !p.freq) return p.cliff / 1e9;
    const passed = Math.min(p.periods, Math.max(0, Math.floor((Date.now() / 1000 - p.activation) / p.freq)));
    return (p.cliff - p.reduction * passed) / 1e9;
  }

  function build(mint, s, meta, info, pool, vA, vB) {
    const sp = n128(pool.sp), pxRawLamports = sp * sp; // lamports per raw coin unit
    const pxPair = pxRawLamports * 1e6 / 1e9; // SOL per whole coin
    const px = pxPair * solUsd, mc = px * TOTAL_RAW / 1e6;
    const coinsInPool = vA / 1e6, solInPool = vB / 1e9;
    const liq = solInPool * solUsd; // the pool's SOL side, as the EVM pages count liquidity
    const supply = meta.supply / 1e6;
    const prev = COINS.get(mint) || {};
    const ageS = Math.max(0, Date.now() / 1000 - s.createdAt), age = ageS > 86400 ? Math.floor(ageS / 86400) + 'd' : ageS > 3600 ? Math.floor(ageS / 3600) + 'h' : Math.max(1, Math.floor(ageS / 60)) + 'm';
    return Object.assign(prev, {
      addr: mint, n: meta.name || 'Solana coin', t: meta.symbol || '?', img: info.image || prev.img, desc: info.description || '',
      links: { web: info.website || '', x: info.twitter || info.x || '', tg: info.telegram || '' },
      pair: 'SOL', pairAddr: lc(WSOL), pairUsd: solUsd, px, pxPair, mc, liq, liqPair: solUsd ? liq / solUsd : 0, liqAll: liq,
      createdAt: s.createdAt, age, feeBps: s.feeBps, creator: s.creator, creatorFees: s.creatorFees / 1e9, platformFees: s.platformFees / 1e9,
      chains: ['sol'], addrs: { sol: mint }, poolsLive: 1, poolId: s.pool, pool: s.pool, coinPda: s.coinPda, position: s.position, nftAccount: s.nftAccount,
      byChain: { sol: { px, vol: prev.vol || 0, trades: prev.trades || 0, supply, pairUsd: solUsd } },
      pools: { sol: { state: 'live', priceUsd: px, liquidityUsd: liq, pairUsd: solInPool * solUsd, coinsInPool, pairInPool: solInPool, pairSym: 'SOL' } },
      vol: prev.vol || 0, c24: prev.c24 || 0, trades: prev.trades || 0, traders: prev.traders || 0, h: prev.h || 0,
      rewards: false, genes: { feeMode: 0, feeBps: s.feeBps, snipeBps: s.snipeBps }, hidden: false, sol: true,
      _pool: pool, _vaults: [pool.vaultA, pool.vaultB], _supplyRaw: meta.supply,
      totalCreatorFees: s.creatorFees / 1e9, creatorOwed: prev.creatorOwed || 0, buybackPot: 0, dividendPot: 0,
    });
  }

  async function loadAll() {
    await loadSolUsd();
    const list = await rpc('getProgramAccounts', [PROGRAM, { encoding: 'base64', filters: [{ dataSize: 210 }, { memcmp: { offset: 0, bytes: b58(COIN_DISC) } }] }]);
    const states = list.map((a) => {
      const d = b64(a.account.data[0]);
      return {
        coinPda: a.pubkey, mint: key(d, 8), creator: key(d, 40), pool: key(d, 72), position: key(d, 104), nftAccount: key(d, 136),
        feeBps: u16(d, 168), snipeBps: u16(d, 170), snipeSecs: u32(d, 172), split: d[176], capUsd8: Number(u64(d, 177)),
        createdAt: Number(u64(d, 185)), creatorFees: Number(u64(d, 193)), platformFees: Number(u64(d, 201)),
      };
    });
    if (!states.length) return;
    const raw = await accounts(states.flatMap((s) => [s.mint, s.pool]));
    const pools = states.map((s, i) => parsePool(raw[i * 2 + 1]));
    const vaults = await accounts(pools.flatMap((p) => [p.vaultA, p.vaultB]));
    await Promise.all(states.map(async (s, i) => {
      const meta = parseMeta(raw[i * 2]), info = await readUri(meta.uri);
      const vA = Number(u64(vaults[i * 2], 64)), vB = Number(u64(vaults[i * 2 + 1], 64));
      COINS.set(s.mint, build(s.mint, s, meta, info, pools[i], vA, vB));
    }));
  }

  // ---------------------------------------------------------------- trades
  /** trades in a coin's pool, from the pool's transactions: the vaults' token balance changes give each swap */
  async function loadTrades(x, max = 200) {
    const sigs = await rpc('getSignaturesForAddress', [x.pool, { limit: max }]);
    const have = new Map((TR.get(x.addr) || []).map((t) => [t.tx, t]));
    const need = sigs.filter((s) => !s.err && !have.has(s.signature));
    const txs = await rpcBatch(need.map((s) => ['getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]]));
    const fee = feeNow(x._pool);
    txs.forEach((t, i) => {
      if (!t || !t.meta) return;
      const keys = t.transaction.message.accountKeys.concat((t.meta.loadedAddresses && [...t.meta.loadedAddresses.writable, ...t.meta.loadedAddresses.readonly]) || []);
      const bal = (arr, mint) => { const e = (arr || []).find((b) => b.owner === POOL_AUTH && b.mint === mint); return e ? BigInt(e.uiTokenAmount.amount) : null; };
      const a0 = bal(t.meta.preTokenBalances, x.addr), a1 = bal(t.meta.postTokenBalances, x.addr);
      const b0 = bal(t.meta.preTokenBalances, WSOL), b1 = bal(t.meta.postTokenBalances, WSOL);
      if (a1 == null || b1 == null) return;
      const dA = a1 - (a0 || 0n), dB = b1 - (b0 || 0n);
      let buy, coin, pair;
      if (a0 == null) { buy = true; coin = BigInt(x._supplyRaw) - a1; pair = b1; if (coin <= 0n) return; } // launch: the creator's first buy
      else if (dA < 0n && dB > 0n) { buy = true; coin = -dA; pair = dB; }
      else if (dA > 0n && dB < 0n) { buy = false; coin = dA; pair = -dB; }
      else return; // fee claims, collects
      const p = Number(pair) / 1e9, f = a0 == null ? 0 : buy ? p * fee : p * fee / (1 - fee); // the first buy pays no fee
      have.set(need[i].signature, {
        token: x.addr, chain: 'sol', wallet: keys[0], buy, coin: String(coin * W12), pair: String(pair * W9), fee: String(BigInt(Math.round(f * 1e9)) * W9),
        realized: '0', block: t.slot, ts: t.blockTime || Math.floor(Date.now() / 1000), tx: need[i].signature, index: 0,
      });
    });
    const all = [...have.values()].sort((a, b) => a.ts - b.ts || a.block - b.block);
    TR.set(x.addr, all);
    // 24h figures for lists
    const now = Date.now() / 1000, day = all.filter((t) => t.ts >= now - 86400);
    x.vol = day.reduce((a, t) => a + Number(t.pair) / 1e18 * solUsd, 0);
    x.trades = all.length; x.traders = new Set(all.map((t) => t.wallet)).size;
    const net = {}; all.forEach((t) => { net[t.wallet] = (net[t.wallet] || 0) + (t.buy ? 1 : -1) * Number(t.coin); });
    x.h = Object.values(net).filter((v) => v > 1e18).length;
    const first = day[0], pxAt = (t) => Number(t.pair) / Number(t.coin) * solUsd;
    x.c24 = first ? (x.px / pxAt(first) - 1) * 100 : 0;
    x.byChain.sol.vol = x.vol; x.byChain.sol.trades = x.trades;
    return all;
  }

  /** what the position's fees would pay right now (DAMM v2 accrual: pending + liquidity x growth / 2^128) */
  async function pendingFees(x) {
    const [pd, pos] = await accounts([x.pool, x.position]);
    if (!pd || !pos) return 0;
    const fbPool = u256(pd, 520), fbCk = u256(pos, 104), pend = u64(pos, 144);
    const liq = u128(pos, 152) + u128(pos, 168) + u128(pos, 184);
    const acc = fbPool > fbCk ? (liq * (fbPool - fbCk)) >> 128n : 0n;
    return Number(pend + acc) / 1e9;
  }

  /** holders from the trades, when the RPC will not list the largest accounts (bridging and transfers not seen) */
  function holdersFromTrades(x, n) {
    const by = {};
    (TR.get(x.addr) || []).forEach((t) => { by[t.wallet] = (by[t.wallet] || 0) + (t.buy ? 1 : -1) * Number(t.coin) / 1e18; });
    const pool = ((x.pools || {}).sol || {}).coinsInPool || 0; if (pool) by[POOL_AUTH] = pool;
    return Object.entries(by).filter(([, v]) => v > 1e-6).sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([w, bal]) => ({ wallet: w, bal, share: bal / (TOTAL_RAW / 1e6) * 100, name: w === POOL_AUTH ? 'Meteora pool' : '' }));
  }
  async function holders(x, n = 50) {
    let r;
    try { r = await rpc('getTokenLargestAccounts', [x.addr]); } catch (e) { return holdersFromTrades(x, n); }
    const top = r.value.filter((a) => a.amount !== '0').slice(0, n);
    const acc = await accounts(top.map((a) => a.address));
    const by = {};
    top.forEach((a, i) => { const owner = acc[i] ? key(acc[i], 32) : a.address; by[owner] = (by[owner] || 0) + Number(a.amount) / 1e6; });
    return Object.entries(by).sort((a, b) => b[1] - a[1]).map(([w, bal]) => ({ wallet: w, bal, share: bal / (TOTAL_RAW / 1e6) * 100, name: w === POOL_AUTH ? 'Meteora pool' : '' }));
  }

  // ---------------------------------------------------------------- quotes (pool math, client side)
  function quote(x, amountIn, buy) {
    const p = x._pool, f = feeNow(p), Lr = n128(p.L), s = n128(p.sp), smin = n128(p.smin);
    if (!(Lr > 0)) return 0;
    if (buy) { // SOL in, fee taken from the SOL
      const inEff = amountIn * (1 - f), s2 = s + inEff / Lr;
      return Lr * (1 / s - 1 / s2);
    }
    const s2 = 1 / (1 / s + amountIn / Lr); // coins in
    if (s2 < smin) return 0;
    return Lr * (s - s2) * (1 - f);
  }

  // ---------------------------------------------------------------- wallet
  const providers = () => [
    ['Phantom', window.phantom && window.phantom.solana],
    ['Solflare', window.solflare && window.solflare.isSolflare ? window.solflare : null],
    ['Backpack', window.backpack && window.backpack.solana ? window.backpack.solana : window.backpack],
    ['Solana wallet', window.solana],
  ].filter(([, p]) => p && typeof p.connect === 'function');
  const SOLW = { connected: false, address: null, short: '', chainOk: true, name: '', _p: null };
  // SP is core.js's top-level const: a global binding, but not a window property
  const spWal = () => { try { return (typeof SP !== 'undefined' && SP._wal) || []; } catch { return []; } };
  const fire = () => { spWal().forEach((f) => { try { f(); } catch (e) { console.warn(e); } }); dispatchEvent(new CustomEvent('sol-wallet')); };
  function set(p, name, pk) {
    SOLW._p = p; SOLW.name = name; SOLW.connected = !!pk; SOLW.address = pk ? String(pk) : null;
    SOLW.short = pk ? SOLW.address.slice(0, 4) + '…' + SOLW.address.slice(-4) : '';
    fire();
  }
  SOLW.connect = async function () {
    const list = providers();
    if (!list.length) { window.open('https://phantom.app/download', '_blank'); throw new Error('No Solana wallet found. Install Phantom, Solflare or Backpack.'); }
    const [name, p] = list[0];
    const r = await p.connect();
    const pk = (r && r.publicKey) || p.publicKey;
    set(p, name, pk && pk.toString());
    try { localStorage.setItem('equo-solw', name); } catch { }
    if (p.on) { try { p.on('accountChanged', (k) => set(p, name, k ? k.toString() : null)); p.on('disconnect', () => set(null, '', null)); } catch { } }
    return SOLW.address;
  };
  SOLW.disconnect = async function () { try { SOLW._p && SOLW._p.disconnect && (await SOLW._p.disconnect()); } catch { } set(null, '', null); try { localStorage.removeItem('equo-solw'); } catch { } };
  // reconnect silently when the wallet already trusts the site
  addEventListener('load', () => {
    let was = ''; try { was = localStorage.getItem('equo-solw') || ''; } catch { }
    const hit = providers().find(([n]) => n === was);
    if (hit && hit[1].connect) hit[1].connect({ onlyIfTrusted: true }).then((r) => { const pk = (r && r.publicKey) || hit[1].publicKey; if (pk) set(hit[1], hit[0], pk.toString()); }).catch(() => { });
  });
  window.SOLW = SOLW;

  // ---------------------------------------------------------------- transactions
  let web3P = null;
  const web3 = () => web3P || (web3P = new Promise((res, rej) => {
    if (window.solanaWeb3) return res(window.solanaWeb3);
    const s = document.createElement('script'); s.src = '/solana-web3.js?v=1.98.4'; s.onload = () => res(window.solanaWeb3); s.onerror = () => { web3P = null; rej(new Error('Could not load the Solana library')); };
    document.head.appendChild(s);
  }));
  async function send(ixs) {
    if (!SOLW.connected) await SOLW.connect();
    const W = await web3();
    const me = new W.PublicKey(SOLW.address);
    const { value } = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const tx = new W.Transaction({ feePayer: me, recentBlockhash: value.blockhash });
    tx.add(W.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
    ixs(W, me).forEach((ix) => tx.add(ix));
    const sim = await rpc('simulateTransaction', [btoa(String.fromCharCode(...tx.serialize({ requireAllSignatures: false, verifySignatures: false }))), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }]);
    if (sim.value.err) {
      const logs = (sim.value.logs || []).join('\n');
      const m = /exceeded|slippage|ExceededSlippage|0x1773|minimum/i.test(logs) ? 'Price moved past your slippage; try again' : /insufficient|0x1\b/i.test(logs) ? 'Not enough SOL for the trade and fees' : 'The transaction would fail: ' + JSON.stringify(sim.value.err);
      throw new Error(m);
    }
    const r = await SOLW._p.signAndSendTransaction(tx);
    const sig = r.signature || r;
    for (let i = 0; i < 40; i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      const st = (await rpc('getSignatureStatuses', [[sig]])).value[0];
      if (st && st.err) throw new Error('Transaction failed on chain');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    }
    throw new Error('Not confirmed yet; check your wallet');
  }
  const ataOf = (W, owner, mint, prog) => W.PublicKey.findProgramAddressSync([new W.PublicKey(owner).toBuffer(), new W.PublicKey(prog).toBuffer(), new W.PublicKey(mint).toBuffer()], new W.PublicKey(ATA))[0];
  const ataIx = (W, payer, owner, mint, prog) => new W.TransactionInstruction({
    programId: new W.PublicKey(ATA), data: Uint8Array.from([1]),
    keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: ataOf(W, owner, mint, prog), isSigner: false, isWritable: true }, { pubkey: new W.PublicKey(owner), isSigner: false, isWritable: false },
      { pubkey: new W.PublicKey(mint), isSigner: false, isWritable: false }, { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: new W.PublicKey(prog), isSigner: false, isWritable: false }],
  });
  const le64 = (v) => { const b = new Uint8Array(8); let x = BigInt(v); for (let i = 0; i < 8; i++) { b[i] = Number(x & 255n); x >>= 8n; } return b; };
  const swapIx = (W, x, me, buy, amountIn, minOut) => {
    const coinAta = ataOf(W, me, x.addr, TOKEN22), solAta = ataOf(W, me, WSOL, TOKEN);
    const r = (k) => ({ pubkey: new W.PublicKey(k), isSigner: false, isWritable: false }), w = (k) => ({ pubkey: k instanceof W.PublicKey ? k : new W.PublicKey(k), isSigner: false, isWritable: true });
    return new W.TransactionInstruction({
      programId: new W.PublicKey(DAMM),
      data: Uint8Array.from([...IX_SWAP2, ...le64(amountIn), ...le64(minOut), 0]),
      keys: [r(POOL_AUTH), w(x.pool), w(buy ? solAta : coinAta), w(buy ? coinAta : solAta), w(x._pool.vaultA), w(x._pool.vaultB), r(x.addr), r(WSOL),
        { pubkey: me, isSigner: true, isWritable: false }, r(TOKEN22), r(TOKEN), r(DAMM), r(DAMM_EVENTS), r(DAMM)],
    });
  };
  const closeIx = (W, me) => new W.TransactionInstruction({ programId: new W.PublicKey(TOKEN), data: Uint8Array.from([9]), keys: [{ pubkey: ataOf(W, me, WSOL, TOKEN), isSigner: false, isWritable: true }, { pubkey: me, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }] });

  async function buy(x, lamports, minRaw) {
    return send((W, me) => [
      ataIx(W, me, me, x.addr, TOKEN22), ataIx(W, me, me, WSOL, TOKEN),
      W.SystemProgram.transfer({ fromPubkey: me, toPubkey: ataOf(W, me, WSOL, TOKEN), lamports: BigInt(lamports) }),
      new W.TransactionInstruction({ programId: new W.PublicKey(TOKEN), data: Uint8Array.from([17]), keys: [{ pubkey: ataOf(W, me, WSOL, TOKEN), isSigner: false, isWritable: true }] }),
      swapIx(W, x, me, true, lamports, minRaw), closeIx(W, me),
    ]);
  }
  async function sell(x, raw, minLamports) {
    return send((W, me) => [ataIx(W, me, me, WSOL, TOKEN), swapIx(W, x, me, false, raw, minLamports), closeIx(W, me)]);
  }
  async function claimFees(x) {
    const [cd] = await accounts([CONFIG]);
    const feeRecipient = key(cd, 40);
    return send((W, me) => {
      const r = (k) => ({ pubkey: new W.PublicKey(k), isSigner: false, isWritable: false }), w = (k) => ({ pubkey: k instanceof W.PublicKey ? k : new W.PublicKey(k), isSigner: false, isWritable: true });
      return [new W.TransactionInstruction({
        programId: new W.PublicKey(PROGRAM), data: Uint8Array.from(IX_CLAIM),
        keys: [{ pubkey: me, isSigner: true, isWritable: true }, r(CONFIG), w(x.coinPda), r(x.addr), r(WSOL),
          w(ataOf(W, x.coinPda, x.addr, TOKEN22)), w(ataOf(W, x.coinPda, WSOL, TOKEN)), r(x.creator), w(ataOf(W, x.creator, WSOL, TOKEN)),
          r(feeRecipient), w(ataOf(W, feeRecipient, WSOL, TOKEN)), r(x.pool), w(x.position), r(x.nftAccount),
          w(x._pool.vaultA), w(x._pool.vaultB), r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM), r(TOKEN22), r(TOKEN), r(ATA), r(W.SystemProgram.programId.toBase58())],
      })];
    });
  }

  async function coinBalance(x, owner) {
    const r = await rpc('getTokenAccountsByOwner', [owner, { mint: x.addr }, { encoding: 'base64' }]);
    return r.value.reduce((a, v) => a + u64(b64(v.account.data[0]), 64), 0n);
  }

  // ---------------------------------------------------------------- hook into the chain layer
  const solOf = (a) => byKey(a);
  const wrap = (name, fn) => { const orig = C[name]; C[name] = function (a, ...rest) { const x = solOf(a); return x ? fn(x, ...rest) : orig ? orig.apply(this, arguments) : undefined; }; };
  const t0 = C.tokens; C.tokens = () => (t0 ? t0() : []).concat([...COINS.values()]);
  const tk = C.token; C.token = (a) => solOf(a) || (tk ? tk(a) : null);
  const at = C.allTrades; C.allTrades = async (...a) => (at ? await at(...a).catch(() => []) : []).concat(...[...TR.values()]);
  wrap('trades', async (x) => (await loadTrades(x).catch(() => TR.get(x.addr) || [])).slice());
  wrap('refresh', async (x) => { await refreshOne(x).catch(() => { }); return x; });
  wrap('holders', async (x, n) => holders(x, n));
  wrap('topTraders', async (x) => {
    const by = {};
    (TR.get(x.addr) || []).forEach((t) => { const o = by[t.wallet] || (by[t.wallet] = { wallet: t.wallet, pnl: 0, volume: 0, trades: 0, bought: 0, sold: 0 }); o.volume += Number(t.pair) / 1e18 * solUsd; o.trades++; if (t.buy) o.bought += Number(t.coin) / 1e18; else o.sold += Number(t.coin) / 1e18; });
    return Object.values(by).map((o) => ({ ...o, holding: o.bought - o.sold > 1 })).sort((a, b) => b.volume - a.volume);
  });
  wrap('position', async () => null);
  wrap('pending', async () => 0n);
  wrap('balance', async (x, who) => (who && !/^0x/i.test(who) ? (await coinBalance(x, who)) * W12 : 0n));
  wrap('bars', async (x, step, from, to) => {
    const out = []; let o = null;
    (TR.get(x.addr) || (await loadTrades(x).catch(() => []))).filter((t) => t.ts >= from && t.ts < to).forEach((t) => {
      const p = Number(t.pair) / Number(t.coin), b = Math.floor(t.ts / step) * step;
      if (!o || o.time !== b) { if (o) out.push(o); o = { time: b, open: o ? o.close : p, high: p, low: p, close: p, volume: 0 }; }
      o.high = Math.max(o.high, p); o.low = Math.min(o.low, p); o.close = p; o.volume += Number(t.pair) / 1e18;
    });
    if (o) out.push(o); return out;
  });
  // quotes take and give the EVM layer's 18-decimal amounts
  wrap('quoteBuyEth', async (x, wei) => BigInt(Math.floor(quote(x, Number(BigInt(wei) / W9), true))) * W12);
  wrap('quoteSellEth', async (x, wei) => BigInt(Math.floor(quote(x, Number(BigInt(wei) / W12), false))) * W9);
  wrap('quoteBuy', async (x, wei) => BigInt(Math.floor(quote(x, Number(BigInt(wei) / W9), true))) * W12);
  wrap('quoteSell', async (x, wei) => BigInt(Math.floor(quote(x, Number(BigInt(wei) / W12), false))) * W9);
  wrap('buy', async (x, wei, minWei) => { const sig = await buy(x, BigInt(wei) / W9, BigInt(minWei || 0) / W12); await refreshOne(x).catch(() => { }); return { hash: sig }; });
  wrap('sell', async (x, wei, minWei) => { const sig = await sell(x, BigInt(wei) / W12, BigInt(minWei || 0) / W9); await refreshOne(x).catch(() => { }); return { hash: sig }; });
  wrap('payCreator', async (x) => { const sig = await claimFees(x); await refreshOne(x).catch(() => { }); return { hash: sig }; });
  wrap('claim', async () => { throw new Error('Solana coins have no holder rewards'); });
  const eb = C.ethBalance; C.ethBalance = async (a) => (a && !/^0x/i.test(a) ? BigInt(await rpc('getBalance', [a]).then((r) => r.value)) * W9 : eb ? eb(a) : 0n);
  if (C.equo) {
    const E = C.equo, ci = E.creatorInfo, bo = E.balanceOf;
    E.creatorInfo = async (a) => { const x = solOf(a); if (!x) return ci(a); const pend = await pendingFees(x).catch(() => 0); x.creatorOwed = pend * 0.7; return { creator: x.creator, pending: null, activeAt: x.createdAt, takeover: null, owed: pend * 0.7, sol: true }; };
    E.balanceOf = (a, who) => (solOf(a) ? (who && !/^0x/i.test(who) ? coinBalance(solOf(a), who).then((v) => v * W12) : Promise.resolve(0n)) : bo(a, who));
  }

  async function refreshOne(x) {
    await loadSolUsd();
    const [pd] = await accounts([x.pool]);
    const pool = parsePool(pd);
    const v = await accounts([pool.vaultA, pool.vaultB]);
    const s = { pool: x.pool, coinPda: x.coinPda, position: x.position, nftAccount: x.nftAccount, creator: x.creator, feeBps: x.feeBps, snipeBps: (x.genes || {}).snipeBps || 0, createdAt: x.createdAt, creatorFees: x.creatorFees * 1e9, platformFees: x.platformFees * 1e9 };
    build(x.addr, s, { name: x.n, symbol: x.t, supply: x._supplyRaw }, { image: x.img, description: x.desc, website: x.links.web, x: x.links.x, telegram: x.links.tg }, pool, Number(u64(v[0], 64)), Number(u64(v[1], 64)));
    await loadTrades(x, 50).catch(() => { });
    return x;
  }

  // the chain layer is ready when the EVM side is; Solana coins join as soon as they load (at most a few seconds)
  const solReady = loadAll().then(() => Promise.all([...COINS.values()].map((x) => loadTrades(x).catch(() => []))))
    .then(() => dispatchEvent(new Event('chain-update'))).catch((e) => console.warn('solana', e.message));
  const evmReady = C.ready;
  C.ready = Promise.all([evmReady, Promise.race([solReady, new Promise((r) => setTimeout(r, 8000))])]).then(([ok]) => ok);
  setInterval(() => { [...COINS.values()].forEach((x) => refreshOne(x).catch(() => { })); setTimeout(() => dispatchEvent(new Event('chain-update')), 4000); }, 30000);
})();
