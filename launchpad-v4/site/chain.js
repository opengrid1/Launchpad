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
  // preview (CFG.demo, no contracts live yet): sample coins from /demo-state.json, sample leverage, no transactions
  const DEMO = !!C.demo && !C.liveChains().length;
  const KK = (net) => C.chainOf(net || C.chain.key).contracts, NETS = () => (DEMO ? [C.chains[0].key] : C.liveChains().map((c) => c.key));
  const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
  const Q96 = 2 ** 96, low = (a) => String(a || '').toLowerCase();
  const I = {
    factory: new X.Interface(['function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt,uint256 openingBuy,uint256 minTokensOut) params, uint256 launchConfigId) payable returns (address)', 'function previewLaunchEconomics(uint256) view returns (bytes32)', 'function launchFee() view returns (uint256)', 'function launchEnabled() view returns (bool)', 'function canLaunch(address) view returns (bool)', 'event TokenLaunched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 launchConfigId, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, uint256[3] positionIds)', 'error NotWhitelisted()', 'error LaunchFeeNotPaid()', 'error LogoRequired()', 'error InvalidTokenParams()', 'error LinkInDescription()', 'error CreatorTaxTooHigh()', 'error OpeningBuyTooLarge()', 'error EconomicsMismatch()', 'error LaunchConfigDisabled()']),
    erc20: new X.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']),
    permit2: new X.Interface(['function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)', 'function approve(address token, address spender, uint160 amount, uint48 expiration)']),
    router: new X.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable', 'error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)', 'error V4TooMuchRequested(uint256 maxAmountInRequested, uint256 amountRequested)', 'error DeadlinePassed(uint256 deadline)', 'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)']),
    escrow: new X.Interface(['function claim() returns (uint256)', 'function balanceOf(address) view returns (uint256)']),
    // BuzzPad v2: the launch config picks the pair; fees are paid out by the hook in the pair
    factory2: new X.Interface(['function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bytes32 expectedEconomics,bytes32 salt,uint256 openingBuy,uint256 minTokensOut) params, uint256 launchConfigId) payable returns (address)', 'function previewLaunchEconomics(uint256) view returns (bytes32)', 'function launchFee() view returns (uint256)', 'function launchEnabled() view returns (bool)', 'function canLaunch(address) view returns (bool)', 'event TokenLaunched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 launchConfigId, address pairToken, address creatorFeeRecipient, uint16 creatorTaxBps, uint256[3] positionIds)', 'error NotWhitelisted()', 'error LaunchFeeNotPaid()', 'error LogoRequired()', 'error InvalidTokenParams()', 'error LinkInDescription()', 'error CreatorTaxTooHigh()', 'error OpeningBuyTooLarge(uint256,uint256)', 'error LaunchEconomicsMismatch(bytes32,bytes32)', 'error LaunchConfigDisabled()', 'error PairTokenValidationFailed()']),
    hook2: new X.Interface(['function payout(bytes32 poolId) returns (uint256 creatorPaid, uint256 protocolPaid)', 'function pendingCreator(bytes32) view returns (uint256)', 'error ExactOutputSellUnsupported()']),
    mc: new X.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])', 'function getEthBalance(address) view returns (uint256)']),
    // Zappy leverage: longs funded by each coin's own pool (ZappyMargin borrowing from the ZappyLocker)
    margin: new X.Interface(['function open(address token, uint256 leverageBps, uint256 minTokens, uint256 minPairIn) payable returns (uint256)', 'function close(uint256 id, uint256 minOut) returns (uint256)', 'function addMargin(uint256 id, uint256 minPairIn) payable', 'function flag(uint256 id)', 'function liquidate(uint256 id)', 'function claim(address pair)', 'function claimable(address, address) view returns (uint256)', 'function minDepthOf(address pair) view returns (uint256)',
      'function opensEnabled() view returns (bool)', 'function maxLeverageBps() view returns (uint256)', 'function borrowFeeBps() view returns (uint256)', 'function minMargin() view returns (uint256)', 'function minCoinAge() view returns (uint256)', 'function minPoolDepth() view returns (uint256)', 'function maintenanceBps() view returns (uint256)', 'function liquidationDelay() view returns (uint256)', 'function keeperRewardBps() view returns (uint256)',
      'function maxMargin(address token, uint256 leverageBps) view returns (uint256)', 'function poolDepth(address token) view returns (uint256)', 'function positionsOf(address owner) view returns (uint256[])', 'function positions(uint256) view returns (address owner, address token, address pair, uint256 tokens, uint256 principal, uint256 margin, uint40 openedAt, uint40 flaggedAt, uint32 leverageBps)', 'function health(uint256 id) view returns (uint256 debt, uint256 value, bool liquidatable)', 'function liquidationPrice(uint256 id) view returns (uint256)',
      'error OpensDisabled()', 'error CoinTooNew(uint256 opensAt)', 'error PoolTooThin(uint256 depth, uint256 minimum)', 'error InvalidLeverage()', 'error MarginTooSmall(uint256 minimum)', 'error NotEnoughToBorrow(uint256 available)', 'error PositionTooLarge(uint256 maximum)', 'error Slippage(uint256 got, uint256 minimum)', 'error OpensUnhealthy()', 'error NotOwner()', 'error NoPosition()', 'error Healthy()', 'error NotFlagged()', 'error DelayNotElapsed(uint256 at)', 'error Underwater(uint256 proceeds, uint256 debt)', 'error NoPairRoute()', 'error UnknownCoin()']),
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
  const ERR = { OpensDisabled: 'Leverage is paused right now.', CoinTooNew: 'Leverage opens 10 minutes after a coin launches.', PoolTooThin: 'This coin\'s pool is too thin for leverage yet.', NotEnoughToBorrow: 'The pool cannot lend that much right now. Try a smaller size.', PositionTooLarge: 'That position is too large for this pool. Try a smaller size.', MarginTooSmall: 'The margin is below the minimum.', OpensUnhealthy: 'The price impact is too high for that size. Try a smaller size.', Underwater: 'The position is worth less than its debt; it can only be liquidated.', Slippage: 'The price moved past your slippage. Try again.', Healthy: 'The position is healthy again.', DelayNotElapsed: 'Wait a few more seconds before liquidating.',
    V4TooLittleReceived: 'The price moved past your slippage. Raise the slippage or trade a smaller amount.', DeadlinePassed: 'The transaction waited too long. Try again.', OpeningBuyTooLarge: 'The opening buy is over 5% of the supply.', LogoRequired: 'Add an image for the token.', LinkInDescription: 'Remove the link from the description.', NotWhitelisted: 'Launches are paused right now.' };
  function revertText(e) {
    const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof d === 'string' && d.length >= 10) for (const f of Object.values(I)) { try { const p = f.parseError(d); if (p) return ERR[p.name] || p.name; } catch {} }
    const m = APP.errMsg(e); if (/timed? ?out|busy|unavailable/i.test(m)) return C.chain.name + "'s RPC is busy, so the wallet could not send. Try again in a moment.";
    return m;
  }
  async function send(tx, label) {
    if (DEMO) throw new Error('Preview: the contracts go live soon. Nothing was sent.');
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
  // v2 coins can pair with an ERC-20 (AZTEC, WXMR): their pool math stays in pair units, and every price, volume and
  // fee the pages show is converted to the chain's native coin at the pair's live price (from the indexer)
  const ZERO = '0x0000000000000000000000000000000000000000';
  const V2of = (net) => C.chainOf(net || C.chain.key).v2 || null;
  const isErc = (t) => t && t.v === 2 && t.pair && t.pair !== ZERO;
  const pairInfo = (t) => (isErc(t) ? (stOf(t.net).pairs || {})[t.pair] || null : null);
  const pairMeta = (t) => { const v2 = V2of(t.net); return ((v2 && v2.pairs) || []).find((p) => low(p.addr) === low(t.pair || ZERO)) || { sym: C.chainOf(t.net).quote, logo: C.chainOf(t.net).logo, addr: ZERO }; };
  const ethPer = (t) => { if (!isErc(t)) return 1; const p = pairInfo(t); return p && p.perEth > 0 ? 1 / p.perEth : 0; };
  const hopKeep = (p) => 1 - (p.feeCut || 0); // a stock route keeps this share after its pools' fees
  function ethToPair(t, eth) { if (!isErc(t)) return eth; const p = pairInfo(t); if (!p) return 0; if (p.route === 'v2') { const a = eth * 0.997; return (a * p.reservePair) / (p.reserveEth + a); } return eth * p.perEth * (p.feeCut ? hopKeep(p) : 1); }
  function pairToEth(t, x) { if (!isErc(t)) return x; const p = pairInfo(t); if (!p) return 0; if (p.route === 'v2') { const a = x * 0.997; return (a * p.reserveEth) / (p.reservePair + a); } return (x / p.perEth) * (p.feeCut ? hopKeep(p) : 0.999); }
  function index() {
    ALL = []; BY.clear(); TR.clear(); VIEW = new Map();
    for (const net of Object.keys(SS)) {
      for (const t of SS[net].tokens) { t.net = net; ALL.push(t); BY.set(t.addr, t); }
      for (const tr of SS[net].trades) {
        const t = BY.get(tr.t); if (!tr._eth && isErc(t)) { const k = ethPer(t); tr.h *= k; tr.f *= k; tr.ft *= k; tr.fx *= k; tr.p *= k; tr._eth = 1; }
        (TR.get(tr.t) || TR.set(tr.t, []).get(tr.t)).push(tr);
      }
    }
    for (const a of TR.values()) a.sort((x, y) => x.ts - y.ts || x.blk - y.blk);
  }
  async function load1(net, fresh) {
    if (loading[net]) return loading[net];
    loading[net] = (async () => { const r = await fetch(DEMO ? '/demo-state.json' : '/api/state?chain=' + net + (fresh ? '&t=' + Date.now() : ''), { cache: fresh ? 'no-store' : 'default' }); if (!r.ok) throw new Error('state ' + r.status); const j = await r.json(); if (j.error) throw new Error(j.error); if (!SS[net] || j.block >= SS[net].block || fresh) { SS[net] = j; index(); APP.emit(); } })().finally(() => { loading[net] = null; });
    return loading[net];
  }
  const load = (fresh, net) => Promise.all((net ? [net] : NETS()).map((n) => load1(n, fresh).catch((e) => console.warn('state ' + n, e.message))));
  async function refreshMine() {
    const w = APP.W.connected ? APP.W.address : ''; if (!w) { hypeFor = ''; return; }
    const net = C.chain.key; try { hypeBal[net] = Number(X.formatEther(await rpc('eth_getBalance', [w, 'latest'], 4, net))); hypeFor = w; APP.emit(); } catch {}
  }

  // ---- pool math over the locked bands (floats in wei units; quotes only, the chain enforces the minimum)
  const sqrtAt = (tick) => Math.pow(1.0001, tick / 2);
  // the price snaps to a band edge it sits on within float error (a new pool opens exactly on its first band's edge;
  // 1.0001^(tick/2) in floats can land a hair either side, and a swap simulated from the wrong side skips the band)
  const poolOf = (t) => { let sq = t.sqrtP ? Number(t.sqrtP) / Q96 : null; const ranges = t.ranges.map((r) => ({ a: sqrtAt(r.lo), b: sqrtAt(r.hi), L: Number(r.liq) })); if (sq) for (const r of ranges) for (const e of [r.a, r.b]) if (Math.abs(sq / e - 1) < 1e-9) sq = e; return { sq, ranges }; };
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
    return { hype: h * ethPer(t), tokens: k };
  }

  // ---- fees, as the hook applies them
  function feeState(a) {
    const t = BY.get(low(a)); if (!t) return null; const T = t.terms || { launchedAt: t.createdAt, snipeStartBps: E.snipeStartBps, snipeSeconds: E.snipeSeconds, volExtraBps: 200, volDecay: E.volDecaySec, hookFeeBps: E.feeBps };
    const base = T.hookFeeBps ?? E.feeBps, n = now(t.net), el = n - T.launchedAt;
    let extra = 0, left = 0; if (t.lastSpike && T.volExtraBps && n - t.lastSpike < T.volDecay) { extra = Math.round(T.volExtraBps * (1 - (n - t.lastSpike) / T.volDecay)); left = T.volDecay - (n - t.lastSpike); }
    if (T.snipeSeconds && el >= 0 && el < T.snipeSeconds) { const s = T.snipeStartBps >> Math.floor((el * 14) / T.snipeSeconds); const sn = Math.min(s, 9900 - base - t.taxBps); return { kind: 'snipe', bps: base + t.taxBps, snipeBps: sn, left: T.snipeSeconds - el, total: base + t.taxBps + sn, extraBps: 0 }; }
    return { kind: extra > 0 ? 'vol' : 'base', bps: base + t.taxBps, extraBps: extra, left, total: base + t.taxBps + extra };
  }
  // A trade that itself moves the price past the volatility threshold (against the price at the start of the hook's
  // window) pays the full volatility fee on that same trade: the hook reads the price after the swap.
  function selfSpike(t, sqEnd) {
    const T = t.terms || {}; if (!T.volExtraBps || !T.volThresholdBps || !sqEnd) return false;
    const n = now(t.net); if (T.snipeSeconds && n - T.launchedAt < T.snipeSeconds) return false;
    const trs = TR.get(t.addr) || [], th = T.volThresholdBps / 1e4, sq0 = poolOf(t).sq;
    let pxRef = startPx(t); for (let i = trs.length - 1; i >= 0; i--) if (trs[i].ts <= n - (T.volWindow || 60)) { pxRef = trs[i].p; break; }
    const refs = [sq0, pxRef > 0 ? 1 / Math.sqrt(pxRef) : 0].filter((x) => x > 0);
    return refs.some((r) => { const ratio = (sqEnd / r) ** 2; return ratio >= 1 + th || ratio <= 1 - th; });
  }
  function cutFor(t, fs, sqEnd, buy) { // total basis points the hook takes from this trade's output
    const T = t.terms || {}; let extra = fs.extraBps || 0;
    if (fs.kind !== 'snipe' && selfSpike(t, sqEnd)) extra = Math.max(extra, T.volExtraBps || 0);
    return fs.kind === 'snipe' ? (buy ? Math.min(9900, fs.total) : fs.bps) : Math.min(9900, fs.bps + extra);
  }
  // v2: the fee comes off the pair amount before the swap (buys) or after it (sells), priced from the pool's state
  // before the trade, so a trade never raises its own fee
  function rateV2(fs, buy) { return fs.kind === 'snipe' ? (buy ? Math.min(9900, fs.total) : fs.bps) : Math.min(9900, fs.bps + (fs.extraBps || 0)); }
  function quoteBuyV2(t, ethIn) {
    const raw = pxOf(poolOf(t).sq), px = raw * ethPer(t); if (!(ethIn > 0)) return { tokens: 0, fee: 0, snipe: 0, px, impact: 0, feeBps: 0 };
    const fs = feeState(t.addr), rate = rateV2(fs, true), snipe = fs.kind === 'snipe' ? Math.min(fs.snipeBps, rate) : 0;
    const pairIn = ethToPair(t, ethIn), sim = swapSim(t, true, pairIn * (1 - rate / 1e4) * 1e18);
    return { tokens: sim.out / 1e18, fee: (ethIn * (rate - snipe)) / 1e4, snipe: (ethIn * snipe) / 1e4, feeBps: rate, px, impact: raw ? (pxOf(sim.sq) / raw - 1) * 100 : 0, pairIn };
  }
  function quoteSellV2(t, tokensIn) {
    const raw = pxOf(poolOf(t).sq), px = raw * ethPer(t); if (!(tokensIn > 0)) return { hype: 0, fee: 0, px, impact: 0, feeBps: 0 };
    const fs = feeState(t.addr), rate = rateV2(fs, false), sim = swapSim(t, false, tokensIn * 1e18), gross = sim.out / 1e18;
    return { hype: pairToEth(t, gross * (1 - rate / 1e4)), fee: pairToEth(t, (gross * rate) / 1e4), feeBps: rate, px, impact: raw ? (pxOf(sim.sq) / raw - 1) * 100 : 0, pairOut: gross * (1 - rate / 1e4) };
  }
  function quoteBuy(a, chain, hypeIn) {
    const t0 = BY.get(low(a)); if (t0 && t0.v === 2) return quoteBuyV2(t0, hypeIn);
    const t = t0; const px = t ? pxOf(poolOf(t).sq) : 0; if (!t || !(hypeIn > 0)) return { tokens: 0, fee: 0, snipe: 0, px, impact: 0, feeBps: 0 };
    const fs = feeState(a), snipe = fs.kind === 'snipe' ? fs.snipeBps : 0;
    const sim = swapSim(t, true, hypeIn * 1e18), cutBps = cutFor(t, fs, sim.sq, true), gross = sim.out / 1e18, tokens = gross * (1 - cutBps / 1e4), avg = gross > 0 ? hypeIn / gross : px;
    return { tokens, fee: gross * ((cutBps - snipe) / 1e4) * avg, snipe: gross * (snipe / 1e4) * avg, feeBps: cutBps, px, impact: px ? (pxOf(sim.sq) / px - 1) * 100 : 0 };
  }
  function quoteSell(a, chain, tokensIn) {
    const t = BY.get(low(a)); if (t && t.v === 2) return quoteSellV2(t, tokensIn); const px = t ? pxOf(poolOf(t).sq) : 0; if (!t || !(tokensIn > 0)) return { hype: 0, fee: 0, px, impact: 0, feeBps: 0 };
    const fs = feeState(a), sim = swapSim(t, false, tokensIn * 1e18), cutBps = cutFor(t, fs, sim.sq, false), gross = sim.out / 1e18;
    return { hype: gross * (1 - cutBps / 1e4), fee: gross * cutBps / 1e4, feeBps: cutBps, px, impact: px ? (pxOf(sim.sq) / px - 1) * 100 : 0 };
  }

  // ---- views in the shape the pages use
  const trView = (tr) => ({ tx: tr.tx, chain: 'hyper', wallet: tr.w, buy: !!tr.b, hype: tr.h, tokens: tr.k, fee: tr.f, feeBps: tr.fb, snipeBps: tr.s, volBps: tr.v, px: tr.p, ts: tr.ts });
  function startPx(t) { const r = t.ranges.length ? Math.max(...t.ranges.map((x) => x.hi)) : 0; return r ? pxOf(sqrtAt(r)) * ethPer(t) : E.openMcapHype / SUPPLY; }
  function poolView(t) {
    const trs = TR.get(t.addr) || [], px = t.sqrtP ? pxOf(poolOf(t).sq) * ethPer(t) : startPx(t), n = now(t.net), held = bandsHeld(t);
    const pxAgo = (s) => { const cut = n - s; for (let i = trs.length - 1; i >= 0; i--) if (trs[i].ts <= cut) return trs[i].p; return t.createdAt <= cut ? (trs[0] ? startPx(t) : px) : startPx(t); };
    let vol24 = 0, volAll = 0, feesAll = 0, buys24 = 0, sells24 = 0; for (const tr of trs) { volAll += tr.h; feesAll += tr.f; if (tr.ts > n - 86400) { vol24 += tr.h; tr.b ? buys24++ : sells24++; } }
    return { chain: 'hyper', px, pxUsd: px * APP.hypeUsd, mcap: px * SUPPLY, liqHype: held.hype + held.tokens * px, hypeInPool: held.hype, vol24, volAll, feesAll, trades: trs.length, buys24, sells24, c5: (px / pxAgo(300) - 1) * 100, c1: (px / pxAgo(3600) - 1) * 100, c24: (px / pxAgo(86400) - 1) * 100, inPool: held.tokens, poolId: t.poolId, lockedIds: t.posIds, fee: feeState(t.addr), lastTs: trs.length ? trs[trs.length - 1].ts : t.createdAt };
  }
  const isPool = (t, w) => { const k = KK(t.net), v2 = V2of(t.net) || {}; return w === low(k.poolManager) || w === low(k.locker) || w === low(k.factory) || w === low(k.hook) || w === low(v2.locker) || w === low(v2.factory) || w === low(v2.hook) || (v2.margin && w === low(v2.margin)); };
  // the leverage a coin offers now, from the margin contract's default terms (CFG.leverage overrides): an ETH-pair coin
  // old enough with enough ETH in its pool; 0 where there is none (the token page reads the live terms)
  function levMaxOf(t, m) {
    const L = C.leverage || {}, on = DEMO || !!(V2of(t.net) || {}).margin; if (!on) return 0;
    if (now(t.net) - t.createdAt < (L.minAgeSec ?? 600) || m.hypeInPool < (L.minPoolEth ?? 5)) return 0;
    return L.max ?? 3;
  }
  function view(t) {
    const cached = VIEW.get(t.addr); if (cached && cached._usd === APP.hypeUsd) return cached; // rebuilt when the USD price arrives or moves
    const m = poolView(t), T = t.terms || {};
    const v = { addr: t.addr, mint: '', name: t.name, symbol: t.symbol, emoji: '', img: t.logo || APP.defaultImg(t.symbol, t.addr), desc: t.desc, links: { x: (t.socials || {}).x || '', tg: (t.socials || {}).tg || '', web: (t.socials || {}).web || '' }, creator: t.creator, feeRecipient: t.feeRecipient, creatorSol: '', createdAt: t.createdAt, age: APP.ago(t.createdAt), chains: ['hyper'], byChain: { hyper: m }, net: t.net, chainName: C.chainOf(t.net).name,
      px: m.px, pxUsd: m.pxUsd, mcap: m.mcap, mcapUsd: m.mcap * APP.hypeUsd, liqHype: m.liqHype, vol24: m.vol24, volAll: m.volAll, feesAll: m.feesAll, trades: m.trades, buys24: m.buys24, sells24: m.sells24, holders: t.holders.filter(([w]) => !isPool(t, w)).length, c5: m.c5, c1: m.c1, c24: m.c24,
      creatorTaxBps: t.taxBps, buyback: t.buyback, feeBps: T.hookFeeBps ?? E.feeBps, creatorShareBps: 10000 - (T.protocolShareBps ?? E.protocolShareBps), lastTs: m.lastTs, fee: m.fee, tx: t.tx, poolId: t.poolId,
      v: t.v || 1, pair: t.pair || ZERO, pairSym: pairMeta(t).sym, pairLogo: pairMeta(t).logo, levMax: levMaxOf(t, m) };
    v._usd = APP.hypeUsd; VIEW.set(t.addr, v); return v;
  }
  function holders(a) {
    const t = BY.get(low(a)); if (!t) return [];
    return t.holders.map(([w, bal]) => ({ wallet: w === low(KK(t.net).poolManager) ? 'Pool (Uniswap v4)' : (V2of(t.net) || {}).margin && w === low(V2of(t.net).margin) ? 'Leverage positions' : w, chain: 'hyper', bal, share: (bal / SUPPLY) * 100, creator: w === t.creator, pool: isPool(t, w) })).sort((x, y) => y.bal - x.bal);
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
  const routeTx = (t, buy, amountIn, minOut) => window.ROUTES.encode({ coin: t.addr, pair: t.pair, hook: V2of(t.net).hook, pairInfo: pairInfo(t), buy, amountIn, minOut, deadline: deadline(), hopLayout: !!V2of(t.net).hopLayout });
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
  // after a trade, read fresh state until the indexer has the trade's block, so the next quote starts from the new price
  async function afterTrade(a, blk) {
    const t = BY.get(low(a)), net = t && t.net;
    const fresh = (async () => { for (let i = 0; i < 10; i++) { await load(true, net); if (!blk || stOf(net).block >= blk) return; await new Promise((s) => setTimeout(s, 1500)); } })();
    await Promise.all([fresh, refreshMine(), APP.W.connected ? exactBalance(a, APP.W.address).catch(() => {}) : null]); APP.emit();
  }

  const DATA = window.DATA = {
    mode: 'live',
    async ready() {
      if (DEMO && !document.getElementById('demo-bar')) { const b = document.createElement('div'); b.id = 'demo-bar'; b.textContent = 'Preview with sample coins. The contracts go live on Robinhood Chain soon.'; (document.querySelector('main') || document.body).prepend(b); }
      await load(); if (!ALL.length && !Object.keys(SS).length) setTimeout(() => load(), 3000);
      if (!listeners++) { setInterval(() => { if (!document.hidden) load(); }, 6000); setInterval(() => { if (!document.hidden) refreshMine(); }, 20000); APP.onWallet(() => { myBal.clear(); refreshMine(); }); refreshMine(); }
      return true;
    },
    // a coin the cached state does not have yet (just launched, CDN copy a few seconds old): read fresh state until it shows
    async find(addr, ms = 45000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { await load(true); if (BY.has(low(addr))) return DATA.token(addr); await new Promise((r) => setTimeout(r, 2500)); } return null; },
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
      const mine = ALL.filter((t) => t.name && (t.feeRecipient === w || t.creator === w)).map((t) => {
        const v = view(t);
        if (t.v === 2) { const k = ethPer(t), pend = ((t.pend || {}).creator || 0) * k, paid = ((t.paid || {}).creator || 0) * k; return { ...v, creatorFees: pend + paid, pending: pend, unswept: 0, payout: t.feeRecipient === w ? pend : 0, byChainFees: { hyper: pend + paid }, bbVested: 0 }; }
        const acc = creatorAccrued(t); const paid = t.swept.creator + t.swept.buyback, unswept = Math.max(0, acc - paid); return { ...v, creatorFees: Math.max(acc, paid), pending: unswept, unswept, byChainFees: { hyper: acc }, bbVested: t.vest.released };
      });
      const payout = mine.reduce((s, x) => s + (x.payout || 0), 0);
      return { tokens: mine, lifetime: mine.reduce((s, x) => s + x.creatorFees, 0), pending: claimable + payout, claimable: claimable + payout, claimableByChain: byNet, payout, unswept: mine.reduce((s, x) => s + x.unswept, 0) };
    },
    stats() { const ts = DATA.tokens(); return { launches: ts.length, launches24: ts.filter((t) => t.createdAt > now() - 86400).length, vol24: ts.reduce((s, x) => s + x.vol24, 0), feesAll: ts.reduce((s, x) => s + x.feesAll, 0), creatorsPaid: Object.values(SS).reduce((s, st) => s + Object.values(st.escrow).reduce((u, x) => u + x.credited, 0), 0) }; },

    async buy(a, chain, hype, minOut) {
      const t = BY.get(low(a)); if (!t) throw new Error('Unknown token'); await onChainOf(t);
      const amountIn = wei(hype), min = wei(Math.max(0, minOut)), hb = hypeBal[t.net];
      if (hb && hype > hb) throw new Error('Not enough ' + C.chain.quote + ' on ' + C.chain.name);
      if (isErc(t) && !pairInfo(t)) throw new Error('The ' + pairMeta(t).sym + ' price is still loading, try again in a moment');
      const r = await send({ to: KK(t.net).router, data: t.v === 2 ? routeTx(t, true, amountIn, min) : v4Swap(t, true, amountIn, min), value: amountIn, gasLimit: 900000n }, 'buy');
      const q = quoteBuy(a, chain, hype); await afterTrade(a, parseInt(r.receipt.blockNumber, 16)); return { tx: r.hash, buy: true, hype, tokens: q.tokens };
    },
    async sell(a, chain, tokens, minOut) {
      const t = BY.get(low(a)); if (!t) throw new Error('Unknown token'); await onChainOf(t); await APP.W.require(); const me = APP.W.address, UR = KK(t.net).router;
      const have = await exactBalance(a, me); let amount = wei(tokens); if (amount > have || Number(X.formatEther(have)) - tokens < 1e-6) amount = have; if (amount <= 0n) throw new Error('Not enough tokens');
      const [[allow], p2] = await Promise.all([call(a, I.erc20, 'allowance', [me, PERMIT2], t.net), call(PERMIT2, I.permit2, 'allowance', [me, a, UR], t.net)]);
      if (allow < amount) { APP.toast('Approve the token for trading (once)', 'info', 6000); await send({ to: a, data: I.erc20.encodeFunctionData('approve', [PERMIT2, X.MaxUint256]), gasLimit: 120000n }, 'approve'); }
      if (p2.amount < amount || Number(p2.expiration) < now() + 120) { APP.toast('Allow the swap router through Permit2 (once a month)', 'info', 6000); await send({ to: PERMIT2, data: I.permit2.encodeFunctionData('approve', [a, UR, (1n << 160n) - 1n, BigInt(now() + 30 * 86400)]), gasLimit: 120000n }, 'approve'); }
      const r = await send({ to: UR, data: t.v === 2 ? routeTx(t, false, amount, wei(Math.max(0, minOut))) : v4Swap(t, false, amount, wei(Math.max(0, minOut))), gasLimit: 900000n }, 'sell');
      const q = quoteSell(a, chain, tokens); await afterTrade(a, parseInt(r.receipt.blockNumber, 16)); return { tx: r.hash, buy: false, tokens, hype: q.hype };
    },
    // coin -> coin in one transaction: coinIn's pool to the quote coin, then coinOut's pool (both under our hook)
    async swapCoins(a, b, chain, tokens, minOut) {
      const t = BY.get(low(a)), u = BY.get(low(b)); if (!t || !u) throw new Error('Unknown token'); if (t.net !== u.net) throw new Error('Both coins must live on the same chain');
      await onChainOf(t); await APP.W.require(); const me = APP.W.address, UR = KK(t.net).router;
      const have = await exactBalance(a, me); let amount = wei(tokens); if (amount > have || Number(X.formatEther(have)) - tokens < 1e-6) amount = have; if (amount <= 0n) throw new Error('Not enough tokens');
      const [[allow], p2] = await Promise.all([call(a, I.erc20, 'allowance', [me, PERMIT2], t.net), call(PERMIT2, I.permit2, 'allowance', [me, a, UR], t.net)]);
      if (allow < amount) { APP.toast('Approve the token for trading (once)', 'info', 6000); await send({ to: a, data: I.erc20.encodeFunctionData('approve', [PERMIT2, X.MaxUint256]), gasLimit: 120000n }, 'approve'); }
      if (p2.amount < amount || Number(p2.expiration) < now() + 120) { APP.toast('Allow the swap router through Permit2 (once a month)', 'info', 6000); await send({ to: PERMIT2, data: I.permit2.encodeFunctionData('approve', [a, UR, (1n << 160n) - 1n, BigInt(now() + 30 * 86400)]), gasLimit: 120000n }, 'approve'); }
      const hook = (t.v === 2 ? V2of(t.net).hook : KK(t.net).hook);
      const data = window.ROUTES.encodeCoinToCoin({ coinIn: a, coinOut: b, hook, amountIn: amount, minOut: wei(Math.max(0, minOut)), deadline: deadline(), hopLayout: !!(V2of(t.net) && V2of(t.net).hopLayout) });
      const r = await send({ to: UR, data, gasLimit: 1200000n }, 'swap');
      await afterTrade(a, parseInt(r.receipt.blockNumber, 16)); await afterTrade(b, parseInt(r.receipt.blockNumber, 16)); return { tx: r.hash };
    },
    async launch(p) {
      if (V2of(C.chain.key)) return launchV2(p);
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
    async claim() { // every chain with something claimable, one transaction each, on that chain; then v2 payouts
      await APP.W.require(); const cr = DATA.creator(APP.W.address), by = cr.claimableByChain; let got = 0;
      for (const [net, amt] of Object.entries(by)) { if (!(amt > 0)) continue; if (C.chain.key !== net) await APP.setChain(net, false); await send({ to: KK(net).escrow, data: I.escrow.encodeFunctionData('claim()', []), gasLimit: 150000n }, 'claim'); got += amt; }
      for (const x of cr.tokens) { if (!(x.payout > 0)) continue; const t = BY.get(x.addr); await onChainOf(t); await send({ to: V2of(t.net).hook, data: I.hook2.encodeFunctionData('payout', [t.poolId]), gasLimit: 200000n }, 'payout'); got += x.payout; }
      if (!got) throw new Error('Nothing to claim yet'); await Promise.all([load(true), refreshMine()]); return got; },
  };

  // BuzzPad v2 launch: the pair (p.pair: a key of chain.v2.pairs, default the native coin) picks the launch config; an
  // opening buy is paid in ETH and only offered with the ETH pair
  async function launchV2(p) {
    await APP.W.require(); const me = APP.W.address, net = C.chain.key, V = V2of(net);
    const pr = (V.pairs || []).find((x) => x.key === (p.pair || 'eth')) || V.pairs[0];
    if (!p.image) throw new Error('Add an image for the token');
    const logo = await uploadLogo(p.image);
    const [econ, fee, enabled, can] = await multicall([[V.factory, I.factory2, 'previewLaunchEconomics', [pr.cfg]], [V.factory, I.factory2, 'launchFee'], [V.factory, I.factory2, 'launchEnabled'], [V.factory, I.factory2, 'canLaunch', [me]]], net);
    if (!enabled && !can) throw new Error('Launches are paused right now');
    const opening = pr.addr === ZERO ? wei(p.devBuy || 0) : 0n, salt = X.hexlify(X.randomBytes(32));
    const params = { name: p.name, symbol: p.symbol, logo, description: p.description || '', socials: { twitter: p.x || '', telegram: p.telegram || '', discord: '', website: p.website || '', farcaster: '' }, creatorFeeRecipient: p.feeWallet && X.isAddress(p.feeWallet) ? X.getAddress(p.feeWallet) : X.ZeroAddress, creatorTaxBps: p.creatorTaxBps || 0, expectedEconomics: econ || X.ZeroHash, salt, openingBuy: opening, minTokensOut: opening > 0n ? 1n : 0n };
    const r = await send({ to: V.factory, data: I.factory2.encodeFunctionData('launch', [params, pr.cfg]), value: (fee ?? X.parseEther(String(E.launchFeeHype))) + opening, gasLimit: 2500000n }, 'launch');
    const lg = r.receipt.logs.map((l) => { try { return I.factory2.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
    const addr = lg ? low(lg.args.token) : '';
    for (let i = 0; i < 20 && addr && !BY.has(addr); i++) { await load(true, net); if (!BY.has(addr)) await new Promise((s) => setTimeout(s, 3000)); }
    refreshMine(); return { addr, tx: r.hash };
  }
  DATA.pairs = () => (V2of(C.chain.key) || {}).pairs || [];

  // ---- leverage (chains whose v2 block names a margin contract): longs on ETH-pair coins, funded by the coin's pool.
  // Read straight from the margin contract; every number is in ETH.
  const LEV = { info: new Map(), mine: { w: '', at: 0, list: [] } };
  const Mof = (net) => (V2of(net) || {}).margin || '';
  const f18 = (v) => Number(X.formatEther(v || 0n)), fmt2 = (x) => (Math.round(x * 100) / 100).toString();
  // preview: terms a coin of this size would get, and one example position on the first ETH-pair coin
  const DEMO_LEV = {
    info(t) { return { at: Date.now(), ok: true, why: '', maxLev: 3, borrowFee: 0.3, minMargin: 0.001, maint: 0.1, depth: 14.6, max: { 1.5: 0.29, 2: 0.22, 3: 0.146 } }; },
    positions() {
      // one example 3x long per ETH-pair coin, opened 15% below today's price, so the card shows a gain
      return ALL.filter((x) => x.name).map((t, i) => {
        const v = view(t), entry = v.px / 1.15, tokens = (0.393 / Math.max(entry, 1e-18)) * 0.98, value = tokens * v.px * 0.99, debt = 0.262;
        return { id: i + 1, token: t.addr, sym: t.symbol, tokens, debt, value, margin: 0.131, equity: value - debt, pnl: value - debt - 0.131, pnlPct: ((value - debt) / 0.131 - 1) * 100, lev: 3, liq: false, flagged: false, liqPx: debt / (tokens * 0.9 * 0.99), entryPx: entry, opened: v.createdAt, health: Math.max(0, 1 - debt / value), demo: true };
      });
    },
  };
  DATA.demo = DEMO;
  DATA.lev = {
    on: (net) => DEMO || !!Mof(net || C.chain.key),
    // the coin's terms now: whether it can be levered, the largest margin at 2x and 3x, the APR
    async info(a) {
      const t = BY.get(low(a)); if (t && DEMO) return DEMO_LEV.info(t); if (!t || !Mof(t.net)) return null; const M = Mof(t.net);
      const c = LEV.info.get(t.addr); if (c && Date.now() - c.at < 8000) return c;
      const r = await multicall([[M, I.margin, 'opensEnabled'], [M, I.margin, 'maxLeverageBps'], [M, I.margin, 'borrowFeeBps'], [M, I.margin, 'minMargin'], [M, I.margin, 'minCoinAge'], [M, I.margin, 'minDepthOf', [t.pair || ZERO]], [M, I.margin, 'maintenanceBps'], [M, I.margin, 'poolDepth', [t.addr]], [M, I.margin, 'maxMargin', [t.addr, 20000]], [M, I.margin, 'maxMargin', [t.addr, 30000]], [M, I.margin, 'maxMargin', [t.addr, 15000]]], t.net);
      const [on, maxLev, bfee, minM, age, minDepth, maint, depth, m2, m3, m15] = r;
      // pool depth and the largest margins come in the coin's pair; shown in ETH (a stock's swap fees taken off)
      const inEth = (x) => (isErc(t) ? pairToEth(t, f18(x)) : f18(x));
      const why = isErc(t) && !pairInfo(t) ? 'The ' + pairMeta(t).sym + ' price is still loading.' : !on ? 'Leverage is paused right now.' : now(t.net) < t.createdAt + Number(age || 600) ? 'Leverage opens 10 minutes after launch.' : depth != null && minDepth != null && depth < minDepth ? `Leverage opens once the pool holds about ${fmt2(inEth(minDepth))} ${C.chain.quote}${isErc(t) ? ' of ' + pairMeta(t).sym : ''}.` : '';
      const v = { at: Date.now(), ok: !why, why, maxLev: Number(maxLev || 30000) / 1e4, borrowFee: Number(bfee || 0) / 100, minMargin: f18(minM), maint: Number(maint || 1000) / 1e4, depth: inEth(depth), max: { 1.5: inEth(m15), 2: inEth(m2), 3: inEth(m3) } };
      LEV.info.set(t.addr, v); return v;
    },
    // the wallet's open positions, with health and P&L at the spot price
    async positions(w, fresh) {
      if (DEMO) return DEMO_LEV.positions();
      const net = C.chain.key, M = Mof(net); w = low(w); if (!M || !w) return [];
      if (!fresh && LEV.mine.w === w && Date.now() - LEV.mine.at < 6000) return LEV.mine.list;
      const [ids] = [await multicall([[M, I.margin, 'positionsOf', [w]]], net)].map((x) => x[0] || []);
      const r = ids.length ? await multicall(ids.flatMap((id) => [[M, I.margin, 'positions', [id]], [M, I.margin, 'health', [id]], [M, I.margin, 'liquidationPrice', [id]]]), net) : [];
      const list = [];
      ids.forEach((id, i) => { const p = r[i * 3], h = r[i * 3 + 1], lp = r[i * 3 + 2]; if (!p || !h || low(p.owner) !== w) return;
        const t = BY.get(low(p.token)), k = t && isErc(t) ? ethPer(t) : 1; // the pair's ETH price: amounts shown in ETH
        const debt = f18(h[0]) * k, value = f18(h[1]) * k, margin = f18(p.margin) * k, tok = f18(p.tokens);
        list.push({ id: Number(id), token: low(p.token), sym: t ? t.symbol : '', tokens: tok, debt, value, margin, equity: value - debt, pnl: value - debt - margin, pnlPct: margin ? ((value - debt) / margin - 1) * 100 : 0, lev: Number(p.leverageBps) / 1e4, liq: !!h[2], flagged: Number(p.flaggedAt) > 0, liqPx: f18(lp) * k, entryPx: tok ? (margin + f18(p.principal) * k) / tok : 0, pair: low(p.pair), opened: Number(p.openedAt), health: value > 0 ? Math.max(0, Math.min(1, 1 - debt / value)) : 0 }); });
      LEV.mine = { w, at: Date.now(), list }; return list;
    },
    async open(a, lev, marginEth, minTokens) {
      const t = BY.get(low(a)); if (!t) throw new Error('Unknown token'); await onChainOf(t);
      if (isErc(t) && !pairInfo(t)) throw new Error('The ' + pairMeta(t).sym + ' price is still loading, try again in a moment');
      const minPair = isErc(t) ? wei(ethToPair(t, marginEth) * 0.95) : 0n; // a stock coin's margin is swapped to the stock first
      const r = await send({ to: Mof(t.net), data: I.margin.encodeFunctionData('open', [t.addr, BigInt(Math.round(lev * 1e4)), wei(Math.max(0, minTokens || 0)), minPair]), value: wei(marginEth), gasLimit: 3000000n }, 'open');
      LEV.info.delete(t.addr); LEV.mine.at = 0; await afterTrade(a, parseInt(r.receipt.blockNumber, 16)); return r.hash;
    },
    async close(id, minOut) { const r = await send({ to: Mof(C.chain.key), data: I.margin.encodeFunctionData('close', [BigInt(id), wei(Math.max(0, minOut || 0))]), gasLimit: 3000000n }, 'close'); LEV.mine.at = 0; LEV.info.clear(); await Promise.all([load(true), refreshMine()]); return r.hash; },
    async addMargin(id, eth) { const p = LEV.mine.list.find((x) => x.id === id), t = p && BY.get(p.token); const minPair = t && isErc(t) && pairInfo(t) ? wei(ethToPair(t, eth) * 0.95) : 0n; const r = await send({ to: Mof(C.chain.key), data: I.margin.encodeFunctionData('addMargin', [BigInt(id), minPair]), value: wei(eth), gasLimit: 1500000n }, 'add margin'); LEV.mine.at = 0; return r.hash; },
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
