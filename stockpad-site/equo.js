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
  ];
  const ERC20_ABI = ["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];

  const hookR = new E.Contract(addr.hook, HOOK_ABI, provider);
  const factR = new E.Contract(addr.factory, FACTORY_ABI, provider);
  const W = async (a, abi) => new E.Contract(a, abi, await signer());
  const lc = (a) => String(a || "").toLowerCase();
  const ZERO = "0x0000000000000000000000000000000000000000";
  const pairs = () => [cfg.weth || "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", ...(cfg.stocks || []).map((s) => s.address)].map(lc);
  const pairSym = (p) => { p = lc(p); if (p === lc(cfg.weth)) return "ETH"; const s = (cfg.stocks || []).find((x) => lc(x.address) === p); return s ? s.symbol : "?"; };

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
      const v = await Promise.all(ps.map((p) => hookR.rewardsOwed(user, p).catch(() => 0n)));
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
