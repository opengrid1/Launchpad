/* The Solana leg of an Equo coin on the site. A coin launched with Solana among its chains has, on Solana, a
   Token-2022 mint (9 decimals, like the EVM coins) in a Meteora DAMM v2 pool against SOL, made by Equo's Solana
   program, and bridged to the EVM legs by its LayerZero OFT. This plugs that leg into V2 (v2.js) as chain 'sol':
   live pool state, quotes, balances, buys and sells signed by a Solana wallet (Phantom, Solflare, Backpack), and
   the permissionless fee claim. Amounts keep V2's units: coins in 9-decimal units, SOL as 18-decimal wei.
   Solana JSON-RPC goes through /api/sol (public RPCs refuse browser origins). Exposes window.SOLW. */
(function () {
  const V2 = window.V2, cfg = window.INKY || {};
  const S = (cfg.chains || []).find((c) => c.key === 'sol');
  if (!V2 || !S || !S.sol) return;

  const RPC = '/api/sol';
  const PROGRAM = S.sol.program;
  const DAMM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
  const POOL_AUTH = 'HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC';
  const DAMM_EVENTS = '3rmHSu74h1ZcmAisVcWerTCiRDQbUrBKmcwptYGjHfet';
  const WSOL = 'So11111111111111111111111111111111111111112';
  const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const IX_SWAP2 = [65, 75, 63, 76, 235, 91, 91, 136];
  const IX_CLAIM = [82, 251, 233, 156, 12, 52, 184, 202];
  const PLATFORM_SHARE = 0.2; // of a claimed fee at 1% to 5% (the platform's floor, 0.2% of volume, is the same)
  const W9 = 10n ** 9n;

  // ---------------------------------------------------------------- encoding and rpc
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
  const key = (d, o) => b58(d.subarray(o, o + 32));
  const le64 = (v) => { const b = new Uint8Array(8); let x = BigInt(v); for (let i = 0; i < 8; i++) { b[i] = Number(x & 255n); x >>= 8n; } return b; };

  let rid = 0;
  async function rpc(method, params) {
    for (let i = 0; ; i++) {
      const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({ error: { message: 'HTTP ' + r.status } }));
      if (j.error && (/too many|429|rate/i.test(String(j.error.message)) || r.status === 429) && i < 3) { await new Promise((ok) => setTimeout(ok, 1200 * (i + 1))); continue; }
      if (j.error) throw new Error('Solana RPC: ' + (j.error.message || JSON.stringify(j.error)));
      return j.result;
    }
  }
  async function accounts(keys) {
    const r = await rpc('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'confirmed' }]);
    return r.value.map((a) => (a ? b64(a.data[0]) : null));
  }

  // ---------------------------------------------------------------- web3 (loaded on first use)
  let web3P = null;
  const web3 = () => web3P || (web3P = new Promise((res, rej) => {
    if (window.solanaWeb3) return res(window.solanaWeb3);
    const s = document.createElement('script'); s.src = '/solana-web3.js?v=1.98.4'; s.onload = () => res(window.solanaWeb3); s.onerror = () => { web3P = null; rej(new Error('Could not load the Solana library')); };
    document.head.appendChild(s);
  }));
  const pda = (W, seeds, prog) => W.PublicKey.findProgramAddressSync(seeds, new W.PublicKey(prog))[0];
  const ataOf = (W, owner, mint, prog) => pda(W, [new W.PublicKey(owner).toBuffer(), new W.PublicKey(prog).toBuffer(), new W.PublicKey(mint).toBuffer()], ATA);
  const enc = new TextEncoder();

  // ---------------------------------------------------------------- wallet
  const providers = () => [
    ['Phantom', window.phantom && window.phantom.solana],
    ['Solflare', window.solflare && window.solflare.isSolflare ? window.solflare : null],
    ['Backpack', window.backpack && window.backpack.solana ? window.backpack.solana : window.backpack],
    ['Solana wallet', window.solana],
  ].filter(([, p]) => p && typeof p.connect === 'function');
  const SOLW = window.SOLW || { connected: false, address: null, short: '', name: '', _p: null };
  const spWal = () => { try { return (typeof SP !== 'undefined' && SP._wal) || []; } catch { return []; } };
  function set(p, name, pk) {
    SOLW._p = p; SOLW.name = name; SOLW.connected = !!pk; SOLW.address = pk ? String(pk) : null;
    SOLW.short = pk ? SOLW.address.slice(0, 4) + '…' + SOLW.address.slice(-4) : '';
    spWal().forEach((f) => { try { f(); } catch (e) { console.warn(e); } });
    dispatchEvent(new CustomEvent('sol-wallet'));
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
  addEventListener('load', () => {
    let was = ''; try { was = localStorage.getItem('equo-solw') || ''; } catch { }
    const hit = providers().find(([n]) => n === was);
    if (hit && hit[1].connect) hit[1].connect({ onlyIfTrusted: true }).then((r) => { const pk = (r && r.publicKey) || hit[1].publicKey; if (pk) set(hit[1], hit[0], pk.toString()); }).catch(() => { });
  });
  window.SOLW = SOLW;

  async function send(build) {
    if (!SOLW.connected) await SOLW.connect();
    const W = await web3(), me = new W.PublicKey(SOLW.address);
    const { value } = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const tx = new W.Transaction({ feePayer: me, recentBlockhash: value.blockhash });
    tx.add(W.ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), W.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
    (await build(W, me)).forEach((ix) => tx.add(ix));
    const sim = await rpc('simulateTransaction', [btoa(String.fromCharCode(...tx.serialize({ requireAllSignatures: false, verifySignatures: false }))), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }]);
    if (sim.value.err) {
      const logs = (sim.value.logs || []).join('\n');
      throw new Error(/exceeded|slippage|0x1773|minimum/i.test(logs) ? 'Price moved past your slippage; try again' : /insufficient|0x1\b/i.test(logs) ? 'Not enough SOL for the trade and fees' : 'The transaction would fail: ' + JSON.stringify(sim.value.err));
    }
    const r = await SOLW._p.signAndSendTransaction(tx);
    const sig = r.signature || r;
    for (let i = 0; i < 40; i++) {
      await new Promise((ok) => setTimeout(ok, 1500));
      const st = (await rpc('getSignatureStatuses', [[sig]])).value[0];
      if (st && st.err) throw new Error('Transaction failed on chain');
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return { hash: sig, status: 1 };
    }
    throw new Error('Not confirmed yet; check your wallet');
  }

  // ---------------------------------------------------------------- the leg's pool
  /** DAMM v2 pool fields used here (offsets of the cp-amm Pool account). */
  function parsePool(d) {
    return { cliff: Number(u64(d, 8)), vaultA: key(d, 232), vaultB: key(d, 264), L: u128(d, 360), smin: u128(d, 424), smax: u128(d, 440), sp: u128(d, 456), feeBPerLiq: u256(d, 520) };
  }
  const Q64 = 2 ** 64;

  async function live(x) {
    const mint = x.addrs.sol, poolAddr = (x.byChain.sol || {}).poolId;
    const W = await web3();
    const coinPda = pda(W, [enc.encode('coin2'), new W.PublicKey(mint).toBuffer()], PROGRAM).toBase58();
    const [pd, cd] = await accounts([poolAddr, coinPda]);
    if (!pd) throw new Error('Solana pool not found');
    const p = parsePool(pd);
    const sp = Number(p.sp) / Q64; // sqrt(lamports per coin unit)
    const out = {
      chain: 'sol', token: mint, sol: true, poolAddr, coinPda, p,
      pool: { sqrtP: p.sp, L: p.L }, floor: p.smin, shieldBps: 0, feeBuyBps: Math.round(p.cliff / 1e5), feeSellBps: Math.round(p.cliff / 1e5),
      priceNative: sp * sp, // lamports per unit = SOL per whole coin (both 9 decimals)
      pot: null, creatorOwed: 0n,
    };
    if (cd) {
      out.creator = key(cd, 40); out.position = key(cd, 104); out.nftAccount = key(cd, 136);
      // what claim_fees would pay the creator now: the position's pending SOL fees plus what accrued since
      const [pos] = await accounts([out.position]);
      if (pos) {
        const fbCk = u256(pos, 104), pend = u64(pos, 144), liq = u128(pos, 152) + u128(pos, 168) + u128(pos, 184);
        const acc = p.feeBPerLiq > fbCk ? (liq * (p.feeBPerLiq - fbCk)) >> 128n : 0n;
        out.creatorOwed = ((pend + acc) * BigInt(Math.round((1 - PLATFORM_SHARE) * 1e4)) / 10000n) * W9;
      }
    }
    x.live = x.live || {}; x.live.sol = out;
    return out;
  }

  /** DAMM v2 constant-liquidity math in Q64.64: buy with SOL (wei in, coin units out), sell coin units (wei out). */
  function quote(lv, side, amountIn) {
    const p = lv.p; amountIn = BigInt(amountIn);
    if (!p || !(p.L > 0n) || amountIn <= 0n) return { out: 0n, limited: false };
    const f = BigInt(Math.round(p.cliff / 1e3)); // fee in millionths
    // sqrt prices are Q64.64 and L is liquidity with 64 fraction bits, so with s = sp/2^64 and l = L/2^64:
    // a buy moves s up by dx/l and pays l (1/s - 1/s2) coins; a sell moves 1/s up by dy/l and pays l (s - s2) SOL
    if (side === 'buy') {
      const lamports = amountIn / W9, fee = lamports * f / 1_000_000n, x = lamports - fee;
      const s2 = p.sp + (x << 128n) / p.L;
      const out = (p.L * (s2 - p.sp)) / s2 / p.sp;
      return { out, fee: fee * W9, limited: false };
    }
    let s2 = (p.L * p.sp) / (p.L + amountIn * p.sp), limited = false;
    if (s2 < p.smin) { s2 = p.smin; limited = true; }
    const gross = (p.L * (p.sp - s2)) >> 128n, fee = gross * f / 1_000_000n;
    return { out: (gross - fee) * W9, fee: fee * W9, limited };
  }

  async function balances(x, who) {
    who = who || SOLW.address;
    if (!who) return { coin: 0n, native: 0n };
    const [lam, toks] = await Promise.all([rpc('getBalance', [who, { commitment: 'confirmed' }]), rpc('getTokenAccountsByOwner', [who, { mint: x.addrs.sol }, { encoding: 'base64' }])]);
    return { coin: toks.value.reduce((a, v) => a + u64(b64(v.account.data[0]), 64), 0n), native: BigInt(lam.value) * W9 };
  }

  const ixs = {
    ata: (W, payer, owner, mint, prog) => new W.TransactionInstruction({
      programId: new W.PublicKey(ATA), data: Uint8Array.from([1]),
      keys: [{ pubkey: payer, isSigner: true, isWritable: true }, { pubkey: ataOf(W, owner, mint, prog), isSigner: false, isWritable: true }, { pubkey: new W.PublicKey(owner), isSigner: false, isWritable: false },
        { pubkey: new W.PublicKey(mint), isSigner: false, isWritable: false }, { pubkey: W.SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: new W.PublicKey(prog), isSigner: false, isWritable: false }],
    }),
    swap: (W, lv, me, buy, amountIn, minOut) => {
      const coinAta = ataOf(W, me, lv.token, TOKEN22), solAta = ataOf(W, me, WSOL, TOKEN);
      const r = (k) => ({ pubkey: new W.PublicKey(k), isSigner: false, isWritable: false }), w = (k) => ({ pubkey: k instanceof W.PublicKey ? k : new W.PublicKey(k), isSigner: false, isWritable: true });
      return new W.TransactionInstruction({
        programId: new W.PublicKey(DAMM), data: Uint8Array.from([...IX_SWAP2, ...le64(amountIn), ...le64(minOut), 0]),
        keys: [r(POOL_AUTH), w(lv.poolAddr), w(buy ? solAta : coinAta), w(buy ? coinAta : solAta), w(lv.p.vaultA), w(lv.p.vaultB), r(lv.token), r(WSOL),
          { pubkey: me, isSigner: true, isWritable: false }, r(TOKEN22), r(TOKEN), r(DAMM), r(DAMM_EVENTS), r(DAMM)],
      });
    },
    close: (W, me) => new W.TransactionInstruction({ programId: new W.PublicKey(TOKEN), data: Uint8Array.from([9]), keys: [{ pubkey: ataOf(W, me, WSOL, TOKEN), isSigner: false, isWritable: true }, { pubkey: me, isSigner: false, isWritable: true }, { pubkey: me, isSigner: true, isWritable: false }] }),
  };
  async function buy(x, weiIn, minOut) {
    const lv = x.live && x.live.sol ? x.live.sol : await live(x), lamports = BigInt(weiIn) / W9;
    return send((W, me) => [
      ixs.ata(W, me, me, lv.token, TOKEN22), ixs.ata(W, me, me, WSOL, TOKEN),
      W.SystemProgram.transfer({ fromPubkey: me, toPubkey: ataOf(W, me, WSOL, TOKEN), lamports }),
      new W.TransactionInstruction({ programId: new W.PublicKey(TOKEN), data: Uint8Array.from([17]), keys: [{ pubkey: ataOf(W, me, WSOL, TOKEN), isSigner: false, isWritable: true }] }),
      ixs.swap(W, lv, me, true, lamports, BigInt(minOut)), ixs.close(W, me),
    ]);
  }
  async function sell(x, coinIn, minOut) {
    const lv = x.live && x.live.sol ? x.live.sol : await live(x);
    return send((W, me) => [ixs.ata(W, me, me, WSOL, TOKEN), ixs.swap(W, lv, me, false, BigInt(coinIn), BigInt(minOut) / W9), ixs.close(W, me)]);
  }
  /** claim_fees: anyone may call it; the creator gets the creator's share, the platform its own. */
  async function claim(x) {
    const lv = await live(x);
    return send(async (W, me) => {
      const config = pda(W, [enc.encode('config2')], PROGRAM);
      const [cfgD] = await accounts([config.toBase58()]);
      const feeRecipient = key(cfgD, 40);
      const r = (k) => ({ pubkey: new W.PublicKey(k), isSigner: false, isWritable: false }), w = (k) => ({ pubkey: k instanceof W.PublicKey ? k : new W.PublicKey(k), isSigner: false, isWritable: true });
      return [new W.TransactionInstruction({
        programId: new W.PublicKey(PROGRAM), data: Uint8Array.from(IX_CLAIM),
        keys: [{ pubkey: me, isSigner: true, isWritable: true }, r(config), w(lv.coinPda), r(lv.token), r(WSOL),
          w(ataOf(W, lv.coinPda, lv.token, TOKEN22)), w(ataOf(W, lv.coinPda, WSOL, TOKEN)), r(lv.creator), w(ataOf(W, lv.creator, WSOL, TOKEN)),
          r(feeRecipient), w(ataOf(W, feeRecipient, WSOL, TOKEN)), r(lv.poolAddr), w(lv.position), r(lv.nftAccount),
          w(lv.p.vaultA), w(lv.p.vaultB), r(POOL_AUTH), r(DAMM_EVENTS), r(DAMM), r(TOKEN22), r(TOKEN), r(ATA), r(W.SystemProgram.programId)],
      })];
    });
  }

  // ---------------------------------------------------------------- plug into V2
  const over = (name, fn) => { const orig = V2[name]; V2[name] = function (...a) { return fn(orig, ...a); }; };
  over('live', (orig, x, k) => (k === 'sol' ? live(x) : orig(x, k)));
  over('quote', (orig, lv, side, amt) => (lv && lv.sol ? quote(lv, side, amt) : orig(lv, side, amt)));
  over('balances', (orig, x, k, who) => (k === 'sol' ? balances(x, who && !/^0x/.test(who) ? who : null) : orig(x, k, who)));
  over('buy', (orig, x, k, wei, min) => (k === 'sol' ? buy(x, wei, min) : orig(x, k, wei, min)));
  over('sell', (orig, x, k, coins, min) => (k === 'sol' ? sell(x, coins, min) : orig(x, k, coins, min)));
  over('payCreator', (orig, x, k) => (k === 'sol' ? claim(x) : orig(x, k)));
  V2.sol = { live, quote, balances, buy, sell, claim, rpc, wallet: SOLW };
})();
