/* Lootbag admin: owner controls and the hand-run keeper rounds for the Lootbag contracts on Base.
   Reads go through Multicall3 in a few eth_calls; writes go through the connected wallet. The contracts enforce every
   permission: this page only disables controls for wallets that are not the owner or a keeper. Until the contract
   addresses are in lb-config.js it is a preview and sends nothing. */
(function () {
  const C = window.LB_CFG, K = C.contracts, E = ethers;
  const NAMES = { factory: 'Factory', hook: 'Fee hook', payout: 'Payouts', swapper: 'Route swapper', bags: 'Bags', airdrop: 'Airdrop pot' };
  const LIVE = Object.keys(NAMES).every((k) => /^0x[0-9a-fA-F]{40}$/.test(K[k] || ''));
  const $ = (s, r = document) => r.querySelector(s), root = $('#ad-root');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eq = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
  const link = (a) => `<a class="mono" href="${C.explorer}/address/${a}" target="_blank" rel="noopener">${short(a)}</a>`;
  const isAddr = (v) => /^0x[0-9a-fA-F]{40}$/.test(v);
  const TICK = 200, BATCH = 100;

  const ABI = {
    own: ['function owner() view returns (address)', 'function pendingOwner() view returns (address)', 'function transferOwnership(address to)', 'function acceptOwnership()'],
    factory: [
      'function paused() view returns (bool)', 'function treasury() view returns (address)',
      'function quotes(address) view returns (bool listed, int24 startTick, uint256 minDevBuy)', 'function rewardListed(address) view returns (bool)',
      'function positions(address) view returns (int24 lo, int24 hi, uint128 liquidity)', 'function copyFeeHeld(address) view returns (uint256)',
      'function setPaused(bool p)', 'function setTreasury(address t)', 'function setQuote(address quote, bool listed, int24 startTick, uint256 minDevBuy)',
      'function setReward(address token, bool listed)', 'function settleCopyFee(address coin, bool refund)',
      'function collect(address coin, uint16 bps, address to) returns (uint256 coins, uint256 quote)',
      'event Launched(address indexed coin, address indexed creator, address indexed quote, bytes32 poolId, string name, string symbol, address[] rewards, uint256 devBuyQuote, uint256 devBuyCoins)',
      ],
    hook: ['function claims(address) view returns (uint256)', 'function owed(address) view returns (uint256)', 'function owedHolders(address) view returns (uint256)', 'function flush(address quote)', 'function split(address quote)'],
    payout: [
      'function keeper(address) view returns (bool)', 'function held(address) view returns (uint256)', 'function currentReward(address) view returns (address)',
      'function nextRoundAt(address) view returns (uint256)', 'function pay(address c, address[] holders, uint256 minOut) returns (uint256 out)', 'function setKeeper(address k, bool on)',
    ],
    bags: [
      'function keeper(address) view returns (bool)', 'function minted() view returns (uint256)', 'function pot() view returns (uint256)', 'function today() view returns (address)',
      'function lastDrop() view returns (uint256)', 'function dayTokens() view returns (address[])', 'function loot() view returns (address)',
      'function drop(uint256 minOut) returns (uint256 out)', 'function convert(address token, uint256 minOut) returns (uint256 out)', 'function setKeeper(address k, bool on)',
      'function setLoot(address loot_)',
    ],
    airdrop: ['function keeper(address) view returns (bool)', 'function pot() view returns (uint256)', 'function roundCount() view returns (uint256)', 'function nextRoundAt() view returns (uint256)', 'function setKeeper(address k, bool on)'],
    token: ['function earned(address) view returns (uint256)', 'event Transfer(address indexed from, address indexed to, uint256 value)'],
    erc20: ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'],
  };
  const I = Object.fromEntries(Object.entries(ABI).map(([k, v]) => [k, new E.Interface(v)]));
  // Public Base RPCs rate-limit hard and drop out, so every read is tried on each in turn: LB_CFG.rpc first, then
  // LB_CFG.rpcFallbacks, staying on whichever answered last. A contract that reverts is an answer, not an RPC
  // failure, so it is never retried elsewhere.
  const PROVS = [C.rpc, ...(C.rpcFallbacks || [])].map((u) => new E.JsonRpcProvider(u, C.chainId, { staticNetwork: true }));
  const MC_ABI = ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])'];
  let rpcAt = 0;
  async function rpc(fn) {
    let last;
    for (let i = 0; i < PROVS.length; i++) {
      const at = (rpcAt + i) % PROVS.length;
      try {
        const v = await Promise.race([fn(PROVS[at]), new Promise((_, rej) => setTimeout(() => rej(new Error('the RPC did not answer in time')), 12000))]);
        rpcAt = at;
        return v;
      } catch (e) { if (e && e.code === 'CALL_EXCEPTION') throw e; last = e; }
    }
    throw last;
  }

  /** calls: [target, interfaceName, fn, args]. Returns one decoded value (or null) per call. */
  async function multi(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 200) {
      const part = calls.slice(i, i + 200);
      const batch = part.map(([t, k, fn, a]) => ({ target: t, allowFailure: true, callData: I[k].encodeFunctionData(fn, a || []) }));
      const res = await rpc((p) => new E.Contract(C.multicall, MC_ABI, p).aggregate3(batch));
      res.forEach((r, j) => {
        let v = null;
        if (r.success && r.returnData !== '0x') { try { const d = I[part[j][1]].decodeFunctionResult(part[j][2], r.returnData); v = d.length === 1 ? d[0] : d; } catch { v = null; } }
        out.push(v);
      });
    }
    return out;
  }
  async function logs(address, topics, from) {
    const head = await rpc((p) => p.getBlockNumber()), step = C.logStep || 9000, out = [];
    for (let a = from; a <= head; a += step + 1) out.push(...(await rpc((p) => p.getLogs({ address, topics, fromBlock: a, toBlock: Math.min(head, a + step) }))));
    return out;
  }

  // ---------------------------------------------------------------- small UI helpers
  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    if (bad) t.style.borderColor = 'var(--sell)';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), bad ? 7000 : 4200);
  }
  function dialog(title, body, okLabel, danger) {
    return new Promise((res) => {
      const d = document.createElement('div');
      d.className = 'ad-dlg';
      d.innerHTML = `<div role="dialog" aria-modal="true"><h2>${esc(title)}</h2>${body}<div class="ad-end"><button class="btn s" data-x>Cancel</button><button class="btn s ${danger ? 'redfill' : 'gold'}" data-ok>${esc(okLabel)}</button></div></div>`;
      const done = (v) => { d.remove(); res(v); };
      d.onclick = (e) => { if (e.target === d || e.target.closest('[data-x]')) done(null); else if (e.target.closest('[data-ok]')) done(d); };
      document.body.appendChild(d);
    });
  }
  const meta = {}; // token address (lower case) -> { sym, dec }
  for (const [sym, [a, dec]] of Object.entries(C.tokens)) meta[a.toLowerCase()] = { sym, dec };
  const sym = (a) => (meta[a.toLowerCase()] || {}).sym || short(a);
  const dec = (a) => (meta[a.toLowerCase()] || {}).dec ?? 18;
  function fmt(v, d = 18, max = 4) {
    const n = Number(E.formatUnits(v ?? 0n, d));
    if (n === 0) return '0';
    if (Math.abs(n) < 10 ** -max) return '<' + (10 ** -max).toFixed(max); // dust
    return n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : max });
  }
  const amt = (v, token) => `${fmt(v, dec(token))} ${esc(sym(token))}`;
  const hms = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + 'h ' : '') + m + 'm ' + String(s % 60).padStart(2, '0') + 's'; };
  // tickers for the stock tokens, from the site's own list (their on-chain symbols carry an issuer suffix)
  const friendly = {};
  const stocksReady = fetch('/stocks.json').then((r) => r.json()).then((list) => { for (const [s, , , a] of list) friendly[String(a).toLowerCase()] = s; }).catch(() => {});
  /** Learns the symbol and decimals of tokens not seen yet. A token that cannot be read is shown by its address. */
  async function learnTokens(addrs) {
    await stocksReady;
    const need = [...new Set(addrs.filter((a) => a && !meta[a.toLowerCase()]).map((a) => a.toLowerCase()))];
    if (!need.length) return;
    let r;
    try { r = await multi(need.flatMap((a) => [[a, 'erc20', 'symbol'], [a, 'erc20', 'decimals']])); }
    catch {
      // one unreadable token can sink the whole batch: read them one by one instead
      r = (await Promise.allSettled(need.flatMap((a) => [rpc((p) => new E.Contract(a, ABI.erc20, p).symbol()), rpc((p) => new E.Contract(a, ABI.erc20, p).decimals())]))).map((x) => (x.status === 'fulfilled' ? x.value : null));
    }
    need.forEach((a, i) => { meta[a] = { sym: friendly[a] || r[i * 2] || short(a), dec: r[i * 2 + 1] == null ? 18 : Number(r[i * 2 + 1]) }; });
  }

  // ---------------------------------------------------------------- wallet
  // Reown AppKit (LB_CFG.walletConnect.projectId) is the wallet modal: installed browser wallets, WalletConnect QR and
  // mobile wallets. Its bundle (wc/appkit.js and chunks) loads only when someone connects. Without a project id, or
  // with localStorage 'wallet-ui' = 'basic' (a test hook), the browser's own wallet (window.ethereum) is used.
  const WC_ID = (C.walletConnect || {}).projectId || '';
  const basicUi = () => { try { return localStorage.getItem('wallet-ui') === 'basic'; } catch { return false; } };
  let signer = null, me = null, kit = null, kitP = null, waiting = null;
  async function adopt(provider) {
    let bp = new E.BrowserProvider(provider);
    if (Number((await bp.getNetwork()).chainId) !== C.chainId) {
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + C.chainId.toString(16) }] });
      bp = new E.BrowserProvider(provider);
    }
    signer = await bp.getSigner();
    me = await signer.getAddress();
    await refresh();
  }
  function drop() { signer = null; me = null; refresh(); }
  function appKit() {
    if (kitP) return kitP;
    kitP = (async () => {
      await import('/wc/appkit.js?v=1');
      const { createAppKit, EthersAdapter } = window.KinexAppKit;
      const net = { id: C.chainId, name: C.chainName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [C.rpc] } }, blockExplorers: { default: { name: 'BaseScan', url: C.explorer } } };
      kit = createAppKit({
        adapters: [new EthersAdapter()], networks: [net], defaultNetwork: net, projectId: WC_ID,
        metadata: { name: 'Lootbag', description: 'Coins that pay their holders', url: location.origin, icons: [location.origin + '/img/apple-icon.png'] },
        features: { analytics: false, email: false, socials: false, swaps: false, onramp: false, send: false, history: false },
        themeMode: 'dark', themeVariables: { '--w3m-accent': '#f4b740', '--w3m-font-family': "'Space Grotesk', system-ui, sans-serif", '--w3m-border-radius-master': '2px' },
      });
      let last = '';
      kit.subscribeAccount(async (a) => {
        const addr = a && a.isConnected && a.address ? String(a.address).toLowerCase() : '';
        if (addr && addr !== last) {
          last = addr;
          const prov = kit.getWalletProvider();
          if (prov) { try { await adopt(prov); } catch (e) { toast('Could not use that wallet: ' + (e.shortMessage || e.message || e).toString().slice(0, 120), true); } }
          if (waiting) { waiting(!!signer); waiting = null; }
        }
        if (!addr && last) { last = ''; drop(); }
      });
      return kit;
    })();
    kitP.catch(() => { kitP = null; });
    return kitP;
  }
  /** Resolves true once a wallet is connected, false if the person backed out. */
  async function connect() {
    try {
      if (WC_ID && !basicUi()) {
        toast('Opening wallets…');
        const k = await appKit();
        if (signer) return true;
        const done = new Promise((res) => { waiting = res; setTimeout(() => res(!!signer), 180000); });
        await k.open();
        return await done;
      }
      if (!window.ethereum) { toast('No wallet found in this browser.', true); return false; }
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      await adopt(window.ethereum);
      return true;
    } catch (e) { toast('Could not connect: ' + (e.shortMessage || e.message || e).toString().slice(0, 120), true); return false; }
  }
  async function disconnect() {
    if (kit) { try { await kit.disconnect(); } catch { /* already gone */ } }
    drop();
  }
  /** Sends one transaction and waits for it. Returns the receipt, or null if it was not sent or failed. */
  async function send(label, target, abiName, fn, args, quiet) {
    if (!LIVE) { toast('Preview: the contracts are not deployed yet. Nothing was sent.'); return null; }
    if (!signer && !(await connect())) return null;
    try {
      const c = new E.Contract(target, ABI[abiName], signer);
      toast(label + ': confirm in your wallet');
      const tx = await c[fn](...args);
      toast(label + ': sent, waiting for it to confirm');
      const r = await tx.wait();
      if (!r || r.status !== 1) throw new Error('the transaction reverted');
      toast(label + ': done');
      if (!quiet) await refresh();
      return r;
    } catch (e) {
      toast(label + ' failed: ' + (e.shortMessage || e.reason || e.message || e).toString().slice(0, 160), true);
      return null;
    }
  }
  const simulate = (target, abiName, fn, args) => rpc((p) => new E.Contract(target, ABI[abiName], p)[fn].staticCall(...args, { from: me }));

  // ---------------------------------------------------------------- state
  let S = null;
  function previewState() {
    const q = Object.entries(C.tokens).map(([s, [a]]) => ({ token: a, listed: true, tick: null, minDevBuy: null, claims: 0n, owed: 0n, owedHolders: 0n }));
    return {
      owners: Object.keys(NAMES).map((k) => ({ key: k, addr: null, owner: C.owner, pending: null })),
      paused: true, treasury: C.owner, quotes: q, rewards: Object.values(C.tokens).map(([a]) => a), coins: [],
      bags: { minted: 0n, pot: 0n, today: C.tokens.VVV[0], lastDrop: 0n, days: [C.tokens.VVV[0]], keeper: false, loot: E.ZeroAddress },
      airdrop: { pot: 0n, rounds: 0n, nextAt: 0n, keeper: false }, payoutKeeper: false, now: Math.floor(Date.now() / 1000),
    };
  }
  async function load() {
    if (!LIVE) return previewState();
    const keys = Object.keys(NAMES), who = me || E.ZeroAddress;
    // Pairs and rewards: asked of the factory for every token the site knows (the three in the config and its stock
    // list), which costs two calls instead of a scan of every listing event. Launches still come from the log.
    await stocksReady;
    const known = [...new Set([...Object.values(C.tokens).map(([a]) => a.toLowerCase()), ...Object.keys(friendly)])].map((a) => E.getAddress(a));
    const listing = await multi(known.flatMap((t) => [[K.factory, 'factory', 'quotes', [t]], [K.factory, 'factory', 'rewardListed', [t]]]));
    const quoteTokens = known.filter((t, i) => listing[i * 2] && listing[i * 2].listed);
    const rewardTokens = known.filter((t, i) => listing[i * 2 + 1] === true);
    const coins = [];
    for (const l of await logs(K.factory, [I.factory.getEvent('Launched').topicHash], C.startBlock || 0)) {
      let p; try { p = I.factory.parseLog(l); } catch { p = null; }
      if (p && p.name === 'Launched') coins.push({ addr: p.args.coin, creator: p.args.creator, quote: p.args.quote, name: p.args.name, symbol: p.args.symbol, rewards: [...p.args.rewards], block: l.blockNumber });
    }
    await learnTokens([...quoteTokens, ...coins.flatMap((c) => [c.quote, ...c.rewards])]);
    for (const c of coins) meta[c.addr.toLowerCase()] = { sym: c.symbol, dec: 18 };
    const calls = [
      ...keys.flatMap((k) => [[K[k], 'own', 'owner'], [K[k], 'own', 'pendingOwner']]),
      [K.factory, 'factory', 'paused'], [K.factory, 'factory', 'treasury'],
      [K.payout, 'payout', 'keeper', [who]], [K.bags, 'bags', 'keeper', [who]], [K.airdrop, 'airdrop', 'keeper', [who]],
      [K.bags, 'bags', 'minted'], [K.bags, 'bags', 'pot'], [K.bags, 'bags', 'today'], [K.bags, 'bags', 'lastDrop'], [K.bags, 'bags', 'dayTokens'], [K.bags, 'bags', 'loot'],
      [K.airdrop, 'airdrop', 'pot'], [K.airdrop, 'airdrop', 'roundCount'], [K.airdrop, 'airdrop', 'nextRoundAt'],
      ...quoteTokens.flatMap((q) => [[K.factory, 'factory', 'quotes', [q]], [K.hook, 'hook', 'claims', [q]], [K.hook, 'hook', 'owed', [q]], [K.hook, 'hook', 'owedHolders', [q]]]),
      ...coins.flatMap((c) => [[K.payout, 'payout', 'held', [c.addr]], [K.payout, 'payout', 'currentReward', [c.addr]], [K.payout, 'payout', 'nextRoundAt', [c.addr]], [K.factory, 'factory', 'positions', [c.addr]], [K.factory, 'factory', 'copyFeeHeld', [c.addr]]]),
    ];
    const r = await multi(calls);
    let i = 0;
    const owners = keys.map((k) => ({ key: k, addr: K[k], owner: r[i++], pending: r[i++] }));
    const paused = r[i++], treasury = r[i++], payoutKeeper = !!r[i++], bagsKeeper = !!r[i++], airKeeper = !!r[i++];
    const bags = { minted: r[i++] ?? 0n, pot: r[i++] ?? 0n, today: r[i++], lastDrop: r[i++] ?? 0n, days: [...(r[i++] || [])], loot: r[i++], keeper: bagsKeeper };
    const airdrop = { pot: r[i++] ?? 0n, rounds: r[i++] ?? 0n, nextAt: r[i++] ?? 0n, keeper: airKeeper };
    const quotes = quoteTokens.map((q) => { const cfg = r[i++], claims = r[i++] ?? 0n, owed = r[i++] ?? 0n, oh = r[i++] ?? 0n; return { token: q, listed: !!(cfg && cfg.listed), tick: cfg ? Number(cfg.startTick) : null, minDevBuy: cfg ? cfg.minDevBuy : null, claims, owed, owedHolders: oh }; });
    for (const c of coins) { c.held = r[i++] ?? 0n; c.reward = r[i++]; c.nextAt = r[i++] ?? 0n; const pos = r[i++]; c.liquidity = pos ? pos.liquidity : 0n; c.copyFee = r[i++] ?? 0n; }
    await learnTokens([bags.today, ...bags.days].filter(Boolean));
    const now = (await rpc((p) => p.getBlock('latest'))).timestamp;
    return { owners, paused, treasury, quotes, rewards: rewardTokens, coins, bags, airdrop, payoutKeeper, now };
  }

  // ---------------------------------------------------------------- render
  const isOwner = () => !!me && S.owners.every((o) => eq(o.owner, me));
  const dis = (ok) => (LIVE && me && !ok ? ' disabled title="This wallet may not do that"' : '');
  function render() {
    const owner = isOwner(), anyPending = S.owners.some((o) => eq(o.pending, me));
    const openMcap = (q) => (q.tick == null ? '' : ` · opens near ${fmt(BigInt(Math.round(1.0001 ** q.tick * 1e27)), dec(q.token), 2)} ${esc(sym(q.token))} market cap`);
    // the three main pairs are shown in full; the stock pairs are folded away, and fees are listed where there are any
    const main = new Set(Object.values(C.tokens).map(([a]) => a.toLowerCase())), isMain = (q) => main.has(q.token.toLowerCase());
    const quoteRow = (q) => `<div class="ad-row"><div class="l"><b>${esc(sym(q.token))}</b> <span class="ad-pill ${q.listed ? 'ok' : 'bad'}">${q.listed ? 'pair listed' : 'off'}</span><small>${q.tick == null ? 'opening tick is set at deploy' : `tick ${q.tick}${openMcap(q)} · min dev buy ${amt(q.minDevBuy, q.token)}`}</small></div></div>`;
    const stockQuotes = S.quotes.filter((q) => !isMain(q)), feeQuotes = S.quotes.filter((q) => isMain(q) || q.claims + q.owed + q.owedHolders > 0n);
    const coinOpts = S.coins.map((c) => `<option value="${c.addr}">${esc(c.name)} ($${esc(c.symbol)})</option>`).join('');
    const banner = !LIVE
      ? `<div class="ad-banner"><b>Preview.</b> The Lootbag contracts are not deployed yet, so this page shows the deploy defaults and sends nothing. After the deploy, put the addresses from <span class="mono">deployments/lootbag-base.json</span> into <span class="mono">lb-config.js</span>.</div>`
      : !me ? `<div class="ad-banner">Connect the owner wallet ${link(C.owner)} to use the controls. Reading works without a wallet.</div>`
        : anyPending ? `<div class="ad-banner"><b>Ownership is waiting for you.</b> This wallet has been offered ownership. Use "Accept all" under Ownership.</div>`
          : !owner ? `<div class="ad-banner bad"><b>This wallet does not own the contracts.</b> Owner and keeper controls are disabled. Sweeping fees still works for anyone.</div>` : '';

    root.innerHTML = `
      <div><h1>Admin</h1><p class="ad-sub">Owner controls and hand-run rounds for the Lootbag contracts on ${esc(C.chainName)}. Nothing here runs by itself: a payout, a Bag drop or a fee split happens when you press its button.</p></div>
      ${banner}
      <div class="ad-grid">

      <section class="card ad-card">
        <div class="ad-h"><div><h2>Launches</h2><p class="ad-sub">New launches are <b>${S.paused ? 'paused' : 'open'}</b>. Pausing never affects coins that already trade.</p></div>
          <button class="ad-sw${S.paused ? '' : ' on'}" role="switch" aria-checked="${!S.paused}" aria-label="Launches open" data-act="pause"${dis(owner)}></button></div>
        ${S.quotes.filter(isMain).map(quoteRow).join('')}
        ${stockQuotes.length ? `<details style="margin-top:10px"><summary class="mute" style="cursor:pointer;font-size:13.5px">${stockQuotes.filter((q) => q.listed).length} stock pairs listed</summary>${stockQuotes.map(quoteRow).join('')}</details>` : ''}
        <details style="margin-top:10px"><summary class="mute" style="cursor:pointer;font-size:13.5px">Set or change a pair</summary>
          <div class="ad-form two">
            <div class="ad-f"><label>Pair token address</label><input class="inp mono" id="q-token" placeholder="0x…"></div>
            <div class="ad-f"><label>Token price (USD)</label><input class="inp" id="q-usd" inputmode="decimal" placeholder="27.60"></div>
            <div class="ad-f"><label>Opening market cap (USD)</label><input class="inp" id="q-mcap" inputmode="decimal" value="5000"></div>
            <div class="ad-f"><label>Minimum dev buy (in the token)</label><input class="inp" id="q-min" inputmode="decimal" placeholder="0.3"></div>
          </div>
          <p class="note" id="q-out">The opening tick is worked out from the price and the market cap.</p>
          <div class="ad-end"><button class="btn s red" data-act="quote-off"${dis(owner)}>Turn pair off</button><button class="btn s gold" data-act="quote-set"${dis(owner)}>Save pair</button></div>
        </details>
      </section>

      <section class="card ad-card">
        <div class="ad-h"><div><h2>Rewards and treasury</h2><p class="ad-sub">${S.rewards.length} reward tokens are listed. A coin's own pair is always allowed as a reward.</p></div></div>
        <div class="ad-form two">
          <div class="ad-f"><label>Reward token address</label><input class="inp mono" id="r-token" placeholder="0x…"></div>
          <div class="ad-f" style="display:flex;align-items:flex-end;gap:8px"><button class="btn s gold" data-act="reward-on"${dis(owner)}>List</button><button class="btn s red" data-act="reward-off"${dis(owner)}>Remove</button></div>
        </div>
        <p class="note">A reward also needs a route on the swapper from each pair into it, or its payout rounds cannot run.</p>
        <div class="ad-row" style="margin-top:12px"><div class="l">Treasury<small>Gets launch fees and Lootbag's 65% of trade fees</small></div><div class="r">${S.treasury ? link(S.treasury) : ''}</div></div>
        <div class="ad-form two"><div class="ad-f"><input class="inp mono" id="t-new" placeholder="New treasury 0x…" aria-label="New treasury"></div><div class="ad-f" style="display:flex;align-items:center"><button class="btn s" data-act="treasury"${dis(owner)}>Move treasury</button></div></div>
      </section>

      <section class="card ad-card wide">
        <div class="ad-h"><div><h2>Fees</h2><p class="ad-sub">Each trade's 2% waits in the pool. <b>Sweep</b> sends the holders' part to the payout contract. <b>Split</b> also divides Lootbag's part: 25% Bags, 10% airdrop pot, 65% treasury. Anyone can run these.</p></div></div>
        <div class="ad-scroll"><table class="ad-table"><thead><tr><th>Pair</th><th>Waiting in the pool</th><th>Holders' part to send</th><th>Lootbag's part to split</th><th></th></tr></thead><tbody>
        ${feeQuotes.map((q) => `<tr><td><b>${esc(sym(q.token))}</b></td><td class="mono">${fmt(q.claims, dec(q.token))}</td><td class="mono">${fmt(q.owedHolders, dec(q.token))}</td><td class="mono">${fmt(q.owed, dec(q.token))}</td>
          <td><button class="btn s" data-act="flush" data-a="${q.token}">Sweep</button> <button class="btn s gold" data-act="split" data-a="${q.token}">Split</button></td></tr>`).join('')}
        </tbody></table></div>
        ${stockQuotes.length ? `<p class="note">A stock pair appears here once it has fees waiting.</p>` : ''}
      </section>

      <section class="card ad-card wide">
        <div class="ad-h"><div><h2>Payout rounds</h2><p class="ad-sub">Pays a coin's holders what they have earned, in the coin's current reward token, straight to their wallets. Rounds change reward every 5 minutes. Holders who are not paid lose nothing: their share stays on the coin's books and they can claim it themselves.</p></div>
          <span class="ad-pill ${S.payoutKeeper ? 'ok' : 'warn'}">${S.payoutKeeper ? 'this wallet is a keeper' : 'keeper wallet needed'}</span></div>
        ${S.coins.length ? `<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Coin</th><th>Held for holders</th><th>This round pays</th><th>Round ends in</th><th></th></tr></thead><tbody>
        ${S.coins.map((c) => `<tr><td><b>${esc(c.name)}</b> <span class="mute">$${esc(c.symbol)}</span><br>${link(c.addr)}</td><td class="mono">${amt(c.held, c.quote)}</td><td>${c.reward ? esc(sym(c.reward)) : ''}</td><td class="mono" data-count="${c.nextAt}">${hms(Number(c.nextAt) - S.now)}</td>
          <td><button class="btn s gold" data-act="pay" data-a="${c.addr}"${dis(S.payoutKeeper)}${c.held === 0n ? ' disabled' : ''}>Pay holders</button></td></tr>`).join('')}
        </tbody></table></div>` : `<p class="mute">No coins have launched yet.</p>`}
      </section>

      <section class="card ad-card">
        <div class="ad-h"><div><h2>Bags</h2><p class="ad-sub">Once an hour: 5% of the pot buys today's token and goes equally into every Bag's vault.</p></div>
          <span class="ad-pill ${S.bags.keeper ? 'ok' : 'warn'}">${S.bags.keeper ? 'keeper' : 'keeper wallet needed'}</span></div>
        <div class="ad-row"><div class="l">Minted</div><div class="r mono">${S.bags.minted} / 1000</div></div>
        <div class="ad-row"><div class="l">In the pot</div><div class="r mono">${amt(S.bags.pot, C.tokens.VVV[0])}</div></div>
        <div class="ad-row"><div class="l">Today's token<small>Rotation: ${S.bags.days.map((d) => esc(sym(d))).join(' → ')}</small></div><div class="r"><b>${S.bags.today ? esc(sym(S.bags.today)) : ''}</b></div></div>
        <div class="ad-row"><div class="l">Next drop</div><div class="r mono" data-count="${Number(S.bags.lastDrop) + 3600}" data-ready="ready now">${Number(S.bags.lastDrop) + 3600 <= S.now ? 'ready now' : hms(Number(S.bags.lastDrop) + 3600 - S.now)}</div></div>
        <div class="ad-row"><div class="l">Minting<small>A mint burns 100,000 $LOOT and takes 3 VVV. It opens once $LOOT is set on this contract, and that can be done only once.</small></div><div class="r">${eq(S.bags.loot, E.ZeroAddress) ? (C.loot ? `<button class="btn s gold" data-act="bag-setloot"${dis(owner)}>Open the mint with $LOOT</button>` : '<span class="ad-pill warn">closed: no $LOOT yet</span>') : `<span class="ad-pill ok">open</span> <span class="mono">${short(S.bags.loot)}</span>`}</div></div>
        <div class="ad-end"><button class="btn s" data-act="bag-convert"${dis(S.bags.keeper)}>Convert fees to VVV</button><button class="btn s gold" data-act="bag-drop"${dis(S.bags.keeper || eq(S.bags.today, C.tokens.VVV[0]))}${S.bags.minted === 0n ? ' disabled title="No Bags minted yet"' : ''}>Run the drop</button></div>
      </section>

      <section class="card ad-card">
        <div class="ad-h"><div><h2>Trader airdrop</h2><p class="ad-sub">Every 10 hours the pot is shared between the top 500 traders by volume.</p></div>
          <span class="ad-pill ${S.airdrop.keeper ? 'ok' : 'warn'}">${S.airdrop.keeper ? 'keeper' : 'keeper wallet needed'}</span></div>
        <div class="ad-row"><div class="l">In the pot</div><div class="r mono">${amt(S.airdrop.pot, C.tokens.VVV[0])}</div></div>
        <div class="ad-row"><div class="l">Rounds posted</div><div class="r mono">${S.airdrop.rounds}</div></div>
        <div class="ad-row"><div class="l">Next round</div><div class="r mono">${S.airdrop.nextAt === 0n || Number(S.airdrop.nextAt) <= S.now ? 'can be posted now' : hms(Number(S.airdrop.nextAt) - S.now)}</div></div>
        <p class="note">Posting a round needs the ranked trader list worked out from every trade. That tool is not built into this page yet, so airdrop rounds cannot be run from here.</p>
      </section>

      <section class="card ad-card wide">
        <div class="ad-h"><div><h2>Coin tools</h2><p class="ad-sub">Pick a launched coin.</p></div></div>
        ${S.coins.length ? `<div class="ad-f"><label for="c-coin">Coin</label><select class="inp" id="c-coin">${coinOpts}</select></div>
        <div class="ad-form two" style="margin-top:14px">
          <div class="ad-box danger"><h3>Collect liquidity</h3><p class="ad-sub" id="c-liq"></p>
            <div class="ad-form two"><div class="ad-f"><label>Share to withdraw (%)</label><input class="inp" id="c-pct" inputmode="decimal" value="10"></div><div class="ad-f"><label>Send to</label><input class="inp mono" id="c-to" value="${esc(me || C.owner)}"></div></div>
            <div class="ad-end"><button class="btn s red" data-act="collect"${dis(owner)}>Collect</button></div></div>
          <div class="ad-box"><h3>Ticker copy fee</h3><p class="ad-sub" id="c-copy"></p>
            <div class="ad-end"><button class="btn s" data-act="copy-keep"${dis(owner)}>Keep it</button><button class="btn s gold" data-act="copy-refund"${dis(owner)}>Refund the creator</button></div></div>
        </div>` : `<p class="mute">No coins have launched yet. Collecting liquidity and settling copy fees appear here once one has.</p>`}
      </section>

      <section class="card ad-card wide">
        <div class="ad-h"><div><h2>Ownership</h2><p class="ad-sub">One owner per contract. A handover takes two steps: the owner offers, the new owner accepts.</p></div>
          ${anyPending ? `<button class="btn s gold" data-act="accept-all">Accept all</button>` : ''}</div>
        <div class="ad-scroll"><table class="ad-table"><thead><tr><th>Contract</th><th>Address</th><th>Owner</th><th>Offered to</th></tr></thead><tbody>
        ${S.owners.map((o) => `<tr><td><b>${NAMES[o.key]}</b></td><td>${o.addr ? link(o.addr) : '<span class="ad-pill warn">not deployed</span>'}</td><td>${o.owner ? link(o.owner) : ''}${eq(o.owner, me) ? ' <span class="ad-pill ok">you</span>' : ''}</td><td>${o.pending && o.pending !== E.ZeroAddress ? link(o.pending) : '<span class="dim">nobody</span>'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="ad-form two"><div class="ad-f"><label>Offer all six to</label><input class="inp mono" id="o-new" placeholder="0x…"></div><div class="ad-f" style="display:flex;align-items:flex-end"><button class="btn s" data-act="offer"${dis(owner)}>Offer ownership</button></div></div>
      </section>
      </div>`;
    coinPanel();
    $('#ad-connect').textContent = me ? short(me) : 'Connect wallet';
    $('#ad-chain').textContent = LIVE ? C.chainName : 'preview';
  }
  function coinPanel() {
    const selEl = $('#c-coin'); if (!selEl) return;
    const c = S.coins.find((x) => x.addr === selEl.value); if (!c) return;
    $('#c-liq').innerHTML = c.liquidity === 0n ? 'All of this coin\'s liquidity has already been withdrawn.' : `Removes this share of what is left of <b>${esc(c.name)}</b>'s pool liquidity and sends both sides, the unsold coins and the ${esc(sym(c.quote))} buyers paid in, to the address. It cannot be undone and it thins the pool; 100% ends trading in the pool.`;
    $('#c-copy').innerHTML = c.copyFee === 0n ? 'No copy fee is held for this coin.' : `${fmt(c.copyFee)} ETH is held. Refund it if the coin reached $70K market cap within 48 hours of launch; otherwise keep it.`;
  }
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    document.querySelectorAll('[data-count]').forEach((el) => { const left = Number(el.dataset.count) - now; el.textContent = left <= 0 && el.dataset.ready ? el.dataset.ready : hms(left); });
  }, 1000);

  async function refresh() {
    try { S = await load(); render(); } catch (e) { root.innerHTML = `<div class="ad-banner bad"><b>Could not read the contracts.</b> ${esc((e.shortMessage || e.message || e).toString().slice(0, 240))}</div>`; }
  }

  // ---------------------------------------------------------------- actions
  const val = (id) => ($(id) ? $(id).value.trim() : '');
  const quoteForm = async () => {
    const token = val('#q-token'), usd = Number(val('#q-usd')), mcap = Number(val('#q-mcap')), min = val('#q-min');
    if (!isAddr(token) || !(usd > 0) || !(mcap > 0) || !(Number(min) > 0)) { toast('Fill in the token address, its price, the market cap and the minimum dev buy.', true); return null; }
    await learnTokens([token]);
    const d = dec(token);
    const tick = Math.round(Math.log(((mcap / usd) * 10 ** d) / 1e27) / Math.log(1.0001) / TICK) * TICK;
    return { token, tick, min: E.parseUnits(min, d) };
  };
  async function payRound(coinAddr) {
    const c = S.coins.find((x) => x.addr === coinAddr);
    if (!LIVE) return send('Payout');
    if (!signer && !(await connect())) return;
    toast('Reading holders of ' + c.symbol + '…');
    const tl = await logs(c.addr, [I.token.getEvent('Transfer').topicHash], c.block);
    const seen = [...new Set(tl.map((l) => E.getAddress('0x' + l.topics[2].slice(26))))];
    const earned = await multi(seen.map((a) => [c.addr, 'token', 'earned', [a]]));
    const all = seen.map((a, i) => ({ a, e: earned[i] ?? 0n })).filter((x) => x.e > 0n).sort((x, y) => (y.e > x.e ? 1 : y.e < x.e ? -1 : 0));
    if (!all.length) return toast('Nobody is owed anything on this coin right now.');
    const total = all.reduce((s, x) => s + x.e, 0n), batches = Math.ceil(all.length / BATCH);
    const d = await dialog(`Pay ${c.symbol} holders`, `<p><b>${all.length}</b> wallet${all.length > 1 ? 's are' : ' is'} owed <b>${amt(total, c.quote)}</b> in total. This round pays in <b>${esc(sym(c.reward))}</b>${eq(c.reward, c.quote) ? '' : ', bought through the swapper'}.</p>
      <p>${batches} transaction${batches > 1 ? 's' : ''}, up to ${BATCH} wallets each.</p>
      <div class="ad-form two"><div class="ad-f"><label>Skip shares smaller than (${esc(sym(c.quote))})</label><input class="inp" id="p-min" inputmode="decimal" value="0"></div><div class="ad-f"><label>Slippage allowed (%)</label><input class="inp" id="p-slip" inputmode="decimal" value="2"></div></div>`, 'Pay now');
    if (!d) return;
    const minShare = E.parseUnits($('#p-min', d).value.trim() || '0', dec(c.quote)), slip = Math.round(Math.max(0, Math.min(50, Number($('#p-slip', d).value) || 0)) * 100);
    const list = all.filter((x) => x.e >= minShare).map((x) => x.a);
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH), label = `Payout ${Math.floor(i / BATCH) + 1}/${Math.ceil(list.length / BATCH)}`;
      // The minimum out is priced for the round's reward token, so do not start a batch as the round is about to turn.
      const left = Number(await rpc((p) => new E.Contract(K.payout, ABI.payout, p).nextRoundAt(c.addr))) - (await rpc((p) => p.getBlock('latest'))).timestamp;
      if (left < 40) { toast(`The round turns in ${left}s. Wait for the next round and press Pay holders again.`, true); break; }
      let out;
      try { out = await simulate(K.payout, 'payout', 'pay', [c.addr, batch, 0]); } catch (e) { toast(label + ' cannot run: ' + (e.shortMessage || e.reason || e.message).toString().slice(0, 140), true); break; }
      if (!(await send(label, K.payout, 'payout', 'pay', [c.addr, batch, (out * BigInt(10000 - slip)) / 10000n], true))) break;
    }
    await refresh();
  }
  const ACT = {
    pause: () => send(S.paused ? 'Open launches' : 'Pause launches', K.factory, 'factory', 'setPaused', [!S.paused]),
    'quote-set': async () => { const q = await quoteForm(); if (q) { $('#q-out').textContent = `Opening tick ${q.tick}.`; await send('Save pair', K.factory, 'factory', 'setQuote', [q.token, true, q.tick, q.min]); } },
    'quote-off': async () => { const q = await quoteForm(); if (q) await send('Turn pair off', K.factory, 'factory', 'setQuote', [q.token, false, q.tick, q.min]); },
    'reward-on': () => (isAddr(val('#r-token')) ? send('List reward', K.factory, 'factory', 'setReward', [val('#r-token'), true]) : toast('Enter the reward token address.', true)),
    'reward-off': () => (isAddr(val('#r-token')) ? send('Remove reward', K.factory, 'factory', 'setReward', [val('#r-token'), false]) : toast('Enter the reward token address.', true)),
    treasury: () => (isAddr(val('#t-new')) ? send('Move treasury', K.factory, 'factory', 'setTreasury', [val('#t-new')]) : toast('Enter the new treasury address.', true)),
    flush: (b) => send('Sweep ' + sym(b.dataset.a), K.hook, 'hook', 'flush', [b.dataset.a]),
    split: (b) => send('Split ' + sym(b.dataset.a), K.hook, 'hook', 'split', [b.dataset.a]),
    pay: (b) => payRound(b.dataset.a),
    'bag-drop': async () => {
      if (!LIVE) return send('Bag drop');
      if (!signer && !(await connect())) return;
      let out; try { out = await simulate(K.bags, 'bags', 'drop', [0]); } catch (e) { return toast('The drop cannot run: ' + (e.shortMessage || e.reason || e.message).toString().slice(0, 140), true); }
      await send('Bag drop', K.bags, 'bags', 'drop', [(out * 98n) / 100n]);
    },
    'bag-setloot': async () => {
      const d = await dialog('Open the mint', `<p>This sets $LOOT <span class="mono">${esc(C.loot)}</span> on the Bags contract. From then on anyone can mint a Bag by burning 100,000 of it and paying 3 VVV.</p><p><b>It can be done only once.</b> The Bags contract will use this $LOOT for good; it cannot be changed or undone.</p>`, 'Open the mint', true);
      if (d) await send('Open the mint', K.bags, 'bags', 'setLoot', [C.loot]);
    },
    'bag-convert': async () => {
      const d = await dialog('Convert fees to VVV', `<p>Turns fee income the Bag pot received in another token into VVV.</p><div class="ad-f" style="margin-top:12px"><label>Token to convert</label><input class="inp mono" id="b-token" value="${esc(C.tokens.WETH[0])}"></div>`, 'Convert');
      if (!d) return; const t = $('#b-token', d).value.trim(); if (!isAddr(t)) return toast('Enter a token address.', true);
      if (!LIVE) return send('Convert');
      if (!signer && !(await connect())) return;
      let out; try { out = await simulate(K.bags, 'bags', 'convert', [t, 0]); } catch (e) { return toast('Cannot convert: ' + (e.shortMessage || e.reason || e.message).toString().slice(0, 140), true); }
      if (out === 0n) return toast('The pot holds none of that token.');
      await send('Convert', K.bags, 'bags', 'convert', [t, (out * 98n) / 100n]);
    },
    collect: async () => {
      const c = S.coins.find((x) => x.addr === val('#c-coin')), pct = Number(val('#c-pct')), to = val('#c-to');
      if (!c || !(pct > 0 && pct <= 100) || !isAddr(to)) return toast('Enter a share between 0 and 100 and a recipient address.', true);
      const d = await dialog('Collect liquidity', `<p>Withdraw <b>${pct}%</b> of what is left of <b>${esc(c.name)}</b>'s liquidity and send it to <span class="mono">${short(to)}</span>.</p><p>That takes the same share of the ${esc(sym(c.quote))} buyers paid into the pool, and of the unsold coins. It cannot be undone, and holders get worse prices afterwards${pct === 100 ? '; at 100% the coin can no longer be traded in its pool' : ''}.</p>`, `Collect ${pct}%`, true);
      if (d) await send('Collect', K.factory, 'factory', 'collect', [c.addr, Math.round(pct * 100), to]);
    },
    'copy-refund': () => send('Refund copy fee', K.factory, 'factory', 'settleCopyFee', [val('#c-coin'), true]),
    'copy-keep': () => send('Keep copy fee', K.factory, 'factory', 'settleCopyFee', [val('#c-coin'), false]),
    'accept-all': async () => { for (const o of S.owners.filter((x) => eq(x.pending, me))) if (!(await send('Accept ' + NAMES[o.key], o.addr, 'own', 'acceptOwnership', [], true))) break; await refresh(); },
    offer: async () => {
      const to = val('#o-new'); if (!isAddr(to)) return toast('Enter the new owner address.', true);
      const d = await dialog('Offer ownership', `<p>Offer all six contracts to <span class="mono">${short(to)}</span>. Nothing changes until that wallet accepts each one; until then you stay the owner.</p>`, 'Offer');
      if (!d) return;
      if (!LIVE) return send('Offer');
      for (const o of S.owners) if (!(await send('Offer ' + NAMES[o.key], o.addr, 'own', 'transferOwnership', [to], true))) break;
      await refresh();
    },
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b && !b.disabled && ACT[b.dataset.act]) ACT[b.dataset.act](b); });
  root.addEventListener('change', (e) => { if (e.target.id === 'c-coin') coinPanel(); });
  $('#ad-connect').onclick = async () => {
    if (!me) return connect();
    const d = await dialog('Wallet', `<p>Connected as <span class="mono">${esc(me)}</span>.</p>`, 'Disconnect');
    if (d) disconnect();
  };
  if ((!WC_ID || basicUi()) && window.ethereum && window.ethereum.on) window.ethereum.on('accountsChanged', (a) => (a && a[0] ? adopt(window.ethereum).catch(() => {}) : drop()));
  // AppKit restores an earlier session by itself and reports it through subscribeAccount
  try { if (WC_ID && !basicUi() && Object.keys(localStorage).some((k) => /^(@appkit|wc@2|@w3m)/.test(k))) appKit().catch(() => {}); } catch { /* storage unavailable */ }

  refresh();
})();
