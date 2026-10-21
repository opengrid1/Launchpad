/* Equo contract features on top of the bundled chain layer (chain.js): cashback and referral rewards,
   creator tools (metadata, transfer, activity, fee claims), community takeover, and the admin's start cap
   presets and reward split. Exposes window.CHAIN.equo. Loaded right after chain.js on every page. */
(function () {
  const C = window.CHAIN;
  if (!C || !C._lib) return;
  const { ethers: E, signer, provider, addr, tx } = C._lib;
  const cfg = window.INKY || {};
  const DAY = 86400;
  const SUPPLY = 10n ** 27n;

  const HOOK_ABI = [
    "function cashbackBps() view returns (uint16)",
    "function referralBps() view returns (uint16)",
    "function referrerOf(address trader) view returns (address)",
    "function rewardsOwed(address user, address pair) view returns (uint256)",
    "function creatorOf(address token) view returns (address)",
    "function creatorOwed(address token) view returns (uint256)",
    "function claimRewards(address[] pairs) returns (uint256)",
    "function payCreator(address token) returns (uint256)",
    "event RewardsCredited(address indexed token, address indexed trader, uint256 cashback, address indexed referrer, uint256 referral)",
    "event ReferrerBound(address indexed trader, address indexed referrer)",
    "event RewardsClaimed(address indexed user, address indexed pair, uint256 amount)",
  ];
  const FACTORY_ABI = [
    "function capPresets() view returns (uint64[])",
    "function capOf(address token) view returns (uint64)",
    "function creatorMetadata(address token) view returns (string)",
    "function pendingCreator(address token) view returns (address)",
    "function creatorActiveAt(address token) view returns (uint64)",
    "function takeovers(address token) view returns (address proposer, uint64 startedAt, address newCreator, uint96 stake)",
    "function TAKEOVER_IDLE() view returns (uint256)",
    "function TAKEOVER_DELAY() view returns (uint256)",
    "function TAKEOVER_STAKE() view returns (uint256)",
    "function setCreatorMetadata(address token, string uri)",
    "function transferCreator(address token, address to)",
    "function acceptCreator(address token)",
    "function poke(address token)",
    "function claimCreatorFees(address token) returns (uint256)",
    "function proposeTakeover(address token, address newCreator, uint256 stake)",
    "function cancelTakeover(address token)",
    "function executeTakeover(address token)",
    "function setCapPresets(uint64[] usd8)",
    "function setRewardSplit(uint16 cashbackBps, uint16 referralBps)",
    "function oracle() view returns (address)",
  ];
  const ERC20_ABI = ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
  const ROUTER_ABI = [
    "function buyWithPair(address coin, uint256 pairIn, uint256 minCoinOut, address referrer) returns (uint256)",
    "function sellForPair(address coin, uint256 amountIn, uint256 minPairOut, address referrer) returns (uint256)",
  ];
  // Uniswap's quoters (mainnet), used to price ETH <-> stock along a pair's route
  const Q3 = new E.Contract("0x61fFE014bA17989E743c5F6cB21bF9697530B21e", ["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160,uint32,uint256)"], provider);
  const Q4 = new E.Contract("0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203", ["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"], provider);
  const MC = new E.Contract("0xcA11bde05977b3631167028862bE2a173976CA11", ["function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])"], provider);

  const hookR = new E.Contract(addr.hook, HOOK_ABI, provider);
  const factR = new E.Contract(addr.factory, FACTORY_ABI, provider);
  const W = async (a, abi) => new E.Contract(a, abi, await signer());
  const lc = (a) => String(a || "").toLowerCase();
  const ZERO = "0x0000000000000000000000000000000000000000";
  const WETH = lc(cfg.weth || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  const pairs = () => [WETH, ...(cfg.stocks || []).map((s) => s.address)].map(lc);
  const stockOf = (p) => (cfg.stocks || []).find((x) => lc(x.address) === lc(p)) || null;
  const pairSym = (p) => { p = lc(p); if (p === WETH) return "ETH"; const s = stockOf(p); return s ? s.symbol : "?"; };

  /** one eth_call per chunk: `calls` are [target, iface, fn, args]; failed calls come back null */
  async function multi(calls, size = 150) {
    const out = [];
    for (let i = 0; i < calls.length; i += size) {
      const part = calls.slice(i, i + size);
      const res = await MC.aggregate3(part.map(([t, f, fn, a]) => ({ target: t, allowFailure: true, callData: f.encodeFunctionData(fn, a) })));
      res.forEach((r, j) => { const [, f, fn] = part[j]; try { out.push(r.success ? f.decodeFunctionResult(fn, r.returnData) : null); } catch { out.push(null); } });
    }
    return out;
  }

  // route quoting: walk the pair's hops with the v3 / v4 quoters
  const v3Meta = {};
  async function v3Pool(pool) {
    if (!v3Meta[pool]) {
      const c = new E.Contract(pool, ["function token0() view returns (address)", "function token1() view returns (address)", "function fee() view returns (uint24)"], provider);
      v3Meta[pool] = Promise.all([c.token0(), c.token1(), c.fee()]).then(([a, b, f]) => ({ t0: lc(a), t1: lc(b), fee: Number(f) })).catch((e) => { delete v3Meta[pool]; throw e; });
    }
    return v3Meta[pool];
  }
  async function hopOut(h, tokenIn, amountIn) {
    if (h.dex === 3) {
      const k = h.key, c0 = lc(k.currency0), c1 = lc(k.currency1), s0 = c0 === ZERO ? WETH : c0;
      const zeroForOne = tokenIn === s0;
      if (!zeroForOne && tokenIn !== c1) throw new Error("bad route");
      const [out] = await Q4.quoteExactInputSingle.staticCall({ poolKey: { currency0: k.currency0, currency1: k.currency1, fee: k.fee, tickSpacing: k.tickSpacing, hooks: k.hooks || ZERO }, zeroForOne, exactAmount: amountIn, hookData: "0x" });
      return [zeroForOne ? c1 : s0, out];
    }
    if (h.dex === 2) {
      const m = await v3Pool(h.pool), tokenOut = tokenIn === m.t0 ? m.t1 : m.t0;
      const [out] = await Q3.quoteExactInputSingle.staticCall({ tokenIn, tokenOut, amountIn, fee: m.fee, sqrtPriceLimitX96: 0 });
      return [tokenOut, out];
    }
    throw new Error("unsupported hop");
  }
  /** ETH -> pair (buy) or pair -> ETH (sell) along the pair's route, in base units */
  async function routeOut(pair, amountIn, buy) {
    pair = lc(pair);
    if (pair === WETH || !amountIn) return BigInt(amountIn || 0);
    const s = stockOf(pair);
    if (!s || !s.route) throw new Error("No ETH route for " + pairSym(pair));
    const hops = buy ? s.route : s.route.slice().reverse();
    let held = buy ? WETH : pair, amt = BigInt(amountIn);
    for (const h of hops) [held, amt] = await hopOut(h, held, amt);
    if (held !== (buy ? pair : WETH)) throw new Error("bad route");
    return amt;
  }

  // logs from the deploy block, through the log-capable RPCs, in chunks
  const logRpcs = (cfg.logsRpcs || []).concat(cfg.rpcs || []).filter(Boolean);
  async function getLogs(filter) {
    let last;
    for (const url of logRpcs) {
      try {
        const p = new E.JsonRpcProvider(url, 1, { staticNetwork: true });
        const latest = await p.getBlockNumber();
        const out = [];
        for (let from = Number(cfg.deployBlock || 0); from <= latest; from += 50_000) {
          out.push(...(await p.getLogs({ ...filter, fromBlock: from, toBlock: Math.min(latest, from + 49_999) })));
        }
        return out;
      } catch (e) { last = e; }
    }
    throw last || new Error("no log RPC");
  }

  let splitP = null, nowAt = 0, nowV = 0;
  const EQ = {
    /** chain time (latest block), so idle and delay checks match what the contracts see */
    async chainNow() {
      if (Date.now() - nowAt < 15_000) return nowV + Math.floor((Date.now() - nowAt) / 1000);
      try { const b = await provider.getBlock("latest"); nowV = Number(b.timestamp); nowAt = Date.now(); return nowV; } catch { return Math.floor(Date.now() / 1000); }
    },
    DAY, SUPPLY,
    IDLE: 30 * DAY, DELAY: 7 * DAY, STAKE: SUPPLY / 20n,
    pairSym,
    /** cashback and referral shares, bps of the platform part, plus the fee share they are of */
    split() {
      if (!splitP) splitP = Promise.all([hookR.cashbackBps(), hookR.referralBps()]).then(([c, r]) => ({ cashbackBps: Number(c), referralBps: Number(r) })).catch((e) => { splitP = null; throw e; });
      return splitP;
    },
    /** claimable rewards per pair asset (cashback and referral share one balance per pair) */
    async rewards(user) {
      const ps = pairs();
      const v = (await multi(ps.map((p) => [addr.hook, hookR.interface, "rewardsOwed", [user, p]]))).map((r) => (r ? r[0] : 0n));
      return ps.map((p, i) => ({ pair: p, symbol: pairSym(p), amount: Number(v[i]) / 1e18, raw: v[i] })).filter((r) => r.raw > 0n);
    },
    async claimRewards(pairList) { const h = await W(addr.hook, HOOK_ABI); return tx(() => h.claimRewards(pairList)); },
    referrerOf: (user) => hookR.referrerOf(user).then(lc),
    /** lifetime cashback earned, referral earned and referred traders, from the hook's events */
    async history(user) {
      const iface = new E.Interface(HOOK_ABI);
      const credited = iface.getEvent("RewardsCredited").topicHash, bound = iface.getEvent("ReferrerBound").topicHash;
      const u = E.zeroPadValue(user, 32);
      const [asTrader, asRef, refs] = await Promise.all([
        getLogs({ address: addr.hook, topics: [credited, null, u] }),
        getLogs({ address: addr.hook, topics: [credited, null, null, u] }),
        getLogs({ address: addr.hook, topics: [bound, null, u] }),
      ]);
      const sum = (logs, field) => { const by = {}; logs.forEach((l) => { const ev = iface.parseLog(l); const tok = lc(ev.args.token); const x = (C.token && C.token(tok)) || null; const p = x ? lc(x.pairAddr || "") : ""; const amt = Number(ev.args[field]) / 1e18; by[p] = (by[p] || 0) + amt; by._usd = (by._usd || 0) + amt * ((x && x.pairUsd) || 0); }); return by; };
      return { cashback: sum(asTrader, "cashback"), referral: sum(asRef, "referral"), traders: new Set(refs.map((l) => lc(iface.parseLog(l).args.trader))).size };
    },

    /** platform-wide cashback and referral totals from the hook's events, in USD at today's pair prices */
    async rewardStats(prices) {
      const iface = new E.Interface(HOOK_ABI);
      const tc = iface.getEvent("RewardsCredited").topicHash, tb = iface.getEvent("ReferrerBound").topicHash, tl = iface.getEvent("RewardsClaimed").topicHash;
      const logs = await getLogs({ address: addr.hook, topics: [[tc, tb, tl]] });
      const px = (p) => (prices && prices[lc(p)]) || 0;
      const pairOfToken = (t) => { const x = (C.token && C.token(lc(t))) || null; return x ? lc(x.pairAddr || WETH) : WETH; };
      const s = { cashback: 0, referral: 0, claimed: 0, earners: new Set(), referrers: {}, referred: 0, events: 0 };
      for (const l of logs) {
        const ev = iface.parseLog(l); if (!ev) continue; s.events++;
        if (ev.name === "RewardsCredited") {
          const p = px(pairOfToken(ev.args.token)), cb = (Number(ev.args.cashback) / 1e18) * p, rf = (Number(ev.args.referral) / 1e18) * p;
          s.cashback += cb; s.referral += rf;
          if (cb > 0) s.earners.add(lc(ev.args.trader));
          if (lc(ev.args.referrer) !== ZERO) { const r = s.referrers[lc(ev.args.referrer)] || (s.referrers[lc(ev.args.referrer)] = { earned: 0, traders: new Set(), volTrades: 0 }); r.earned += rf; r.traders.add(lc(ev.args.trader)); r.volTrades++; }
        } else if (ev.name === "ReferrerBound") {
          s.referred++; const r = s.referrers[lc(ev.args.referrer)] || (s.referrers[lc(ev.args.referrer)] = { earned: 0, traders: new Set(), volTrades: 0 }); r.traders.add(lc(ev.args.trader));
        } else s.claimed += (Number(ev.args.amount) / 1e18) * px(ev.args.pair);
      }
      const top = Object.entries(s.referrers).map(([w, r]) => ({ w, earned: r.earned, traders: r.traders.size, trades: r.volTrades })).sort((a, b) => b.earned - a.earned || b.traders - a.traders);
      return { cashback: s.cashback, referral: s.referral, claimed: s.claimed, unclaimed: Math.max(0, s.cashback + s.referral - s.claimed), earners: s.earners.size, referrers: top.length, referred: s.referred, top, events: s.events };
    },

    // creator
    creatorOf: (token) => hookR.creatorOf(token).then(lc),
    async creatorInfo(token) {
      const [creator, pending, activeAt, t, owed] = await Promise.all([hookR.creatorOf(token), factR.pendingCreator(token), factR.creatorActiveAt(token), factR.takeovers(token), hookR.creatorOwed(token)]);
      const takeover = lc(t.proposer) === ZERO ? null : { proposer: lc(t.proposer), newCreator: lc(t.newCreator), startedAt: Number(t.startedAt), stake: t.stake };
      return { creator: lc(creator), pending: lc(pending) === ZERO ? null : lc(pending), activeAt: Number(activeAt), takeover, owed: Number(owed) / 1e18 };
    },
    async setMetadata(token, uri) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.setCreatorMetadata(token, uri)); },
    async transferCreator(token, to) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.transferCreator(token, to || ZERO)); },
    async acceptCreator(token) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.acceptCreator(token)); },
    async poke(token) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.poke(token)); },
    async claimCreatorFees(token) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.claimCreatorFees(token)); },

    // takeover
    async proposeTakeover(token, newCreator, stake) {
      const s = await signer(); const me = await s.getAddress();
      const coin = new E.Contract(token, ERC20_ABI, s);
      if ((await coin.allowance(me, addr.factory)) < stake) await (await coin.approve(addr.factory, stake)).wait();
      const f = new E.Contract(addr.factory, FACTORY_ABI, s);
      return tx(() => f.proposeTakeover(token, newCreator, stake));
    },
    async cancelTakeover(token) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.cancelTakeover(token)); },
    async executeTakeover(token) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.executeTakeover(token)); },
    balanceOf: (token, who) => new E.Contract(token, ERC20_ABI, provider).balanceOf(who),

    // presets and admin levers
    capPresets: () => factR.capPresets().then((v) => v.map((x) => Number(x) / 1e8)),
    capOf: (token) => factR.capOf(token).then((x) => Number(x) / 1e8),
    async setCapPresets(usd) { const f = await W(addr.factory, FACTORY_ABI); return tx(() => f.setCapPresets(usd.map((u) => BigInt(Math.round(u)) * 10n ** 8n))); },
    async setRewardSplit(cb, rf) { const f = await W(addr.factory, FACTORY_ABI); splitP = null; return tx(() => f.setRewardSplit(cb, rf)); },
  };
  Object.assign(EQ, {
    multi, routeOut,
    /** true when ETH can be swapped into `pair` (WETH, or a stock with a route) */
    hasRoute: (pair) => lc(pair) === WETH || !!(stockOf(pair) && stockOf(pair).route),
    /** whether a launch on `pair` would get a price from the oracle right now; `why` says what blocks it */
    async launchable(pair) {
      const O = new E.Contract(await factR.oracle(), ["function launchPrice(address) returns (uint256)", "error NoPrice()", "error TooShallow()", "error PriceMoving()"], provider);
      try { await O.launchPrice.staticCall(pair); return { ok: true, why: "" }; }
      catch (e) {
        const n = (e.revert && e.revert.name) || "", t = pairSym(pair).replace(/on$/, "");
        const why = n === "TooShallow" ? `${t}'s price pool is too shallow right now, so the oracle won't price a launch. Pick another stock or try later.`
          : n === "PriceMoving" ? `${t}'s price is moving fast right now. Try again in a few minutes.`
          : n === "NoPrice" ? `The oracle has no price for ${t}.` : "";
        return { ok: !why, why };
      }
    },
    /** USD prices (per whole token) for many pairs in a few calls, from the factory's oracle */
    async pairPrices(list) {
      const f = new E.Interface(["function pairUsdPrice(address pair) view returns (uint256)"]);
      const r = await multi(list.map((p) => [addr.factory, f, "pairUsdPrice", [p]]));
      const out = {}; list.forEach((p, i) => { if (r[i]) out[lc(p)] = Number(r[i][0]) / 1e18; }); return out;
    },
    // trades paid in the pair itself, for stocks without an ETH route
    async buyWithPair(coin, pair, pairIn, minOut) {
      const s = await signer(), me = await s.getAddress(), p = new E.Contract(pair, ERC20_ABI, s);
      if ((await p.allowance(me, addr.router)) < pairIn) await (await p.approve(addr.router, E.MaxUint256)).wait();
      const r = new E.Contract(addr.router, ROUTER_ABI, s);
      return tx(() => r.buyWithPair(coin, pairIn, minOut, window.EQUO_REF && E.isAddress(window.EQUO_REF) ? window.EQUO_REF : ZERO));
    },
    async sellForPair(coin, amountIn, minOut) {
      const s = await signer(), me = await s.getAddress(), c = new E.Contract(coin, ERC20_ABI, s);
      if ((await c.allowance(me, addr.router)) < amountIn) await (await c.approve(addr.router, E.MaxUint256)).wait();
      const r = new E.Contract(addr.router, ROUTER_ABI, s);
      return tx(() => r.sellForPair(coin, amountIn, minOut, window.EQUO_REF && E.isAddress(window.EQUO_REF) ? window.EQUO_REF : ZERO));
    },
  });
  C.equo = EQ;

  // creator fee claims go through the factory when the caller is the creator, so they count as activity
  const payDirect = C.payCreator;
  C.payCreator = async (token) => {
    const me = lc(await (await signer()).getAddress());
    if (me === (await EQ.creatorOf(token))) return EQ.claimCreatorFees(token);
    return payDirect(token);
  };
  // the start cap is a list of presets now
  C.startCapUsd = () => EQ.capPresets().then((v) => v[0] || 0).catch(() => 0);
  C.setStartCap = async (usd8) => EQ.setCapPresets([Number(usd8) / 1e8]);

  // keep each coin's creator current (the role can move after launch)
  const seen = {};
  async function syncCreators() {
    const list = (C.tokens && C.tokens()) || [];
    const due = list.filter((x) => !seen[x.addr] || Date.now() - seen[x.addr] > 60_000);
    if (!due.length) return;
    const got = await Promise.all(due.map((x) => EQ.creatorOf(x.addr).catch(() => null)));
    due.forEach((x, i) => { seen[x.addr] = Date.now(); if (got[i] && got[i] !== x.creator) { x.originalCreator = x.originalCreator || x.creator; x.creator = got[i]; } });
  }
  if (C.ready) C.ready.then(syncCreators).catch(() => {});
  addEventListener("chain-update", () => { syncCreators().catch(() => {}); });
})();
