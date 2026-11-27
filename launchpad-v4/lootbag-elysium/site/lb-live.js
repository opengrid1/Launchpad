/* Ambrosia live data and wallet actions, on Elysium. Builds window.LB_DATA from the Ambrosia contracts (LB_CFG), in
   the shape the pages read, and exposes window.LB_LIVE for everything a wallet does: buy, sell, launch, claim, Jars.
   There is no server: coins, trades, fees and payouts are read from the contracts' own logs through public RPCs.
   HYPE's dollar price is Hyperliquid's; KNTQ's comes from the WHYPE/KNTQ pool. Reads are grouped through Multicall3.
   Until the contracts are deployed (LB_CFG.contracts is empty) only the prices are read, and nothing can be sent. */
(function () {
  const C = window.LB_CFG, K = C.contracts, E = window.ethers;
  const lc = (a) => String(a || '').toLowerCase();
  const eq = (a, b) => lc(a) === lc(b);
  const ZERO = '0x0000000000000000000000000000000000000000', DEAD = '0x000000000000000000000000000000000000dead';
  // WHYPE is wrapped HYPE: pools and fees are in it, while buyers and holders pay and receive HYPE itself
  const WHYPE = C.tokens.HYPE[0], KNTQ = C.tokens.KNTQ[0], NATIVE = (C.native || {}).symbol || 'HYPE';
  // the platform's own coin is shown by its ticker wherever it is a pair or a reward
  const OWN = (C.brand || {}).coin || 'COIN';
  const DEPLOYED = ['factory', 'hook', 'payout', 'swapper', 'bags', 'airdrop', 'router'].every((k) => /^0x[0-9a-fA-F]{40}$/.test(K[k] || ''));
  const now = () => Math.floor(Date.now() / 1000);
  const SUPPLY = 1e9;

  const LB = (window.LB_DATA = {
    live: true, deployed: DEPLOYED, error: '', paused: true, loot: '', hypeUsd: 0, kntqUsd: 0, tokens: [], memes: [], coins: [],
    // what the contracts charge, read from them: the launch fee and the copy fee in HYPE, the least dev buy per pair
    fees: { launch: 0, copy: 0, minDev: {}, open: {} },
    airdrop: { pot: 0, potUsd: 0, endsAt: 0, traders: 0, volume: 0, board: [], rounds: [] },
    bags: { total: 1000, minted: 0, perMintLoot: 100000, perMintKntq: 0, toBagsKntq: 0, pot: 0, paidUsd: 0, drops: 0, nextHour: 0, rotation: [], today: 'KNTQ', list: [], lootSet: false },
    platform: { volumeAll: 0, paidHolders: 0, payments: 0, coins: 0, traders: 0 },
    ready: null,
  });

  const ABI = {
    factory: [
      'event Launched(address indexed coin, address indexed creator, address indexed quote, bytes32 poolId, string name, string symbol, address[] rewards, uint256 devBuyQuote, uint256 devBuyCoins)',
      'event MetaSet(address indexed coin, string image, string description, string x, string telegram, string website)',
      'function paused() view returns (bool)', 'function quotes(address) view returns (bool listed, int24 startTick, uint256 minDevBuy)',
      'function rewardListed(address) view returns (bool)', 'function launchFee(string symbol) view returns (uint256)', 'function LAUNCH_FEE() view returns (uint256)', 'function COPY_FEE() view returns (uint256)',
      'function launchWithEth((string name, string symbol, address quote, address[] rewards, uint256 devBuy, uint256 minCoinsOut) p, (string image, string description, string x, string telegram, string website) m, uint256 minQuoteOut) payable returns (address coin)',
    ],
    hook: ['event Fee(address indexed coin, address indexed quote, uint256 holders, uint256 lootbag)'],
    payout: [
      'event Paid(address indexed coin, uint256 indexed round, address reward, uint256 quoteIn, uint256 rewardOut, uint256 holders)',
      'event Claimed(address indexed coin, address indexed account, uint256 amount)',
      'event Registered(address indexed coin, address quote, address[] rewards, uint64 launchedAt)',
      'function held(address) view returns (uint256)', 'function claim(address c) returns (uint256 amount)',
    ],
    router: [
      'event Bought(address indexed coin, address indexed to, uint256 ethIn, uint256 coinsOut)', 'event Sold(address indexed coin, address indexed seller, uint256 coinsIn, uint256 ethOut)',
      'function buy(address coin, uint256 minCoinsOut, address to) payable returns (uint256 coinsOut)', 'function sell(address coin, uint256 coinsIn, uint256 minEthOut, address to) returns (uint256 ethOut)',
    ],
    airdrop: [
      'event Posted(uint256 indexed round, bytes32 root, uint256 total, string listUri)', 'event Paid(uint256 indexed round, address indexed account, uint256 amount)',
      'function pot() view returns (uint256)', 'function nextRoundAt() view returns (uint256)',
    ],
    bags: [
      'event Minted(uint256 indexed id, address indexed to)', 'event Dropped(address indexed token, uint256 spentKntq, uint256 total, uint256 perBag)', 'function MINT_KNTQ() view returns (uint256)', 'function MINT_TO_BAGS() view returns (uint256)',
      'function minted() view returns (uint256)', 'function pot() view returns (uint256)', 'function today() view returns (address)', 'function lastDrop() view returns (uint256)',
      'function dayTokens() view returns (address[])', 'function loot() view returns (address)', 'function ownerOf(uint256 id) view returns (address)',
      'function vault(uint256 id, address token) view returns (uint256)', 'function mint() returns (uint256 id)', 'function withdraw(uint256 id, address[] tokens)',
    ],
    token: [
      'event Transfer(address indexed from, address indexed to, uint256 value)', 'function balanceOf(address) view returns (uint256)', 'function earned(address) view returns (uint256)',
      'function allowance(address, address) view returns (uint256)', 'function approve(address spender, uint256 value) returns (bool)',
    ],
    swapper: ['function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient) returns (uint256 out)'],
    pm: ['event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)', 'function extsload(bytes32 slot) view returns (bytes32)'],
    pool: ['function slot0() view returns (uint160 sqrtPriceX96)'],
    mc: ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])', 'function getEthBalance(address) view returns (uint256)'],
    errors: [
      'error Paused()', 'error BadName()', 'error BadSymbol()', 'error BadQuote()', 'error BadRewards()', 'error DevBuyTooSmall()', 'error DevBuyTooBig(uint256 coins)', 'error DevBuyShort(uint256 coins)',
      'error NoEthForDevBuy()', 'error MetaTooLong()', 'error MetaAlreadySet()', 'error TooLittle(uint256 out, uint256 minOut)', 'error PoolTooThin()', 'error UnknownCoin()', 'error ZeroAmount()',
      'error NoRoute()', 'error InsufficientBalance()', 'error InsufficientAllowance()', 'error EthNotSent()', 'error SoldOut()', 'error NotHolder()', 'error TokenCallFailed()', 'error Reentered()',
    ],
  };
  const I = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new E.Interface(v)]));
  const WHY = {
    Paused: 'Launches are not open yet.', BadName: 'The name must be 1 to 32 characters.', BadSymbol: 'The ticker must be 2 to 10 letters or digits.', BadQuote: 'That pair is not available.',
    BadRewards: 'One of the rewards is not available.', DevBuyTooSmall: 'The dev buy is too small. Raise it a little.', DevBuyTooBig: 'The dev buy would be more than 2% of the supply. Lower it.',
    DevBuyShort: 'The dev buy came out smaller than expected. Try again.', NoEthForDevBuy: 'Add a dev buy on top of the launch fee.', MetaTooLong: 'The picture, description or a link is too long.',
    TooLittle: 'The price moved more than the slippage allows. Try again.', PoolTooThin: "The pool can't fill this trade. Try a smaller amount.", UnknownCoin: 'This coin is not a Ambrosia coin.',
    ZeroAmount: 'Enter an amount.', NoRoute: 'There is no route for this pair yet.', InsufficientBalance: "You don't hold that many coins.", SoldOut: 'All Jars are minted.', NotHolder: 'This wallet does not hold that Jar.',
  };
  /** A sentence a person can act on, from whatever a wallet or an RPC threw. */
  function explain(e) {
    if (!e) return 'Something went wrong.';
    if (e.code === 'ACTION_REJECTED' || e.code === 4001 || (e.info && e.info.error && e.info.error.code === 4001)) return 'Cancelled in the wallet.';
    const data = e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data);
    if (typeof data === 'string' && data.length >= 10) { try { const p = I.errors.parseError(data); if (p) return WHY[p.name] || p.name; } catch (x) { /* not one of ours */ } }
    const m = String(e.shortMessage || e.message || e);
    if (e.code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(m)) return `Not enough ${NATIVE} in the wallet for this and its gas.`;
    if (/user rejected|user denied|rejected the request/i.test(m)) return 'Cancelled in the wallet.';
    return m.length > 140 ? m.slice(0, 140) + '…' : m;
  }

  // ---------------------------------------------------------------- RPC
  // Public RPCs rate-limit and drop out, so every read is tried on each in turn, staying on whichever answered
  // last. A contract that reverts is an answer, not an RPC failure, and is never retried elsewhere.
  const PROVS = [C.rpc, ...(C.rpcFallbacks || [])].map((u) => new E.JsonRpcProvider(u, C.chainId, { staticNetwork: true }));
  let rpcAt = 0;
  async function rpc(fn, ms = 15000) {
    let last;
    for (let i = 0; i < PROVS.length; i++) {
      const at = (rpcAt + i) % PROVS.length;
      try {
        const v = await Promise.race([fn(PROVS[at]), new Promise((_, rej) => setTimeout(() => rej(new Error('the RPC did not answer in time')), ms))]);
        rpcAt = at;
        return v;
      } catch (e) { if (e && e.code === 'CALL_EXCEPTION') throw e; last = e; }
    }
    throw last;
  }
  const hex = (n) => '0x' + BigInt(n).toString(16);
  // Logs come in spans a public RPC accepts; a span that is refused everywhere is halved and tried again.
  const SPAN = C.logSpan || 45000;
  async function logSpan(filter, a, b) {
    try { return await rpc((p) => p.send('eth_getLogs', [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }]), 25000); }
    catch (e) { if (b - a < 400) throw e; const m = Math.floor((a + b) / 2); return [...(await logSpan(filter, a, m)), ...(await logSpan(filter, m + 1, b))]; }
  }
  // History that can no longer change comes from the log cache (LB_CFG.logsApi): fixed windows of blocks, one span
  // or ten spans wide, answered once and then kept by the CDN. Only the open end of the range is read from the RPC. If the
  // cache does not answer, that window is read from the RPC too.
  const BIG = SPAN * 10, CLOSED = 1500;
  let apiOff = !C.logsApi;
  const shape = (l) => ({ address: lc(l.address), topics: l.topics, data: l.data, bn: parseInt(l.blockNumber, 16), ix: parseInt(l.logIndex, 16), tx: l.transactionHash, bts: l.blockTimestamp ? parseInt(l.blockTimestamp, 16) : 0 });
  async function direct(filter, a, b) {
    const out = []; for (let x = a; x <= b; x += SPAN) out.push(...(await logSpan(filter, x, Math.min(b, x + SPAN - 1))));
    return out.map(shape);
  }
  async function cached(key, filter, a, size) {
    if (!apiOff) {
      try {
        const r = await fetch(`${C.logsApi}?kind=${key.kind}${key.id ? '&id=' + key.id : ''}&from=${a}&size=${size}`);
        if (r.status === 200) return (await r.json()).logs.map(([address, topics, data, bn, ix, tx, bts]) => ({ address: lc(address), topics, data, bn, ix, tx, bts }));
        // too much for one answer: the same range in ten smaller windows
        if (r.status === 413 && size === BIG) { const parts = []; for (let x = a; x < a + BIG; x += SPAN) parts.push(...(await cached(key, filter, x, SPAN))); return parts; }
        if (r.status === 404 && !/json/.test(r.headers.get('content-type') || '')) apiOff = true; // no cache on this host
      } catch (e) { /* the RPC answers instead */ }
    }
    return direct(filter, a, a + size - 1);
  }
  async function getLogs(filter, from, to, key) {
    if (to < from) return [];
    const jobs = [], safe = S.head.bn - CLOSED;
    for (let x = from; x <= to;) {
      if (key && !apiOff && x % BIG === 0 && x + BIG - 1 <= safe && x + BIG - 1 <= to) { const a = x; jobs.push(() => cached(key, filter, a, BIG)); x += BIG; }
      else if (key && !apiOff && x % SPAN === 0 && x + SPAN - 1 <= safe && x + SPAN - 1 <= to) { const a = x; jobs.push(() => cached(key, filter, a, SPAN)); x += SPAN; }
      else { const a = x, b = Math.min(to, (Math.floor(x / SPAN) + 1) * SPAN - 1); jobs.push(() => direct(filter, a, b)); x = b + 1; }
    }
    const out = new Array(jobs.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => { while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); } }));
    return out.flat().sort((x, y) => x.bn - y.bn || x.ix - y.ix);
  }
  const mcC = new E.Contract(C.multicall, ABI.mc);
  /** calls: [target, interface key, function, args]; returns each decoded result, or null where the call failed */
  async function multi(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 150) {
      const part = calls.slice(i, i + 150);
      const res = await rpc((p) => mcC.connect(p).aggregate3.staticCall(part.map(([t, k, fn, args]) => ({ target: t, allowFailure: true, callData: I[k].encodeFunctionData(fn, args || []) }))));
      res.forEach((r, j) => { let v = null; if (r.success && r.returnData !== '0x') { try { v = I[part[j][1]].decodeFunctionResult(part[j][2], r.returnData); } catch (e) { v = null; } } out.push(v); });
    }
    return out;
  }

  // ---------------------------------------------------------------- tokens and prices
  // symbol and decimals of everything a coin can be paired with or pay: HYPE (WHYPE on-chain), KNTQ, Ambrosia coins
  const TOK = new Map(Object.entries(C.tokens).map(([s, [a, d]]) => [lc(a), { sym: s, dec: d }]));
  const S = { head: { bn: 0, ts: 0 }, scanned: (C.startBlock || 1) - 1, coins: new Map(), reg: new Map(), fees: [], trades: [], paid: [], drops: [], posted: [], minted: 0, pricesAt: 0, sqrt: {}, listed: null };
  const sym = (a) => { if (LB.loot && eq(a, LB.loot)) return OWN; const t = TOK.get(lc(a)); if (t) return t.sym; const c = S.coins.get(lc(a)); return c ? c.ticker : String(a).slice(0, 6) + '…' + String(a).slice(-4); };
  const dec = (a) => (TOK.get(lc(a)) || { dec: 18 }).dec;
  const addrOf = (s) => { if (s === OWN) return LB.loot; if (C.tokens[s]) return C.tokens[s][0]; const c = LB.coins.find((x) => x.ticker === s); return c ? c.addr : ''; };
  const ratio = (sqrtP) => (Number(sqrtP) / 2 ** 96) ** 2; // raw token1 per raw token0
  const first160 = (word) => BigInt(word) & ((1n << 160n) - 1n);
  function usdOf(a) {
    if (eq(a, WHYPE)) return LB.hypeUsd; if (eq(a, KNTQ)) return LB.kntqUsd;
    const c = S.coins.get(lc(a)); return c ? c.priceUsd || 0 : 0;
  }
  // HYPE in dollars from Hyperliquid's mid price, at most twice a minute; the last good price stands if it fails
  let midsAt = 0, kntqSpot = 0;
  async function mids() {
    if (now() - midsAt < 30 || !C.prices || !C.prices.api) return;
    midsAt = now();
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 7000);
      const j = await (await fetch(C.prices.api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'allMids' }), signal: ctl.signal })).json();
      clearTimeout(t);
      if (j && Number(j[C.prices.hype]) > 0) LB.hypeUsd = Number(j[C.prices.hype]);
      if (j && Number(j[C.prices.kntq]) > 0) kntqSpot = Number(j[C.prices.kntq]);
    } catch (e) { midsAt = now() - 20; /* soon again */ }
  }
  // KNTQ in dollars: KNTQ per WHYPE in the pool the routes use, against HYPE's dollar price; Hyperliquid's own KNTQ
  // market stands in when the pool can't be read
  function priceKntq(word) {
    const p = word ? ratio(first160(word)) : 0; // token1 per token0, both 18 decimals
    const perHype = p ? (BigInt(lc(WHYPE)) < BigInt(lc(KNTQ)) ? p : 1 / p) : 0;
    if (perHype > 0 && LB.hypeUsd > 0) LB.kntqUsd = LB.hypeUsd / perHype; else if (kntqSpot > 0) LB.kntqUsd = kntqSpot;
  }
  const units = (v, a) => Number(E.formatUnits(v, dec(a)));
  const slot0Of = (poolId) => E.keccak256(E.AbiCoder.defaultAbiCoder().encode(['bytes32', 'uint256'], [poolId, 6]));

  // ---------------------------------------------------------------- the logs
  // a log's time: its own timestamp where the RPC gives one, otherwise from the chain's measured block time
  const tsOf = (l) => l.bts || Math.round(S.head.ts - (S.head.bn - l.bn) * (S.blockTime || C.blockTime || 0.2));
  const okImg = (s) => (/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '');
  const okUrl = (s) => (/^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : '');
  const parse = (k, l) => { try { return I[k].parseLog({ topics: l.topics, data: l.data }); } catch (e) { return null; } };
  function ingest(logs) {
    for (const l of logs) {
      const ts = tsOf(l);
      if (l.address === lc(K.factory)) {
        const p = parse('factory', l); if (!p) continue;
        if (p.name === 'Launched') {
          const a = p.args, c = {
            addr: a.coin, name: a.name, ticker: a.symbol, official: false, desc: '', creator: a.creator, createdAt: S.reg.get(lc(a.coin)) || ts, block: l.bn, launchTx: l.tx, poolId: a.poolId,
            pairAddr: a.quote, rewardAddrs: [...a.rewards], pair: '', rewards: [], rewardIx: 0, mcap: 0, priceUsd: 0, priceQuote: 0, ch24: 0, vol24: 0, volAll: 0, holders: null,
            trades24: 0, fees24: 0, paid24: 0, paidAll: 0, pot: 0, heldQuote: 0n, nextPayout: 300, candles: [], x: '', tg: '', web: '', img: '', trades: [], holderList: [], payouts: [], detail: false,
          };
          S.coins.set(lc(a.coin), c);
          S.trades.push({ ts, coin: lc(a.coin), wallet: a.creator, buy: true, eth: 0, quote: a.devBuyQuote, tokens: Number(E.formatEther(a.devBuyCoins)), tx: l.tx, dev: true });
        } else if (p.name === 'MetaSet') {
          const c = S.coins.get(lc(p.args.coin)); if (!c) continue;
          c.img = okImg(p.args.image); c.desc = String(p.args.description || '').slice(0, 280); c.x = okUrl(p.args.x); c.tg = okUrl(p.args.telegram); c.web = okUrl(p.args.website);
        }
      } else if (l.address === lc(K.payout)) {
        const p = parse('payout', l); if (!p) continue;
        if (p.name === 'Registered') S.reg.set(lc(p.args.coin), Number(p.args.launchedAt)); // logged just before the factory's Launched
        else if (p.name === 'Paid') S.paid.push({ ts, coin: lc(p.args.coin), reward: p.args.reward, quoteIn: p.args.quoteIn, wallets: Number(p.args.holders), tx: l.tx });
        else if (p.name === 'Claimed') S.paid.push({ ts, coin: lc(p.args.coin), reward: '', quoteIn: p.args.amount, wallets: 1, tx: l.tx, claim: true });
      } else if (l.address === lc(K.hook)) {
        const p = parse('hook', l); if (p && p.name === 'Fee') S.fees.push({ ts, coin: lc(p.args.coin), fee: p.args.holders + p.args.lootbag });
      } else if (l.address === lc(K.router)) {
        const p = parse('router', l); if (!p) continue;
        if (p.name === 'Bought') S.trades.push({ ts, coin: lc(p.args.coin), wallet: p.args.to, buy: true, eth: Number(E.formatEther(p.args.ethIn)), tokens: Number(E.formatEther(p.args.coinsOut)), tx: l.tx });
        else if (p.name === 'Sold') S.trades.push({ ts, coin: lc(p.args.coin), wallet: p.args.seller, buy: false, eth: Number(E.formatEther(p.args.ethOut)), tokens: Number(E.formatEther(p.args.coinsIn)), tx: l.tx });
      } else if (l.address === lc(K.airdrop)) {
        const p = parse('airdrop', l); if (p && p.name === 'Posted') S.posted.push({ id: Number(p.args.round), ts, total: Number(E.formatEther(p.args.total)), listUri: okUrl(p.args.listUri), tx: l.tx });
      } else if (l.address === lc(K.bags)) {
        const p = parse('bags', l); if (p && p.name === 'Dropped') S.drops.push({ ts, token: p.args.token, spent: Number(E.formatEther(p.args.spentKntq)) });
      }
    }
  }

  // ---------------------------------------------------------------- one refresh: new logs, then one grouped read
  let busy = null;
  function refresh() { if (!busy) busy = doRefresh().finally(() => { busy = null; }); return busy; }
  const tokenList = () => Object.entries(C.tokens).map(([s, [addr, d, name]]) => ({ sym: s, name: name || s, addr, dec: d, usd: usdOf(addr), quote: false, reward: false }));
  async function doRefresh() {
    await mids();
    const slotK = C.prices && C.prices.kntqPoolId ? [[K.poolManager, 'pm', 'extsload', [slot0Of(C.prices.kntqPoolId)]]] : [];
    if (!DEPLOYED) {
      // nothing of Ambrosia's to read yet: prices only, so the pages can still show what things will cost
      const r0 = slotK.length ? await multi(slotK).catch(() => [null]) : [null];
      priceKntq(r0[0] && r0[0][0]);
      LB.tokens = tokenList(); LB.paused = true; LB.error = ''; LB.at = now();
      return;
    }
    const head = await rpc((p) => p.send('eth_getBlockByNumber', ['latest', false]));
    S.head = { bn: parseInt(head.number, 16), ts: parseInt(head.timestamp, 16) };
    if (!S.blockTime) { try { const old = await rpc((p) => p.send('eth_getBlockByNumber', [hex(Math.max(1, S.head.bn - 5000)), false])); S.blockTime = (S.head.ts - parseInt(old.timestamp, 16)) / 5000; } catch (e) { /* the default stands */ } }
    ingest(await getLogs({ address: [K.factory, K.hook, K.payout, K.router, K.airdrop, K.bags] }, S.scanned + 1, S.head.bn, { kind: 'platform' }));
    S.scanned = S.head.bn;

    const coins = [...S.coins.values()], toks = Object.values(C.tokens).map((x) => x[0]);
    // the reads that are always made, by name, then two per token and two per coin
    const fixed = [
      ['paused', [K.factory, 'factory', 'paused']], ['launchFee', [K.factory, 'factory', 'LAUNCH_FEE']], ['copyFee', [K.factory, 'factory', 'COPY_FEE']],
      ['aPot', [K.airdrop, 'airdrop', 'pot']], ['aNext', [K.airdrop, 'airdrop', 'nextRoundAt']],
      ['bMinted', [K.bags, 'bags', 'minted']], ['bPot', [K.bags, 'bags', 'pot']], ['bToday', [K.bags, 'bags', 'today']], ['bLast', [K.bags, 'bags', 'lastDrop']], ['bDays', [K.bags, 'bags', 'dayTokens']], ['bLoot', [K.bags, 'bags', 'loot']],
      ['bMint', [K.bags, 'bags', 'MINT_KNTQ']], ['bToBags', [K.bags, 'bags', 'MINT_TO_BAGS']],
      ...(slotK.length ? [['kntq', slotK[0]]] : []),
    ];
    const r = await multi([
      ...fixed.map((x) => x[1]),
      ...toks.flatMap((a) => [[K.factory, 'factory', 'quotes', [a]], [K.factory, 'factory', 'rewardListed', [a]]]),
      ...coins.flatMap((c) => [[K.poolManager, 'pm', 'extsload', [slot0Of(c.poolId)]], [K.payout, 'payout', 'held', [c.addr]]]),
    ]);
    const G = Object.fromEntries(fixed.map((x, i) => [x[0], r[i]])), tokAt = fixed.length, coinAt = tokAt + toks.length * 2;
    const { paused, aPot, aNext, bMinted, bPot, bToday, bLast, bDays, bLoot } = G;
    priceKntq(G.kntq && G.kntq[0]);
    if (paused) LB.paused = !!paused[0];
    if (G.launchFee) LB.fees.launch = Number(E.formatEther(G.launchFee[0]));
    if (G.copyFee) LB.fees.copy = Number(E.formatEther(G.copyFee[0]));
    // what a coin can be paired with (the factory's listed quotes) and paid in (a listed reward, or its own pair)
    LB.tokens = tokenList().map((t, i) => {
      const q = r[tokAt + 2 * i], rw = r[tokAt + 2 * i + 1];
      // the least dev buy, and what the whole supply is worth at the opening tick, both in the pair's own units
      if (q && q.listed) { LB.fees.minDev[t.sym] = Number(E.formatUnits(q.minDevBuy, t.dec)); LB.fees.open[t.sym] = 1.0001 ** Number(q.startTick) * SUPPLY * 10 ** (18 - t.dec); }
      return { ...t, quote: !!(q && q.listed), reward: !!(rw && rw[0]) || !!(q && q.listed) };
    });
    LB.loot = C.loot || ''; // the config names the official coin

    // coins: price from the pool, then what the logs say about the last day
    const t = now(), day = t - 86400;
    coins.forEach((c, i) => { const s0 = r[coinAt + 2 * i], held = r[coinAt + 2 * i + 1]; if (s0) c.sqrt = first160(s0[0]); if (held) c.heldQuote = held[0]; });
    // a coin paired with another Ambrosia coin is priced after that coin, so HYPE and KNTQ pairs go first
    const priced = (c) => { const qd = dec(c.pairAddr), p = ratio(c.sqrt || 0n); if (!p) return; const is0 = BigInt(lc(c.addr)) < BigInt(lc(c.pairAddr)); c.priceQuote = (is0 ? p : 1 / p) * 10 ** (18 - qd); c.priceUsd = c.priceQuote * usdOf(c.pairAddr); c.mcap = c.priceUsd * SUPPLY; };
    coins.filter((c) => !S.coins.has(lc(c.pairAddr))).forEach(priced); coins.filter((c) => S.coins.has(lc(c.pairAddr))).forEach(priced);
    for (const c of coins) { c.vol24 = c.volAll = c.fees24 = c.paid24 = c.paidAll = c.trades24 = 0; c.trades = []; c.payouts = []; }
    let volAll = 0, paidAll = 0;
    for (const f of S.fees) { const c = S.coins.get(f.coin); if (!c) continue; const usd = units(f.fee, c.pairAddr) * usdOf(c.pairAddr), vol = usd * 50; c.volAll += vol; volAll += vol; if (f.ts >= day) { c.vol24 += vol; c.fees24 += usd; c.trades24++; } }
    for (const x of S.paid) { const c = S.coins.get(x.coin); if (!c) continue; const usd = units(x.quoteIn, c.pairAddr) * usdOf(c.pairAddr); c.paidAll += usd; paidAll += usd; if (x.ts >= day) c.paid24 += usd; c.payouts.unshift({ ts: x.ts, token: x.claim ? sym(c.pairAddr) : sym(x.reward), usd, wallets: x.wallets, claim: !!x.claim, tx: x.tx }); }
    const traders = new Map(), roundFrom = S.posted.length ? S.posted[S.posted.length - 1].ts : 0;
    let roundVol = 0;
    for (const x of S.trades) {
      const c = S.coins.get(x.coin); if (!c) continue;
      const usd = x.dev ? units(x.quote, c.pairAddr) * usdOf(c.pairAddr) : x.eth * LB.hypeUsd;
      c.trades.unshift({ ts: x.ts, wallet: x.wallet, buy: x.buy, usd, tokens: x.tokens, tx: x.tx, dev: !!x.dev });
      if (x.ts >= roundFrom && !x.dev) { traders.set(lc(x.wallet), (traders.get(lc(x.wallet)) || 0) + usd); roundVol += usd; }
    }
    for (const c of coins) {
      c.official = !!LB.loot && eq(c.addr, LB.loot);
      c.pair = sym(c.pairAddr); c.rewards = c.rewardAddrs.map(sym);
      c.rewardIx = Math.floor(Math.max(0, t - c.createdAt) / 300) % c.rewards.length;
      c.nextPayout = 300 - (Math.max(0, t - c.createdAt) % 300);
      c.pot = units(c.heldQuote, c.pairAddr) * usdOf(c.pairAddr);
      if (c.detail) buildDetail(c);
    }
    // every coin, and the ones the site lists (LB_CFG.hidden are left off the lists but keep their own page)
    const hid = new Set((C.hidden || []).map(lc));
    LB.allCoins = coins.slice().sort((a, b) => b.createdAt - a.createdAt);
    LB.coins = LB.allCoins.filter((c) => !hid.has(lc(c.addr)));
    LB.memes = LB.loot ? [{ sym: OWN, name: (C.brand || {}).name || OWN, usd: (S.coins.get(lc(LB.loot)) || {}).priceUsd || 0, addr: LB.loot }] : [];
    LB.platform = { volumeAll: volAll, paidHolders: paidAll, payments: S.paid.reduce((n, x) => n + x.wallets, 0), coins: LB.coins.length, traders: new Set(S.trades.map((x) => lc(x.wallet))).size };

    // the trader airdrop: the pot, and this round's volume through the Ambrosia router by wallet
    const A = LB.airdrop;
    if (aPot) { A.pot = Number(E.formatEther(aPot[0])); A.potUsd = A.pot * LB.kntqUsd; }
    A.endsAt = aNext ? Number(aNext[0]) : 0;
    // until the full board has been worked out (leaderboard()), the trades through Ambrosia's own router stand in
    if (!S.boardFull) { A.board = [...traders.entries()].map(([wallet, vol]) => ({ wallet, vol })).sort((a, b) => b.vol - a.vol); A.traders = A.board.length; A.volume = roundVol; }
    A.rounds = S.posted.slice().reverse();

    // Jars
    const B = LB.bags, days = bDays ? [...bDays[0]] : [];
    if (bMinted) B.minted = Number(bMinted[0]);
    if (bPot) B.pot = Number(E.formatEther(bPot[0]));
    if (G.bMint) { B.perMintKntq = Number(E.formatEther(G.bMint[0])); B.perMintKntqWei = G.bMint[0]; }
    if (G.bToBags) B.toBagsKntq = Number(E.formatEther(G.bToBags[0]));
    // minting is open on the site only when the Jars contract burns the coin the site calls $AMBROSIA
    B.lootSet = !!(bLoot && !eq(bLoot[0], ZERO) && LB.loot && eq(bLoot[0], LB.loot));
    B.rotation = days.map(sym); B.dayAddrs = days;
    if (bToday) B.today = sym(bToday[0]);
    B.lastDrop = bLast ? Number(bLast[0]) : 0; B.nextHour = Math.max(0, B.lastDrop + 3600 - t);
    B.drops = S.drops.length; B.paidUsd = S.drops.reduce((s, d) => s + d.spent, 0) * LB.kntqUsd;
    if (B.minted && (B.minted !== S.minted || !B.list.length)) await loadBags(days).catch(() => {});
    LB.error = '';
    LB.at = t;
  }
  async function loadBags(days) {
    const B = LB.bags, n = Math.min(B.minted, 400), toks = [...new Set([KNTQ, ...days].map(lc))];
    const r = await multi(Array.from({ length: n }, (_, k) => [[K.bags, 'bags', 'ownerOf', [k + 1]], ...toks.map((tk) => [K.bags, 'bags', 'vault', [k + 1, tk]])]).flat());
    const w = toks.length + 1;
    B.list = Array.from({ length: n }, (_, k) => {
      const owner = r[k * w] ? r[k * w][0] : '', vault = toks.map((tk, j) => ({ sym: sym(tk), addr: tk, amount: r[k * w + 1 + j] ? units(r[k * w + 1 + j][0], tk) : 0 })).filter((v) => v.amount > 0);
      return { id: k + 1, owner, vault, earned: vault.reduce((s, v) => s + v.amount * usdOf(v.addr), 0) };
    });
    S.minted = B.minted;
  }

  // ---------------------------------------------------------------- one coin: its swaps (the chart) and its holders
  const SWAP_T = I.pm.getEvent('Swap').topicHash, XFER_T = I.token.getEvent('Transfer').topicHash;
  const loading = new Map();
  function coinDetail(addr) {
    const c = S.coins.get(lc(addr)); if (!c) return Promise.resolve(null);
    if (loading.has(lc(addr))) return loading.get(lc(addr));
    const job = (async () => {
      const d = c._d || (c._d = { scanned: c.block - 1, swaps: [], bal: new Map(), moves: new Map() }), to = S.head.bn;
      const [sw, tr] = await Promise.all([getLogs({ address: K.poolManager, topics: [SWAP_T, c.poolId] }, d.scanned + 1, to, { kind: 'swaps', id: lc(c.poolId) }), getLogs({ address: c.addr, topics: [XFER_T] }, d.scanned + 1, to, { kind: 'xfers', id: lc(c.addr) })]);
      const is0 = BigInt(lc(c.addr)) < BigInt(lc(c.pairAddr)), qd = dec(c.pairAddr);
      for (const l of sw) {
        const p = parse('pm', l); if (!p) continue;
        // amounts are the swapper's: positive is what they received, so a positive coin amount is a buy
        const pr = ratio(p.args.sqrtPriceX96), q = is0 ? p.args.amount1 : p.args.amount0, got = is0 ? p.args.amount0 : p.args.amount1;
        d.swaps.push({ ts: tsOf(l), px: (is0 ? pr : 1 / pr) * 10 ** (18 - qd), q: Math.abs(Number(E.formatUnits(q, qd))), buy: got > 0n, tokens: Math.abs(Number(E.formatEther(got))), tx: l.tx, via: p.args.sender });
      }
      for (const l of tr) {
        const p = parse('token', l); if (!p) continue;
        const f = lc(p.args.from), t2 = lc(p.args.to), v = p.args.value;
        if (f !== ZERO) d.bal.set(f, (d.bal.get(f) || 0n) - v);
        if (!d.moves.has(l.tx)) d.moves.set(l.tx, []);
        d.moves.get(l.tx).push([f, t2]);
        d.bal.set(t2, (d.bal.get(t2) || 0n) + v);
      }
      d.scanned = to; c.detail = true;
      // what the biggest holders can claim right now
      const skip = new Set([ZERO, DEAD, lc(K.poolManager), lc(K.hook), lc(K.factory)]);
      const top = [...d.bal.entries()].filter(([a, v]) => v > 0n && !skip.has(a)).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
      d.holders = top.length; d.top = top.slice(0, 20).map(([wallet, v]) => ({ wallet, bal: v, earned: 0n }));
      const er = await multi(d.top.map((h) => [c.addr, 'token', 'earned', [h.wallet]])).catch(() => []);
      d.top.forEach((h, i) => { if (er[i]) h.earned = er[i][0]; });
      buildDetail(c);
      return c;
    })().finally(() => loading.delete(lc(addr)));
    loading.set(lc(addr), job);
    return job;
  }
  function buildDetail(c) {
    const d = c._d; if (!d) return;
    const qUsd = usdOf(c.pairAddr), out = []; let cur = null;
    for (const s of d.swaps) {
      const mc = s.px * qUsd * SUPPLY, b = Math.floor(s.ts / 60) * 60, v = s.q * qUsd;
      if (!cur || cur.t !== b) { const o = cur ? cur.c : mc; cur = { t: b, o, h: Math.max(o, mc), l: Math.min(o, mc), c: mc, v }; out.push(cur); }
      else { cur.h = Math.max(cur.h, mc); cur.l = Math.min(cur.l, mc); cur.c = mc; cur.v += v; }
    }
    c.candles = out;
    // every swap in the pool is a trade, whichever app made it. The trader is whoever the coins ended up with (a buy)
    // or first came from (a sell) in that transaction; the pool, the hook and the factory are never the trader.
    const inner = new Set([ZERO, DEAD, lc(K.poolManager), lc(K.hook), lc(K.factory)]);
    c.trades = d.swaps.map((s) => {
      const mv = d.moves.get(s.tx) || [], who = s.buy ? mv.map((m) => m[1]).filter((a) => !inner.has(a)).pop() : mv.map((m) => m[0]).filter((a) => !inner.has(a))[0];
      return { ts: s.ts, wallet: who || lc(s.via), buy: s.buy, usd: s.q * qUsd, tokens: s.tokens, tx: s.tx, dev: s.tx === c.launchTx };
    }).reverse();
    const dayAgo = now() - 86400, before = d.swaps.filter((s) => s.ts < dayAgo).pop() || d.swaps[0];
    c.ch24 = before && before.px ? (c.priceQuote / before.px - 1) * 100 : 0;
    c.holders = d.holders;
    c.holderList = (d.top || []).map((h) => ({ wallet: h.wallet, pct: (Number(E.formatEther(h.bal)) / SUPPLY) * 100, creator: eq(h.wallet, c.creator), earnedUsd: units(h.earned, c.pairAddr) * qUsd }));
  }

  /** Every wallet that has ever held `addr` (a Ambrosia coin), read up to the newest block. */
  async function wallets(addr) {
    await refresh();
    const c = await coinDetail(addr);
    return c ? [...c._d.bal.keys()].filter((a) => a !== ZERO) : [];
  }

  // ---------------------------------------------------------------- the trader airdrop's board
  /** This round's volume by trader, from every swap in every Ambrosia coin's pool: [{ wallet, vol }], biggest first. */
  async function leaderboard() {
    const coins = [...S.coins.values()].sort((a, b) => b.volAll - a.volAll).slice(0, 60);
    await Promise.all(coins.map((c) => coinDetail(c.addr).catch(() => null)));
    const from = S.posted.length ? S.posted[S.posted.length - 1].ts : 0, by = new Map();
    const infra = new Set([K.router, K.swapper, K.poolManager, K.hook, K.factory, K.payout, K.bags, K.airdrop, ZERO, DEAD].map(lc));
    for (const c of coins) for (const t of c.trades) { const w = lc(t.wallet); if (t.dev || t.ts < from || !w || infra.has(w)) continue; by.set(w, (by.get(w) || 0) + t.usd); }
    const A = LB.airdrop;
    A.board = [...by.entries()].map(([wallet, vol]) => ({ wallet, vol })).sort((a, b) => b.vol - a.vol);
    A.traders = A.board.length; A.volume = A.board.reduce((n, x) => n + x.vol, 0); S.boardFull = true;
    return A.board;
  }
  /** Each place's share of the pot, in percent: 5.3, 4 and 3 for the first three, 13 split by volume between places
      4 to 20, the rest split by volume between places 21 to 500, and never more than the place above. */
  function airdropShares(board) {
    const b = board.slice(0, 500), mid = b.slice(3, 20).reduce((n, x) => n + x.vol, 0) || 1, rest = b.slice(20).reduce((n, x) => n + x.vol, 0) || 1;
    const out = b.map((x, i) => (i === 0 ? 5.3 : i === 1 ? 4 : i === 2 ? 3 : i < 20 ? (13 * x.vol) / mid : (74.7 * x.vol) / rest));
    // with few traders a lower place could come out ahead of a higher one: no place gets more than the one above it
    for (let i = 1; i < out.length; i++) if (out[i] > out[i - 1]) out[i] = out[i - 1];
    return out;
  }

  // ---------------------------------------------------------------- a wallet's own numbers
  async function account(who) {
    who = E.getAddress(lc(who)); // a pasted address may carry a wrong checksum
    const coins = LB.allCoins || LB.coins, r = await multi([[C.multicall, 'mc', 'getEthBalance', [who]], ...coins.flatMap((c) => [[c.addr, 'token', 'balanceOf', [who]], [c.addr, 'token', 'earned', [who]]])]);
    const out = { eth: r[0] ? r[0][0] : 0n, coins: {} };
    coins.forEach((c, i) => { const bal = r[1 + 2 * i] ? r[1 + 2 * i][0] : 0n, earned = r[2 + 2 * i] ? r[2 + 2 * i][0] : 0n; out.coins[lc(c.addr)] = { bal, earned, earnedUsd: units(earned, c.pairAddr) * usdOf(c.pairAddr), earnedIn: sym(c.pairAddr), earnedAmount: units(earned, c.pairAddr) }; });
    return out;
  }

  // ---------------------------------------------------------------- wallet actions
  const subs = [];
  const tell = () => subs.forEach((f) => { try { f(); } catch (e) { /* a page's own problem */ } });
  let signer = null, me = '';
  async function setProvider(eip1193) {
    if (!eip1193) { signer = null; me = ''; return ''; }
    let bp = new E.BrowserProvider(eip1193);
    if (Number((await bp.getNetwork()).chainId) !== C.chainId) {
      try { await eip1193.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(C.chainId) }] }); }
      catch (e) {
        if (e && (e.code === 4902 || /unrecognized|not been added/i.test(String(e.message)))) await eip1193.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex(C.chainId), chainName: C.chainName, nativeCurrency: C.native || { name: 'HYPE', symbol: 'HYPE', decimals: 18 }, rpcUrls: [C.rpc], blockExplorerUrls: [C.explorer] }] });
        else throw e;
      }
      bp = new E.BrowserProvider(eip1193);
    }
    signer = await bp.getSigner(); me = await signer.getAddress();
    return me;
  }
  async function receipt(hash) {
    for (let i = 0; i < 80; i++) { try { const r = await rpc((p) => p.getTransactionReceipt(hash)); if (r) return r; } catch (e) { /* keep waiting */ } await new Promise((res) => setTimeout(res, 1500)); }
    throw new Error('The transaction was sent but has not confirmed yet. Check your wallet.');
  }
  /** Simulates on a public RPC (so a failure reads as a sentence), then sends through the wallet and waits. */
  async function send(to, k, fn, args, value = 0n, note) {
    if (!signer) throw new Error('Connect a wallet first.');
    if (!DEPLOYED) throw new Error(`Ambrosia is not live on ${C.chainName} yet.`);
    const data = I[k].encodeFunctionData(fn, args);
    let gas;
    try { gas = await rpc((p) => p.estimateGas({ from: me, to, data, value })); } catch (e) { throw new Error(explain(e)); }
    if (note) note('Confirm in your wallet…');
    let tx;
    try { tx = await signer.sendTransaction({ to, data, value, gasLimit: (gas * 13n) / 10n + 30000n }); } catch (e) { throw new Error(explain(e)); }
    if (note) note(`Sent. Waiting for ${C.chainName}…`);
    const rc = await receipt(tx.hash);
    if (rc.status !== 1) throw new Error('The transaction failed on-chain.');
    await refresh().then(tell).catch(() => {}); // the page shows the result before the button frees up
    return rc;
  }
  const slotOf = (types, vals) => E.keccak256(E.AbiCoder.defaultAbiCoder().encode(types, vals));
  const word = (v) => E.zeroPadValue(E.toBeHex(v), 32);
  /** Coins a buy of `wei` HYPE returns right now (fee and route included). */
  async function quoteBuy(coin, wei) {
    // asked as WHYPE itself, which always has the HYPE, so the answer does not depend on a wallet
    const res = await rpc((p) => p.call({ from: WHYPE, to: K.router, data: I.router.encodeFunctionData('buy', [coin, 0, me || DEAD]), value: wei }));
    return I.router.decodeFunctionResult('buy', res)[0];
  }
  /** HYPE a sale of `amount` coins returns right now. Simulated for a wallet given the coins and the approval. */
  async function quoteSell(coin, amount) {
    const who = me || '0x00000000000000000000000000000000000b0b17';
    const over = { [coin]: { stateDiff: { [slotOf(['address', 'uint256'], [who, 3])]: word(amount), [slotOf(['address', 'bytes32'], [K.router, slotOf(['address', 'uint256'], [who, 4])])]: word(amount) } } };
    const res = await rpc((p) => p.send('eth_call', [{ from: who, to: K.router, data: I.router.encodeFunctionData('sell', [coin, amount, 0, who]) }, 'latest', over]));
    return I.router.decodeFunctionResult('sell', res)[0];
  }
  const slip = (v, bps) => (v * BigInt(10000 - bps)) / 10000n;
  async function buy(coin, wei, bps, note) {
    let out; try { out = await quoteBuy(coin, wei); } catch (e) { throw new Error(explain(e)); }
    const rc = await send(K.router, 'router', 'buy', [coin, slip(out, bps), me], wei, note);
    const ev = rc.logs.map((l) => parse('router', l)).find((p) => p && p.name === 'Bought');
    return { coins: ev ? ev.args.coinsOut : out, tx: rc.hash };
  }
  async function sell(coin, amount, bps, note) {
    const tk = new E.Contract(coin, ABI.token);
    const allowed = await rpc((p) => tk.connect(p).allowance(me, K.router));
    if (allowed < amount) { if (note) note('First, let the Ambrosia router move this coin…'); await send(coin, 'token', 'approve', [K.router, E.MaxUint256], 0n, note); }
    let out; try { out = I.router.decodeFunctionResult('sell', await rpc((p) => p.call({ from: me, to: K.router, data: I.router.encodeFunctionData('sell', [coin, amount, 0, me]) })))[0]; } catch (e) { throw new Error(explain(e)); }
    const rc = await send(K.router, 'router', 'sell', [coin, amount, slip(out, bps), me], 0n, note);
    const ev = rc.logs.map((l) => parse('router', l)).find((p) => p && p.name === 'Sold');
    return { eth: ev ? ev.args.ethOut : out, tx: rc.hash };
  }
  const launchFee = (symbol) => rpc((p) => new E.Contract(K.factory, ABI.factory, p).launchFee(symbol));
  /** f: { name, symbol, pair, rewards[], dev (HYPE), image, description, x, telegram, website } with pair and rewards as symbols */
  async function launch(f, note) {
    if (!signer) throw new Error('Connect a wallet first.');
    const quote = addrOf(f.pair), rewards = (f.rewards.length ? f.rewards : [f.pair]).map(addrOf);
    if (!quote || rewards.some((a) => !a)) throw new Error('That pair or reward is not available.');
    const devWei = E.parseEther(String(f.dev)), fee = await launchFee(f.symbol);
    // the dev buy's HYPE is swapped into the pair inside the launch: the least that swap may return, from the prices
    let minQuote = 0n;
    if (!eq(quote, WHYPE)) { const expect = (Number(f.dev) * LB.hypeUsd) / (usdOf(quote) || Infinity); minQuote = E.parseUnits((expect * 0.94).toFixed(dec(quote)), dec(quote)); }
    const p = { name: f.name, symbol: f.symbol, quote, rewards, devBuy: 0, minCoinsOut: 1 };
    const m = { image: f.image || '', description: f.description || '', x: f.x || '', telegram: f.telegram || '', website: f.website || '' };
    const rc = await send(K.factory, 'factory', 'launchWithEth', [p, m, minQuote], fee + devWei, note);
    const ev = rc.logs.filter((l) => eq(l.address, K.factory)).map((l) => parse('factory', l)).find((x) => x && x.name === 'Launched');
    await refresh().catch(() => {});
    return { coin: ev ? ev.args.coin : '', tx: rc.hash };
  }
  const claim = (coin, note) => send(K.payout, 'payout', 'claim', [coin], 0n, note);
  async function mintBag(note) {
    const B = LB.bags; if (!B.lootSet) throw new Error('Minting opens when $AMBROSIA launches.');
    if (!B.perMintKntqWei) throw new Error('The mint price could not be read. Try again.');
    for (const [tok, need, label] of [[LB.loot, E.parseEther(String(B.perMintLoot)), '$AMBROSIA'], [KNTQ, B.perMintKntqWei, 'KNTQ']]) {
      const tk = new E.Contract(tok, ABI.token), [bal, allowed] = await Promise.all([rpc((p) => tk.connect(p).balanceOf(me)), rpc((p) => tk.connect(p).allowance(me, K.bags))]);
      if (bal < need) throw new Error(`You need ${E.formatEther(need)} ${label} to mint.`);
      if (allowed < need) { if (note) note(`First, let the Jars contract take your ${label}…`); await send(tok, 'token', 'approve', [K.bags, need], 0n, note); }
    }
    const rc = await send(K.bags, 'bags', 'mint', [], 0n, note);
    S.minted = -1; await refresh().catch(() => {});
    return rc;
  }
  async function withdrawBag(id, note) { const rc = await send(K.bags, 'bags', 'withdraw', [id, [...new Set([KNTQ, ...(LB.bags.dayAddrs || [])].map(lc))]], 0n, note); S.minted = -1; await refresh().catch(() => {}); return rc; }

  // ---------------------------------------------------------------- start, and keep fresh
  window.LB_LIVE = { deployed: DEPLOYED, native: NATIVE, refresh, coinDetail, wallets, leaderboard, airdropShares, account, setProvider, quoteBuy, quoteSell, buy, sell, launch, launchFee, claim, mintBag, withdrawBag, explain, addrOf, usdOf, sym, onUpdate: (f) => subs.push(f), get me() { return me; }, contracts: K };
  LB.ready = refresh().catch((e) => { LB.error = explain(e); });
  setInterval(() => { if (document.visibilityState === 'visible') refresh().then(tell).catch(() => {}); }, 20000);
})();
