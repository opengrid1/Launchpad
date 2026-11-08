/* The AMM data layer (window.AMM): pairs and their numbers from the indexer (DATA.raw().amm), quotes from the router,
   and the writes: swaps, add and remove liquidity, farm deposits, withdrawals and harvests. The quote coin trades as
   native through the router (wrapped inside it). Amounts in and out of this module are floats in whole units. */
(function () {
  const C = window.CFG, X = window.ethers, A = () => C.amm || {}, W = () => APP.W;
  const low = (a) => String(a || '').toLowerCase();
  const I = {
    router: new X.Interface(['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)', 'function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) pure returns (uint256)', 'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256,uint256,uint256)', 'function addLiquidityNative(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountNativeMin, address to, uint256 deadline) payable returns (uint256,uint256,uint256)', 'function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256,uint256)', 'function removeLiquidityNative(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountNativeMin, address to, uint256 deadline) returns (uint256,uint256)', 'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])', 'function swapExactNativeForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])', 'function swapExactTokensForNative(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[])',
      'error Expired()', 'error InsufficientAAmount()', 'error InsufficientBAmount()', 'error InsufficientOutput()', 'error InvalidPath()', 'error ZeroAmount()', 'error InsufficientLiquidity()', 'error K()', 'error InsufficientLiquidityMinted()', 'error InsufficientLiquidityBurned()']),
    erc20: new X.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function decimals() view returns (uint8)']),
    farm: new X.Interface(['function users(uint256,address) view returns (uint256 amount, uint256 rewardDebt)', 'function pendingReward(uint256,address) view returns (uint256)', 'function deposit(uint256,uint256)', 'function withdraw(uint256,uint256)', 'function harvest(uint256)', 'function emergencyWithdraw(uint256)']),
    mc: new X.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])', 'function getEthBalance(address) view returns (uint256)']),
  };
  const ERR = { InsufficientOutput: 'The price moved past your slippage. Try again.', Expired: 'The transaction waited too long. Try again.', InsufficientLiquidity: 'Not enough liquidity in the pool for that size.', InsufficientAAmount: 'The pool ratio moved; lower the slippage tolerance or retry.', InsufficientBAmount: 'The pool ratio moved; lower the slippage tolerance or retry.', K: 'The pool rejected the trade. Try a smaller amount.' };
  const MC = () => C.chain.contracts.multicall || '0xcA11bde05977b3631167028862bE2a173976CA11';

  let rid = 0;
  async function rpc(method, params, tries = 5) {
    let last = '';
    for (let i = 0; i < tries; i++) {
      try { const r = await fetch(C.chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) }); const j = await r.json().catch(() => null); if (j && !j.error) return j.result; last = (j && j.error && j.error.message) || 'HTTP ' + r.status; if (j && j.error && j.error.data && !/rate|limit|busy/i.test(last)) { const e = new Error(last); e.data = j.error.data; throw e; } }
      catch (e) { if (e.data !== undefined) throw e; last = e.message; }
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
    throw new Error('RPC unavailable: ' + last);
  }
  const call = async (to, iface, fn, args) => iface.decodeFunctionResult(fn, await rpc('eth_call', [{ to, data: iface.encodeFunctionData(fn, args || []) }, 'latest']));
  async function multicall(calls) {
    if (!calls.length) return [];
    const data = I.mc.encodeFunctionData('aggregate3', [calls.map(([t, k, f, a]) => [t, true, I[k].encodeFunctionData(f, a || [])])]);
    const [out] = I.mc.decodeFunctionResult('aggregate3', await rpc('eth_call', [{ to: MC(), data }, 'latest']));
    return out.map(([ok, rd], n) => { if (!ok) return null; try { const r = I[calls[n][1]].decodeFunctionResult(calls[n][2], rd); return r.length === 1 ? r[0] : r; } catch { return null; } });
  }
  function revertText(e) {
    const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof d === 'string' && d.length >= 10) { for (const k of Object.keys(I)) { try { const p = I[k].parseError(d); if (p) return ERR[p.name] || `${p.name}(${p.args.map(String).join(', ')})`; } catch {} } }
    return APP.errMsg(e);
  }
  async function send(tx, label) {
    await W().require();
    const req = { from: W().address, to: tx.to, data: tx.data, value: '0x' + BigInt(tx.value || 0).toString(16), gas: '0x' + BigInt(tx.gas || 600000).toString(16) };
    try { await rpc('eth_call', [{ from: req.from, to: req.to, data: req.data, value: req.value }, 'latest'], 2); } catch (e) { if (e.data !== undefined) throw new Error(label + ' would fail: ' + revertText(e)); }
    let hash; try { hash = await W().provider.request({ method: 'eth_sendTransaction', params: [req] }); } catch (e) { throw new Error(revertText(e)); }
    const t = APP.toast(label + ': waiting for the block…', 'info', 120000);
    try {
      const t0 = Date.now();
      while (Date.now() - t0 < 180000) { const r = await rpc('eth_getTransactionReceipt', [hash], 2).catch(() => null); if (r) { if (parseInt(r.status, 16) !== 1) throw new Error(label + ' reverted. ' + APP.explorer('tx', hash)); return { hash, receipt: r }; } await new Promise((s) => setTimeout(s, 1500)); }
      throw new Error('Still waiting for ' + hash);
    } finally { t.remove(); }
  }
  const wei = (v, d = 18) => X.parseUnits((Number(v) || 0).toFixed(Math.min(d, 12)), d);
  const unit = (v, d = 18) => Number(X.formatUnits(v || 0n, d));
  // deadline from the chain's clock (the latest block), not the device clock
  const dl = async () => { let ts = 0; try { const b = await rpc('eth_getBlockByNumber', ['latest', false]); ts = parseInt(b.timestamp, 16) || 0; } catch {} return BigInt(Math.max(ts, Math.floor(Date.now() / 1000)) + 900); };
  async function ensureAllowance(token, spender, amount) {
    const [a] = await call(token, I.erc20, 'allowance', [W().address, spender]);
    if (a < amount) { APP.toast('Approve the token (once)', 'info', 5000); await send({ to: token, data: I.erc20.encodeFunctionData('approve', [spender, X.MaxUint256]), gas: 100000 }, 'Approve'); }
  }

  // ---- reads
  const state = () => (window.DATA && DATA.raw ? (DATA.raw() || {}).amm : null) || null;
  const live = () => !!(A().factory && A().router);
  const W_ = () => low((state() || {}).wnative || A().wnative); // the indexer reads it from the deployment; config is the fallback
  const isNative = (a) => a === 'native' || low(a) === W_();
  // token info: a launched coin (with its logo and price) or any ERC-20 the indexer saw in a pair
  function tokenInfo(addr) {
    if (isNative(addr)) return { addr: 'native', symbol: C.chain.quote, name: C.chain.quoteName || C.chain.quote, decimals: 18, img: C.chain.logo, native: true, px: 1 };
    const a = low(addr), t = window.DATA && DATA.token ? DATA.token(a) : null, m = ((state() || {}).tokens || {})[a] || {};
    return { addr: a, symbol: t ? t.symbol : m.symbol || APP.shortAddr(a), name: t ? t.name : m.name || '', decimals: m.decimals ?? 18, img: t ? t.img : APP.defaultImg(m.symbol || '?', a), native: false, coin: t || null, px: t ? t.px : pxFromPairs(a) };
  }
  // a token's price in the quote coin from its native pair, if it has one
  function pxFromPairs(a) { const p = (state() || { pairs: [] }).pairs.find((p) => (p.token0 === a && p.token1 === W_()) || (p.token1 === a && p.token0 === W_())); if (!p) return 0; const nat = p.token0 === W_() ? Number(p.r0) / 1e18 : Number(p.r1) / 1e18, dec = (((state() || {}).tokens || {})[a] || {}).decimals ?? 18, tok = p.token0 === a ? Number(p.r0) / 10 ** dec : Number(p.r1) / 10 ** dec; return tok > 0 ? nat / tok : 0; }
  function pairs() {
    const s = state(); if (!s) return [];
    const f = s.farm, feeBps = (s.lpFeeBps || 25) + (s.protocolFeeBps || 5), lpBps = s.lpFeeBps || 25;
    return s.pairs.map((p) => {
      const t0 = tokenInfo(p.token0), t1 = tokenInfo(p.token1);
      const r0 = unit(BigInt(p.r0), t0.decimals), r1 = unit(BigInt(p.r1), t1.decimals), v0 = unit(BigInt(p.vol0), t0.decimals), v1 = unit(BigInt(p.vol1), t1.decimals);
      const px0 = t0.native ? 1 : t0.px || (r0 > 0 && t1.native ? r1 / r0 : 0), px1 = t1.native ? 1 : t1.px || (r1 > 0 && t0.native ? r0 / r1 : 0);
      const tvl = r0 * px0 + r1 * px1, vol = (v0 * px0 + v1 * px1) / 2; // volume counted once (in and out legs)
      const fees = vol * lpBps / 10000, feeApr = tvl > 0 ? fees * 365 / tvl * 100 : 0;
      const lp = unit(BigInt(p.lp)), fp = f && f.pools.find((x) => x.lp === p.addr);
      let farm = null;
      if (fp) { const rate = f.periodFinish > Date.now() / 1000 && Number(f.totalAllocPoint) > 0 ? unit(BigInt(f.rewardRate)) * Number(fp.allocPoint) / Number(f.totalAllocPoint) : 0; const staked = unit(BigInt(fp.totalStaked)), stakedVal = lp > 0 ? staked / lp * tvl : 0; farm = { pid: fp.pid, allocPoint: Number(fp.allocPoint), staked, stakedVal, rate, apr: stakedVal > 0.001 ? rate * 365 * 86400 / stakedVal * 100 : null }; } // null: nothing staked yet, so no meaningful APR
      return { addr: p.addr, t0, t1, r0, r1, tvl, tvlUsd: tvl * APP.hypeUsd, vol, volUsd: vol * APP.hypeUsd, fees, feeApr, feeBps, lp, swaps24: p.swaps24, createdAt: p.createdAt, farm, native: t0.native || t1.native, nativeSide: t0.native ? 0 : t1.native ? 1 : -1 };
    }).sort((a, b) => b.tvl - a.tvl);
  }
  const pair = (addr) => pairs().find((p) => p.addr === low(addr)) || null;
  // every token tradable on the AMM (the quote coin, every token with a pair)
  function tokens() { const seen = new Map(); for (const p of pairs()) for (const t of [p.t0, p.t1]) if (!t.native) seen.set(t.addr, t); return [...seen.values()]; }
  function path(aIn, aOut) {
    const wn = W_(), a = isNative(aIn) ? wn : low(aIn), b = isNative(aOut) ? wn : low(aOut); if (a === b) return null;
    const has = (x, y) => (state() || { pairs: [] }).pairs.some((p) => (p.token0 === x && p.token1 === y) || (p.token0 === y && p.token1 === x));
    if (has(a, b)) return [a, b]; if (a !== wn && b !== wn && has(a, wn) && has(wn, b)) return [a, wn, b]; return null;
  }
  async function quote(aIn, aOut, amountIn) {
    const p = path(aIn, aOut); if (!p || !(amountIn > 0)) return null;
    const ti = tokenInfo(aIn), to = tokenInfo(aOut);
    const [amts] = await call(A().router, I.router, 'getAmountsOut', [wei(amountIn, ti.decimals), p]);
    const out = unit(amts[amts.length - 1], to.decimals);
    // price impact against the first pool's spot
    const pr = pairs().find((x) => (x.t0.addr === (isNative(p[0]) ? 'native' : p[0]) || x.t0.addr === p[0] || (x.t0.native && p[0] === W_())) && (x.t1.addr === p[1] || (x.t1.native && p[1] === W_()))) || pairs().find((x) => (x.t1.addr === p[0] || (x.t1.native && p[0] === W_())) && (x.t0.addr === p[1] || (x.t0.native && p[1] === W_())));
    let impact = 0; if (pr && p.length === 2) { const inIs0 = (pr.t0.native && isNative(aIn)) || pr.t0.addr === low(aIn); const rIn = inIs0 ? pr.r0 : pr.r1, rOut = inIs0 ? pr.r1 : pr.r0; const spot = rOut / rIn, eff = out / amountIn; impact = spot > 0 ? Math.max(0, (1 - eff / spot) * 100 - (pr.feeBps / 100)) : 0; }
    return { out, path: p, hops: p.length - 1, feeBps: ((state() || {}).lpFeeBps || 25) + ((state() || {}).protocolFeeBps || 5), impact };
  }
  // ---- writes
  async function swap(aIn, aOut, amountIn, minOut) {
    const p = path(aIn, aOut); if (!p) throw new Error('No AMM route between these tokens'); const ti = tokenInfo(aIn), to = tokenInfo(aOut), me = W().address;
    const amt = wei(amountIn, ti.decimals), min = wei(Math.max(0, minOut), to.decimals), R = A().router;
    if (isNative(aIn)) return send({ to: R, data: I.router.encodeFunctionData('swapExactNativeForTokens', [min, p, me, await dl()]), value: amt, gas: 300000 + 120000 * p.length }, 'Swap');
    await ensureAllowance(ti.addr, R, amt);
    if (isNative(aOut)) return send({ to: R, data: I.router.encodeFunctionData('swapExactTokensForNative', [amt, min, p, me, await dl()]), gas: 300000 + 120000 * p.length }, 'Swap');
    return send({ to: R, data: I.router.encodeFunctionData('swapExactTokensForTokens', [amt, min, p, me, await dl()]), gas: 300000 + 120000 * p.length }, 'Swap');
  }
  // adds a token with the quote coin (the common case) or two tokens; amounts in whole units, slippage in bps
  async function addLiquidity(a, b, amountA, amountB, slipBps = 100) {
    const me = W().address, R = A().router, ta = tokenInfo(a), tb = tokenInfo(b);
    const wa = wei(amountA, ta.decimals), wb = wei(amountB, tb.decimals), minA = wa * BigInt(10000 - slipBps) / 10000n, minB = wb * BigInt(10000 - slipBps) / 10000n;
    if (ta.native || tb.native) {
      const tok = ta.native ? tb : ta, wt = ta.native ? wb : wa, wn = ta.native ? wa : wb, mt = ta.native ? minB : minA, mn = ta.native ? minA : minB;
      await ensureAllowance(tok.addr, R, wt);
      return send({ to: R, data: I.router.encodeFunctionData('addLiquidityNative', [tok.addr, wt, mt, mn, me, await dl()]), value: wn, gas: 2600000 }, 'Add liquidity');
    }
    await ensureAllowance(ta.addr, R, wa); await ensureAllowance(tb.addr, R, wb);
    return send({ to: R, data: I.router.encodeFunctionData('addLiquidity', [ta.addr, tb.addr, wa, wb, minA, minB, me, await dl()]), gas: 2600000 }, 'Add liquidity');
  }
  async function removeLiquidity(pairAddr, lpAmount, slipBps = 100) {
    const p = pair(pairAddr); if (!p) throw new Error('Unknown pool'); const me = W().address, R = A().router, lp = typeof lpAmount === 'string' ? X.parseEther(lpAmount) : wei(lpAmount); lpAmount = Number(lpAmount);
    const share = p.lp > 0 ? lpAmount / p.lp : 0, min0 = wei(p.r0 * share * (1 - slipBps / 10000), p.t0.decimals), min1 = wei(p.r1 * share * (1 - slipBps / 10000), p.t1.decimals);
    await ensureAllowance(p.addr, R, lp);
    if (p.native) { const tok = p.t0.native ? p.t1 : p.t0, mt = p.t0.native ? min1 : min0, mn = p.t0.native ? min0 : min1; return send({ to: R, data: I.router.encodeFunctionData('removeLiquidityNative', [tok.addr, lp, mt, mn, me, await dl()]), gas: 500000 }, 'Remove liquidity'); }
    return send({ to: R, data: I.router.encodeFunctionData('removeLiquidity', [p.t0.addr, p.t1.addr, lp, min0, min1, me, await dl()]), gas: 500000 }, 'Remove liquidity');
  }
  async function farmDeposit(pid, pairAddr, amount) { const lp = typeof amount === 'string' ? X.parseEther(amount) : wei(amount); await ensureAllowance(pairAddr, A().farm, lp); return send({ to: A().farm, data: I.farm.encodeFunctionData('deposit', [pid, lp]), gas: 300000 }, 'Stake LP'); }
  async function farmWithdraw(pid, amount) { return send({ to: A().farm, data: I.farm.encodeFunctionData('withdraw', [pid, typeof amount === 'string' ? X.parseEther(amount) : wei(amount)]), gas: 300000 }, 'Unstake LP'); }
  async function farmHarvest(pid) { return send({ to: A().farm, data: I.farm.encodeFunctionData('harvest', [pid]), gas: 250000 }, 'Harvest'); }
  // the connected wallet's numbers for a pool: token balances, LP balance, staked LP, pending rewards
  async function my(p) {
    const me = W().connected ? W().address : null; if (!me || !p) return null;
    const calls = [[p.addr, 'erc20', 'balanceOf', [me]], [p.t0.native ? MC() : p.t0.addr, p.t0.native ? 'mc' : 'erc20', p.t0.native ? 'getEthBalance' : 'balanceOf', [me]], [p.t1.native ? MC() : p.t1.addr, p.t1.native ? 'mc' : 'erc20', p.t1.native ? 'getEthBalance' : 'balanceOf', [me]]];
    if (p.farm) calls.push([A().farm, 'farm', 'users', [p.farm.pid, me]], [A().farm, 'farm', 'pendingReward', [p.farm.pid, me]]);
    const r = await multicall(calls);
    // exact strings for Max buttons: a rounded float can exceed the real balance by a few wei
    return { lp: unit(r[0]), lpStr: X.formatEther(r[0] || 0n), bal0: unit(r[1], p.t0.decimals), bal1: unit(r[2], p.t1.decimals), staked: p.farm && r[3] ? unit(r[3][0]) : 0, stakedStr: p.farm && r[3] ? X.formatEther(r[3][0]) : '0', pending: p.farm ? unit(r[4]) : 0 };
  }
  async function balanceOf(addr) { const me = W().connected ? W().address : null; if (!me) return 0; const t = tokenInfo(addr); if (t.native) return unit(await rpc('eth_getBalance', [me, 'latest'])); const [b] = await call(t.addr, I.erc20, 'balanceOf', [me]); return unit(b, t.decimals); }
  window.AMM = { live, state, tokenInfo, pairs, pair, tokens, path, quote, swap, addLiquidity, removeLiquidity, farmDeposit, farmWithdraw, farmHarvest, my, balanceOf, isNative, revertText };
})();
