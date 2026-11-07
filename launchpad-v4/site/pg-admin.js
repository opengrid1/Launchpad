/* Admin: owner controls for the LiquidFi contracts. Reads go through Multicall3 in one eth_call (the public RPC
   rate-limits), writes go through the connected wallet. The contracts enforce every permission; this page only hides
   controls from wallets that are not an owner. Until the addresses are in config.js it runs as a preview on the
   deploy defaults and sends nothing. */
window.PAGE = async () => {
  const { $, $$, esc, ic, shortAddr, explorer } = APP;
  const C = CFG, K = C.chain.contracts, W = APP.W, E = ethers;
  const root = $('#pg-admin');
  const live = !!(K.factory && K.hook && K.locker && K.vault && K.escrow);
  const MC = K.multicall || '0xcA11bde05977b3631167028862bE2a173976CA11';
  const I = { factory: new E.Interface(ABI.factory), hook: new E.Interface(ABI.hook), locker: new E.Interface(ABI.locker), vault: new E.Interface(ABI.vault), escrow: new E.Interface(ABI.escrow) };
  // a second generation of contracts on this chain (CFG chain.v2: factory, hook, locker): ownership and the launch switch
  const V2 = C.chain.v2 && C.chain.v2.factory ? C.chain.v2 : null;
  const OWNED2 = V2 ? [['factoryV2', 'Factory v2'], ['hookV2', 'Hook v2'], ['lockerV2', 'Locker v2'], ...(V2.margin ? [['marginV2', 'Margin (leverage)']] : [])] : [];
  if (V2) { Object.assign(K, { factoryV2: V2.factory, hookV2: V2.hook, lockerV2: V2.locker, marginV2: V2.margin || '' }); Object.assign(I, { factoryV2: new E.Interface(ABI.factoryV2 || ABI.factory), hookV2: new E.Interface(ABI.hookV2 || ABI.hook), lockerV2: V2.margin && ABI.lockerZ ? new E.Interface(ABI.lockerZ) : I.locker, marginV2: new E.Interface(ABI.marginV2 || []) }); }
  const PAIRS = V2 ? V2.pairs || [] : [];
  const pairOf = (a) => PAIRS.find((p) => String(p.addr).toLowerCase() === String(a || E.ZeroAddress).toLowerCase()) || { sym: a && a !== E.ZeroAddress ? APP.shortAddr(a) : C.chain.quote };
  const inPair = (wei, a) => Number(E.formatUnits(wei || 0n, pairOf(a).dec || 18)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + pairOf(a).sym;
  const mcI = new E.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
  const ZERO = E.ZeroAddress, lc = (a) => String(a || '').toLowerCase();
  const OWNED = [['factory', 'Factory'], ['hook', 'Hook'], ['locker', 'Locker'], ['vault', 'Buyback vault']];
  const pct = (bps) => (Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
  const hype = (wei) => Number(E.formatEther(wei || 0n)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ' + C.chain.quote;
  const tok = (wei) => APP.fmtNum(Number(E.formatEther(wei || 0n)));
  const link = (a) => a && a !== ZERO ? `<a href="${explorer('address', a)}" target="_blank" rel="noopener" title="${esc(a)}">${esc(shortAddr(a))}</a>` : '<span class="mono">none</span>';

  // ---- reads
  async function rpc(method, params) {
    for (let i = 0; ; i++) {
      const r = await fetch(C.chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).catch((e) => ({ ok: false, err: e }));
      let j = null; try { j = r.ok ? await r.json() : null; } catch {}
      const rl = !j || (j.error && /rate|limit|not ready|busy/i.test(j.error.message || ''));
      if (j && !j.error) return j.result;
      if (!rl || i >= 4) throw new Error((j && j.error && j.error.message) || 'RPC unavailable');
      await new Promise((res) => setTimeout(res, 800 * 2 ** i));
    }
  }
  // calls: [address, contract key, function, args]; returns the decoded values, null where a call failed
  async function readMany(calls) {
    if (!calls.length) return [];
    const data = mcI.encodeFunctionData('aggregate3', [calls.map(([t, k, f, a]) => [t, true, I[k].encodeFunctionData(f, a || [])])]);
    const [out] = mcI.decodeFunctionResult('aggregate3', await rpc('eth_call', [{ to: MC, data }, 'latest']));
    return out.map(([ok, rd], n) => { if (!ok) return null; try { const r = I[calls[n][1]].decodeFunctionResult(calls[n][2], rd); return r.length === 1 ? r[0] : r; } catch { return null; } });
  }

  let S = null, T = { addr: '', info: null }, T2 = { addr: '', info: null }, busy = false;
  const DEMO_DEPLOYER = '0xA0783C5658F4D6cd90D89023F9Dd2Cc54CACaF0a';
  function demoState() {
    const e = C.econ;
    return {
      owners: Object.fromEntries(OWNED.map(([k]) => [k, { owner: DEMO_DEPLOYER, pending: C.admin }])),
      launchEnabled: false, launchFee: E.parseEther(String(e.launchFeeHype)), maxCreatorTaxBps: e.creatorTaxMaxBps, snipeStartBps: e.snipeStartBps, snipeSeconds: e.snipeSeconds, tokenCount: 0,
      hookFeeBps: e.feeBps, protocolShareBps: e.protocolShareBps, buybackBurnBps: e.buybackShareBps, maxImpactBps: 500, protocolFeeRecipient: C.admin, feeSweepOperator: DEMO_DEPLOYER,
      vol: { threshold: e.volThresholdBps, window: e.volWindowSec, extra: 200, decay: e.volDecaySec },
      configs: [{ supply: E.parseEther('1000000000'), startMcap: E.parseEther('50'), band1Mcap: E.parseEther('200'), band2Mcap: E.parseEther('1000'), band0Bps: 2000, band1Bps: 3000, tickSpacing: 200, enabled: true }],
      escrowBal: 0n, escrowNative: 0n,
    };
  }
  async function load() {
    if (!live && V2) { // a chain with only the v2 contracts: ownership and the launch switch
      S = demoState(); S.v2 = await loadV2(); Object.assign(S.owners, S.v2.owners); // the v1 sections are built but not shown
      return;
    }
    if (!live) { S = demoState(); return; }
    const g = await readMany([
      ...OWNED.flatMap(([k]) => [[K[k], k, 'owner'], [K[k], k, 'pendingOwner']]),
      [K.factory, 'factory', 'launchEnabled'], [K.factory, 'factory', 'launchFee'], [K.factory, 'factory', 'maxCreatorTaxBps'], [K.factory, 'factory', 'snipeTaxStartBps'], [K.factory, 'factory', 'snipeTaxSeconds'], [K.factory, 'factory', 'launchConfigCount'], [K.factory, 'factory', 'tokenCount'],
      [K.hook, 'hook', 'hookFeeBps'], [K.hook, 'hook', 'protocolFeeShareBps'], [K.hook, 'hook', 'buybackBurnBps'], [K.hook, 'hook', 'maxInternalPriceImpactBps'], [K.hook, 'hook', 'protocolFeeRecipient'], [K.hook, 'hook', 'feeSweepOperator'],
      [K.hook, 'hook', 'volThresholdBps'], [K.hook, 'hook', 'volWindow'], [K.hook, 'hook', 'volExtraBps'], [K.hook, 'hook', 'volDecay'],
    ]);
    let i = 0; const nx = () => g[i++];
    const owners = {}; for (const [k] of OWNED) owners[k] = { owner: nx(), pending: nx() };
    const s = { owners, launchEnabled: nx(), launchFee: nx(), maxCreatorTaxBps: Number(nx()), snipeStartBps: Number(nx()), snipeSeconds: Number(nx()), configCount: Number(nx() || 0), tokenCount: Number(nx() || 0),
      hookFeeBps: Number(nx()), protocolShareBps: Number(nx()), buybackBurnBps: Number(nx()), maxImpactBps: Number(nx()), protocolFeeRecipient: nx(), feeSweepOperator: nx(),
      vol: { threshold: Number(nx()), window: Number(nx()), extra: Number(nx()), decay: Number(nx()) } };
    const ids = Array.from({ length: s.configCount }, (_, n) => n);
    const h = await readMany([...ids.map((n) => [K.factory, 'factory', 'getLaunchConfig', [n]]), [K.escrow, 'escrow', 'balanceOf', [s.protocolFeeRecipient || ZERO]]]);
    s.configs = ids.map((n) => { const r = h[n]; if (!r) return null; const c = r[0]; return { supply: c.supply, startMcap: c.startMcap, band1Mcap: c.band1Mcap, band2Mcap: c.band2Mcap, band0Bps: Number(c.band0Bps), band1Bps: Number(c.band1Bps), tickSpacing: Number(c.tickSpacing), enabled: c.enabled }; });
    s.escrowBal = h[ids.length] || 0n;
    if (V2) { s.v2 = await loadV2(); Object.assign(s.owners, s.v2.owners); }
    S = s;
  }
  // the v2 contracts: ownership, launch terms, fee policy and launch configs
  async function loadV2() {
    const F2 = K.factoryV2, H2 = K.hookV2;
    const v = await readMany([...OWNED2.flatMap(([k]) => [[K[k], k, 'owner'], [K[k], k, 'pendingOwner']]),
      [F2, 'factoryV2', 'launchEnabled'], [F2, 'factoryV2', 'launchFee'], [F2, 'factoryV2', 'maxCreatorTaxBps'], [F2, 'factoryV2', 'snipeTaxStartBps'], [F2, 'factoryV2', 'snipeTaxSeconds'], [F2, 'factoryV2', 'launchConfigCount'], [F2, 'factoryV2', 'tokenCount'],
      [H2, 'hookV2', 'hookFeeBps'], [H2, 'hookV2', 'protocolFeeShareBps'], [H2, 'hookV2', 'protocolFeeRecipient'], [H2, 'hookV2', 'volThresholdBps'], [H2, 'hookV2', 'volWindow'], [H2, 'hookV2', 'volExtraBps'], [H2, 'hookV2', 'volDecay']]);
    let j = 0; const nx = () => v[j++], num = () => Number(nx() || 0);
    const o = { owners: {} }; for (const [k] of OWNED2) o.owners[k] = { owner: nx(), pending: nx() };
    Object.assign(o, { launchEnabled: nx(), launchFee: nx() || 0n, maxCreatorTaxBps: num(), snipeStartBps: num(), snipeSeconds: num(), configCount: num(), tokenCount: num(),
      hookFeeBps: num(), protocolShareBps: num(), protocolFeeRecipient: nx(), vol: { threshold: num(), window: num(), extra: num(), decay: num() } });
    const ids = Array.from({ length: o.configCount }, (_, n) => n);
    const h = await readMany(ids.map((n) => [F2, 'factoryV2', 'getLaunchConfig', [n]]));
    if (V2.margin) {
      const Mg = K.marginV2, L = [['opensEnabled'], ['maxLeverageBps'], ['maintenanceBps'], ['initialBps'], ['liquidationDelay'], ['positionCapBps'], ['minPoolDepth'], ['minCoinAge'], ['minMargin'], ['keeperRewardBps'], ['liquidationFeeBps'], ['borrowFeeBps'], ['nextId']];
      const lv = await readMany([...L.map(([f]) => [Mg, 'marginV2', f]), [K.lockerV2, 'lockerV2', 'lendCapBps']]);
      o.lev = Object.fromEntries(L.map(([f], n) => [f, lv[n]])); o.lev.lendCapBps = lv[L.length];
    }
    o.configs = ids.map((n) => { const r = h[n]; if (!r) return null; const c = r[0]; return { pairToken: c.pairToken, supply: c.supply, startMcap: c.startMcap, band1Mcap: c.band1Mcap, band2Mcap: c.band2Mcap, band0Bps: Number(c.band0Bps), band1Bps: Number(c.band1Bps), tickSpacing: Number(c.tickSpacing), enabled: c.enabled }; });
    return o;
  }
  async function loadToken2(addr) {
    const [rec, key, locked, pos, pend] = await readMany([[K.factoryV2, 'factoryV2', 'getLaunchedToken', [addr]], [K.factoryV2, 'factoryV2', 'poolKeyOf', [addr]], [K.lockerV2, 'lockerV2', 'isLocked', [addr]], [K.lockerV2, 'lockerV2', 'positionsOf', [addr]], [K.factoryV2, 'factoryV2', 'pendingCreatorFeeRecipient', [addr]]]);
    if (!rec || !rec.exists) throw new Error('This token was not launched by the v2 factory.');
    const poolId = E.keccak256(E.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
    const [pc, pp, now] = await readMany([[K.hookV2, 'hookV2', 'pendingCreator', [poolId]], [K.hookV2, 'hookV2', 'pendingProtocol', [poolId]], [K.hookV2, 'hookV2', 'feeNow', [poolId]]]);
    return { addr, rec, poolId, pair: rec.pairToken, locked, pos: pos ? [...pos].map(String) : [], pend: pend && pend.newRecipient !== ZERO ? pend : null, pendCreator: pc || 0n, pendProtocol: pp || 0n,
      now: now ? { base: Number(now[0]), vol: Number(now[1]), snipe: Number(now[2]), tax: Number(now[3]) } : null };
  }
  async function loadToken(addr) {
    if (!live) throw new Error('Preview only. Token tools work once the contracts are deployed.');
    const [rec, key, locked, pos, pend] = await readMany([[K.factory, 'factory', 'getLaunchedToken', [addr]], [K.factory, 'factory', 'poolKeyOf', [addr]], [K.locker, 'locker', 'isLocked', [addr]], [K.locker, 'locker', 'positionsOf', [addr]], [K.factory, 'factory', 'pendingCreatorFeeRecipient', [addr]]]);
    if (!rec || !rec.exists) throw new Error('This token was not launched by the LiquidFi factory.');
    const pk = [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks];
    const poolId = E.keccak256(E.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], pk));
    const [fees0, fees1, tax0, tax1, bb0, bb1, now, vLocked, vRel, vRelable] = await readMany([
      [K.hook, 'hook', 'pendingFees', [poolId, key.currency0]], [K.hook, 'hook', 'pendingFees', [poolId, key.currency1]], [K.hook, 'hook', 'pendingCreatorTax', [poolId, key.currency0]], [K.hook, 'hook', 'pendingCreatorTax', [poolId, key.currency1]],
      [K.hook, 'hook', 'pendingBuyback', [poolId, key.currency0]], [K.hook, 'hook', 'pendingBuyback', [poolId, key.currency1]], [K.hook, 'hook', 'feeNow', [poolId]],
      [K.vault, 'vault', 'totalLocked', [addr]], [K.vault, 'vault', 'totalReleased', [addr]], [K.vault, 'vault', 'releasable', [addr]]]);
    const native0 = key.currency0 === ZERO; // HYPE is currency0 (address zero sorts first)
    return { addr, rec, poolId, locked, pos: pos ? [...pos].map(String) : [], pend: pend && pend.newRecipient !== ZERO ? pend : null,
      feesHype: native0 ? fees0 : fees1, feesTok: native0 ? fees1 : fees0, taxHype: native0 ? tax0 : tax1, taxTok: native0 ? tax1 : tax0, bbHype: native0 ? bb0 : bb1,
      now: now ? { base: Number(now[0]), vol: Number(now[1]), snipe: Number(now[2]), tax: Number(now[3]) } : null, vault: { locked: vLocked || 0n, released: vRel || 0n, releasable: vRelable || 0n } };
  }

  // ---- writes
  const GAS = { payout: 300000n, collect: 1500000n, sweepPoolFees: 1500000n, rescuePoolFees: 600000n, addLaunchConfig: 500000n, updateLaunchConfig: 300000n, 'claim()': 200000n };
  const me =() => (W.connected ? lc(W.address) : '');
  const isOwner = (k) => S && lc(S.owners[k].owner) === me();
  function revertText(e) {
    if (e && e.revert && e.revert.name) return `${e.revert.name}(${(e.revert.args || []).map(String).join(', ')})`;
    const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof d === 'string' && d.length >= 10) for (const k of Object.keys(I)) { try { const p = I[k].parseError(d); if (p) return `${p.name}(${p.args.map(String).join(', ')})`; } catch {} }
    return APP.errMsg(e);
  }
  async function send(label, k, fn, args = [], opts = {}) {
    if (!live && !(V2 && /V2$/.test(k))) { APP.toast('Preview only. Contracts are not deployed yet, so nothing was sent.', 'info'); return false; }
    if (busy) return false;
    try { await W.require(); } catch (e) { APP.toast(APP.errMsg(e), 'err'); return false; }
    if (!W.provider) { APP.toast('Connect a browser wallet to send transactions.', 'err'); return false; }
    busy = true; let t = APP.toast(label + ': confirm in your wallet', 'info', 120000);
    try {
      const signer = await new E.BrowserProvider(W.provider).getSigner();
      const c = new E.Contract(K[k], I[k], signer);
      // surface the revert reason before the wallet opens; a busy RPC (no revert data) does not block the send
      try { await c[fn].staticCall(...args, opts); } catch (e) { if (e && (e.revert || (typeof e.data === 'string' && e.data.length > 2))) throw e; }
      const tx = await c[fn](...args, { gasLimit: GAS[fn] || 400000n, ...opts }); // fixed limits: the public RPC often refuses eth_estimateGas t.remove(); t = APP.toast(label + ': waiting for the block', 'info', 120000);
      await tx.wait(); t.remove(); APP.toast(label + ' done', 'ok');
      return true;
    } catch (e) { t.remove(); APP.toast(label + ' failed: ' + revertText(e), 'err', 8000); return false; } finally { busy = false; }
  }
  const after = async (ok) => { if (ok) { await load().catch(() => {}); if (T.addr) T.info = await loadToken(T.addr).catch(() => T.info); if (T2.addr) T2.info = await loadToken2(T2.addr).catch(() => T2.info); render(); } };

  // ---- inputs
  const val = (id) => ($('#' + id) || {}).value?.trim() || '';
  const toBps = (id, max) => { const v = Number(val(id)); if (!val(id) || !isFinite(v) || v < 0 || v * 100 > max) throw new Error(`Enter 0 to ${max / 100}%`); return Math.round(v * 100); };
  const toInt = (id, min, max) => { const v = Number(val(id)); if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Enter a whole number from ${min} to ${max}`); return v; };
  const toAddr = (id) => { const v = val(id); if (!E.isAddress(v)) throw new Error('Enter a valid address'); return E.getAddress(v); };
  const guard = (fn) => async () => { try { await fn(); } catch (e) { APP.toast(APP.errMsg(e), 'err'); } };

  // ---- render
  // every launched token (from the indexer), one click to open its tools
  function tokList(gen = 1) {
    const sel = gen === 2 ? T2 : T, ts = (window.DATA && DATA.tokens ? DATA.tokens() : []).filter((t) => (t.v || 1) === gen && (!t.net || t.net === C.chain.key));
    if (!ts.length) return `<span class="hint">${live || gen === 2 ? 'No tokens launched yet.' : 'Tokens appear here once the contracts are live.'}</span>`;
    return ts.slice(0, 50).map((t) => `<button class="tk${lc(sel.addr) === t.addr ? ' on' : ''}" data-pick${gen === 2 ? '2' : ''}="${t.addr}"><img src="${esc(t.img)}" alt=""><span><b>${esc(t.name)}</b><i>${esc(t.symbol)} · ${APP.fmtNum(t.mcap, 1)} ${C.chain.quote}</i></span></button>`).join('');
  }
  const setRow = (title, now, desc, id, value, suf, act, owner = 'factory', extra = '') => `<div class="set"><div class="sl"><b>${title}</b><span><span class="now">Now ${now}.</span> ${desc}</span></div><div class="sr"><div class="ipw"><input class="inp" id="${id}" value="${esc(value)}" inputmode="decimal" autocomplete="off">${suf ? `<span class="suf">${suf}</span>` : ''}</div><button class="btn sm" data-act="${act}" ${ctl(owner)}>Save</button>${extra}</div></div>`;
  const ctl = (k) => ((!live && !(V2 && /V2$/.test(k))) || isOwner(k) ? '' : 'disabled title="Only the owner of this contract can do this"');
  function render() {
    const m = me();
    const pendingMine = live ? OWNED.filter(([k]) => lc(S.owners[k].pending) === m && m) : [];
    const anyOwner = [...(live ? OWNED : []), ...OWNED2].some(([k]) => S.owners[k] && lc(S.owners[k].owner) === m);
    const pendingV2 = V2 && S.v2 ? OWNED2.filter(([k]) => lc(S.v2.owners[k].pending) === m && m) : [];
    const v2only = !live && !!V2;
    const allowed = v2only ? !!(m && (anyOwner || pendingV2.length || m === lc(C.admin))) : !live || (m && (anyOwner || pendingMine.length || pendingV2.length || m === lc(C.admin)));
    const head = `<section class="ahd"><h1>Admin</h1><p>Owner controls for the ${esc(C.brand)} contracts on ${esc(C.chain.name)}. Every change is a transaction from the owner wallet, and the contracts check that.</p><div class="bdg"><span class="seg" id="a-net">${C.chains.map((c) => `<button type="button" data-anet="${c.key}" class="${c.key === C.chain.key ? 'on' : ''}">${esc(c.name)}</button>`).join('')}</span>${live || v2only ? `<span class="badge ok"><i></i>Live on ${esc(C.chain.name)}</span>` : '<span class="badge warn"><i></i>Preview. Contracts not deployed yet, nothing is sent.</span>'}${m ? `<span class="badge">${esc(shortAddr(m))}${anyOwner ? ' · owner' : pendingMine.length ? ' · ownership offered' : ''}</span>` : ''}</div></section>`;
    if (!allowed) {
      root.innerHTML = head + `<div class="acard gate">${!m ? `<p>Sign in with the owner wallet to manage the contracts.</p><button class="btn pri" id="g-in">${ic('wallet')}Sign in</button>` : `<p>${esc(shortAddr(m))} does not own these contracts. Sign in with the owner wallet, ${esc(shortAddr(C.admin))}.</p>`}</div>`;
      const b = $('#g-in'); if (b) b.onclick = W.connect; return;
    }
    const s = S;
    const ownRows = OWNED.map(([k, n]) => { const o = s.owners[k]; const mineO = lc(o.owner) === m && m, mineP = lc(o.pending) === m && m; return `<div class="orow"><b>${n}</b><span class="mono">${live ? link(K[k]) : '<span class="mono">not deployed</span>'}</span><span class="c-own mono">${link(o.owner)}${mineO ? '<i class="me">you</i>' : ''}</span><span class="c-pen mono">${o.pending && o.pending !== ZERO ? link(o.pending) + (mineP ? '<i class="me">you</i>' : '') : '<span class="mono">none</span>'}</span><span class="act">${mineP || !live ? `<button class="btn sm pri" data-accept="${k}" ${!live || mineP ? '' : 'disabled'}>Accept</button>` : mineO ? '<span class="hint">Owner</span>' : ''}</span></div>`; }).join('');
    const ownership = `<section class="acard"><div class="h"><div><h2>Ownership</h2><p>Ownership moves in two steps. The current owner offers it, and the new owner accepts it here. Until you accept, the deployer stays owner.</p></div>${pendingMine.length > 1 || !live ? `<button class="btn pri sm" id="acc-all">Accept all</button>` : ''}</div><div class="own"><div class="orow h"><span>Contract</span><span>Address</span><span class="c-own">Owner</span><span class="c-pen">Offered to</span><span></span></div>${ownRows}</div></section>`;

    const launches = `<section class="acard"><div class="h"><div><h2>Launches</h2><p>What creators pay and the terms new launches start with. Changes apply to launches made after them; live pools keep their terms.</p></div></div>
      <div class="big"><div class="sl"><b><i class="dot ${s.launchEnabled ? 'on' : ''}"></i>Launches are ${s.launchEnabled ? 'on' : 'off'}</b><span>${s.launchEnabled ? 'Anyone can launch a token.' : 'Nobody can launch until you turn them on. Whitelisted wallets can still launch.'} ${live ? s.tokenCount + ' tokens launched so far.' : ''}</span></div><button class="btn ${s.launchEnabled ? 'warn' : 'pri'}" data-act="toggleLaunch" ${ctl('factory')}>${s.launchEnabled ? 'Turn off' : 'Turn on'}</button></div>
      ${setRow('Launch fee', hype(s.launchFee), 'Paid by the creator on every launch, credited to the protocol.', 'a-fee', E.formatEther(s.launchFee), C.chain.quote, 'launchFee')}
      ${setRow('Max creator fee', pct(s.maxCreatorTaxBps), 'The highest creator fee a launch can pick. Up to 10%.', 'a-maxtax', s.maxCreatorTaxBps / 100, '%', 'maxTax')}
      ${setRow('Snipe tax start', pct(s.snipeStartBps), 'The tax on buys right after launch, halving 14 times. Above 20% and up to 99%, or 0 for off.', 'a-snipe', s.snipeStartBps / 100, '%', 'snipeStart')}
      ${setRow('Snipe tax window', s.snipeSeconds + ' s', 'How long the snipe tax runs after launch. 1 to 60 seconds.', 'a-snipes', s.snipeSeconds, 's', 'snipeSec')}
      <div class="sub"><b>Whitelisted launchers</b><span class="hint">A whitelisted wallet can launch while launches are off, for test launches.</span><div class="sr"><div class="ipw"><input class="inp" id="a-wl" placeholder="0x… wallet" autocomplete="off" spellcheck="false"></div><button class="btn sm" data-act="wlCheck">Check</button><button class="btn sm" data-act="wlOn" ${ctl('factory')}>Allow</button><button class="btn sm" data-act="wlOff" ${ctl('factory')}>Remove</button></div></div></section>`;

    const fees = `<section class="acard"><div class="h"><div><h2>Trading fees</h2><p>The hook's fee policy. New launches snapshot it; live pools keep the policy they launched with.</p></div></div>
      ${setRow('Pool fee', pct(s.hookFeeBps), 'Taken on every trade. Up to 10%.', 'a-hookfee', s.hookFeeBps / 100, '%', 'hookFee', 'hook')}
      ${setRow('Protocol share', pct(s.protocolShareBps), 'The protocol\'s part of the pool fee; the creator gets the rest. Up to 50%.', 'a-pshare', s.protocolShareBps / 100, '%', 'pShare', 'hook')}
      ${setRow('Buyback share', pct(s.buybackBurnBps), 'Of the creator\'s part, when the creator turns buyback on.', 'a-bb', s.buybackBurnBps / 100, '%', 'bbShare', 'hook')}
      ${setRow('Max price impact of fee swaps', pct(s.maxImpactBps), 'Caps the swap that converts token fees to ${C.chain.quote}.', 'a-impact', s.maxImpactBps / 100, '%', 'impact', 'hook')}
      <div class="sub"><b>Volatility fee</b><span class="hint">Now ${pct(s.vol.extra)} extra when the price moves ${pct(s.vol.threshold)} against the price ${s.vol.window} s earlier, fading over ${s.vol.decay} s. A zero move or zero extra turns it off.</span>
        <div class="grid4"><div class="fld"><label for="a-vt">Move</label><div class="ipw"><input class="inp" id="a-vt" value="${s.vol.threshold / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="a-vw">Reference</label><div class="ipw"><input class="inp" id="a-vw" value="${s.vol.window}"><span class="suf">s</span></div></div><div class="fld"><label for="a-ve">Extra fee</label><div class="ipw"><input class="inp" id="a-ve" value="${s.vol.extra / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="a-vd">Fades over</label><div class="ipw"><input class="inp" id="a-vd" value="${s.vol.decay}"><span class="suf">s</span></div></div></div>
        <div class="row-end"><button class="btn sm" data-act="vol" ${ctl('hook')}>Save volatility fee</button></div></div>
      ${setRow('Protocol fee recipient', esc(shortAddr(s.protocolFeeRecipient)), 'Receives the protocol share and launch fees in the fee escrow.', 'a-prec', s.protocolFeeRecipient, '', 'pRec', 'hook')}
      ${setRow('Fee sweep operator', esc(shortAddr(s.feeSweepOperator)), 'The keeper that sweeps pool fees with slippage limits.', 'a-op', s.feeSweepOperator, '', 'op', 'hook')}</section>`;

    const canClaim = live && lc(s.protocolFeeRecipient) === m;
    const earnings = `<section class="acard"><div class="h"><div><h2>Protocol earnings</h2><p>Launch fees and the protocol share wait in the fee escrow until the recipient claims them.</p></div><button class="btn pri sm" data-act="claim" ${canClaim || !live ? '' : 'disabled title="Only the protocol fee recipient can claim"'}>Claim</button></div>
      <div class="kvg"><div><span>Claimable</span><b>${hype(s.escrowBal)}</b></div><div><span>Recipient</span><b>${link(s.protocolFeeRecipient)}</b></div><div><span>Fee escrow</span><b>${live ? link(K.escrow) : 'not deployed'}</b></div></div></section>`;

    const t = T.info;
    const tokenBody = !t ? '' : `<div class="kvg">
        <div><span>Creator</span><b>${link(t.rec.creator)}</b></div><div><span>Fee recipient</span><b>${link(t.rec.creatorFeeRecipient)}</b></div><div><span>Launched</span><b>${APP.fmtDate(Number(t.rec.launchedAt))}</b></div>
        <div><span>Creator fee</span><b>${pct(t.rec.creatorTaxBps)}</b></div><div><span>Buyback</span><b>${t.rec.buybackEnabled ? 'On' : 'Off'}</b></div><div><span>Fee now</span><b>${t.now ? `${pct(t.now.base + t.now.vol)}${t.now.vol ? ' (vol ' + pct(t.now.vol) + ')' : ''}${t.now.snipe ? ', snipe ' + pct(t.now.snipe) : ''}` : 'n/a'}</b></div>
        <div><span>Unswept fees</span><b>${hype(t.feesHype)} + ${tok(t.feesTok)}</b></div><div><span>Unswept creator fee</span><b>${hype(t.taxHype)} + ${tok(t.taxTok)}</b></div><div><span>Buyback vest</span><b>${tok(t.vault.locked - t.vault.released)} locked</b></div>
        <div><span>Liquidity</span><b>${t.locked ? 'Locked, 3 positions' : 'Not locked'}</b></div><div><span>Position IDs</span><b>${esc(t.pos.join(', ') || 'none')}</b></div><div><span>Pool ID</span><b title="${t.poolId}">${esc(shortAddr(t.poolId))}</b></div></div>
      <div class="row-end"><button class="btn sm" data-act="sweep" ${live && lc(s.feeSweepOperator) === m ? '' : 'disabled title="Only the fee sweep operator or the creator can sweep"'}>Sweep fees</button><button class="btn sm" data-act="rescue" ${ctl('hook')}>Rescue fees</button>${t.rec.buybackEnabled ? `<button class="btn sm" data-act="bbOff" ${ctl('factory')}>Turn buyback off</button>` : ''}</div>
      <div class="sub"><b>Collect liquidity</b><span class="hint">Removes this share of each locked position and sends both sides to the recipient. It cannot be undone and it moves the token's price.</span><div class="grid2"><div class="fld"><label for="a-cbps">Share of liquidity</label><div class="ipw"><input class="inp" id="a-cbps" placeholder="10" inputmode="decimal"><span class="suf">%</span></div></div><div class="fld"><label for="a-crec">Recipient</label><input class="inp" id="a-crec" value="${esc(m || '')}" spellcheck="false"></div></div><div class="row-end"><button class="btn sm warn" data-act="collect" ${ctl('locker')}>Collect</button></div></div>
      <div class="sub"><b>Creator fee recipient</b><span class="hint">For a creator who lost their key. The change waits 3 days, then anyone can execute it within the next 3 days. You can cancel it meanwhile.</span>${t.pend ? `<div class="note-w">Change to ${link(t.pend.newRecipient)} proposed. It can run from ${APP.fmtDate(Number(t.pend.effectiveAt))} until ${APP.fmtDate(Number(t.pend.expiresAt))}.</div><div class="row-end"><button class="btn sm" data-act="recExec">Execute</button><button class="btn sm" data-act="recCancel" ${ctl('factory')}>Cancel</button></div>` : `<div class="sr"><div class="ipw"><input class="inp" id="a-newrec" placeholder="0x… new recipient" spellcheck="false"></div><button class="btn sm" data-act="recSet" ${ctl('factory')}>Propose</button></div>`}</div>`;
    const tokens = `<section class="acard"><div class="h"><div><h2>Token tools</h2><p>Pick a launched token, or paste its address, to collect liquidity, sweep or rescue its fees, or recover its creator fee recipient.</p></div></div>
      <div class="toklist" id="a-toklist">${tokList()}</div>
      <div class="sr"><div class="ipw"><input class="inp" id="a-tok" placeholder="0x… token address" value="${esc(T.addr)}" spellcheck="false" autocomplete="off"></div><button class="btn sm pri" data-act="tokLoad">Look up</button></div>${tokenBody}</section>`;

    const cfgRows = s.configs.map((c, n) => !c ? '' : `<div class="cfg"><b>#${n}</b><span>${APP.fmtNum(Number(E.formatEther(c.supply)))}</span><span>${APP.fmtNum(Number(E.formatEther(c.startMcap)))} ${C.chain.quote}</span><span class="c-x">${APP.fmtNum(Number(E.formatEther(c.band1Mcap)))} / ${APP.fmtNum(Number(E.formatEther(c.band2Mcap)))} ${C.chain.quote}</span><span class="c-x">${pct(c.band0Bps)} / ${pct(c.band1Bps)} / ${pct(10000 - c.band0Bps - c.band1Bps)}</span><span>${c.tickSpacing}</span><span>${c.enabled ? 'On' : 'Off'}</span><span class="act"><button class="btn sm" data-cfg="${n}" ${ctl('factory')}>${c.enabled ? 'Turn off' : 'Turn on'}</button></span></div>`).join('');
    const configs = `<section class="acard"><div class="h"><div><h2>Launch configs</h2><p>The supply and price ranges a launch seeds its three positions with. The launch form uses config #0.</p></div></div>
      <div><div class="cfg h"><span>ID</span><span>Supply</span><span>Opens at</span><span class="c-x">Band edges</span><span class="c-x">Supply split</span><span>Spacing</span><span>Status</span><span></span></div>${cfgRows}</div>
      <details class="sub"><summary class="hint" style="cursor:pointer">Add a config</summary><div class="grid4" style="margin-top:12px"><div class="fld"><label for="n-sup">Supply</label><input class="inp" id="n-sup" value="1000000000"></div><div class="fld"><label for="n-start">Opens at</label><div class="ipw"><input class="inp" id="n-start" value="${C.econ.openMcapHype}"><span class="suf">${C.chain.quote}</span></div></div><div class="fld"><label for="n-b1">Band 2 from</label><div class="ipw"><input class="inp" id="n-b1" value="${C.econ.bands[1][0]}"><span class="suf">${C.chain.quote}</span></div></div><div class="fld"><label for="n-b2">Band 3 from</label><div class="ipw"><input class="inp" id="n-b2" value="${C.econ.bands[2][0]}"><span class="suf">${C.chain.quote}</span></div></div><div class="fld"><label for="n-p0">Band 1 supply</label><div class="ipw"><input class="inp" id="n-p0" value="20"><span class="suf">%</span></div></div><div class="fld"><label for="n-p1">Band 2 supply</label><div class="ipw"><input class="inp" id="n-p1" value="30"><span class="suf">%</span></div></div><div class="fld"><label for="n-ts">Tick spacing</label><input class="inp" id="n-ts" value="200"></div></div><div class="row-end" style="margin-top:12px"><button class="btn sm" data-act="cfgAdd" ${ctl('factory')}>Add config</button></div></details></section>`;

    const v2card = V2 && S.v2 ? `<section class="acard"><div class="h"><div><h2>v2 contracts</h2><p>Pairs: ${esc(PAIRS.map((p) => p.sym).join(', ') || C.chain.quote)}. Fees are paid out in the pair, straight to the creator and the protocol. ${S.v2.tokenCount} ${S.v2.tokenCount === 1 ? 'token' : 'tokens'} launched so far.</p></div>${pendingV2.length > 1 ? '<button class="btn sm pri" id="acc-v2">Accept all</button>' : ''}</div>
      <div class="own"><div class="orow h"><span>Contract</span><span>Address</span><span class="c-own">Owner</span><span class="c-pen">Pending owner</span><span></span></div>${OWNED2.map(([k, n]) => { const o = S.v2.owners[k]; const mineO = lc(o.owner) === m && m, mineP = lc(o.pending) === m && m; return `<div class="orow"><b>${n}</b><span class="mono">${link(K[k])}</span><span class="c-own">${link(o.owner)}${mineO ? '<span class="me">you</span>' : ''}</span><span class="c-pen">${o.pending && o.pending !== ZERO ? link(o.pending) : '<span class="mono">none</span>'}</span><span class="act">${mineP ? `<button class="btn sm pri" data-accept="${k}">Accept</button>` : mineO ? '<span class="badge ok sm">Owner</span>' : ''}</span></div>`; }).join('')}</div>
      <div class="big"><div class="sl"><b><span class="dot ${S.v2.launchEnabled ? 'on' : ''}"></span>v2 launches are ${S.v2.launchEnabled ? 'on' : 'off'}</b><span>Anyone can launch on the v2 factory while this is on.</span></div><button class="btn sm${S.v2.launchEnabled ? ' warn' : ' pri'}" data-act="toggleV2" ${ctl('factoryV2')}>${S.v2.launchEnabled ? 'Turn v2 launches off' : 'Turn v2 launches on'}</button></div></section>` : '';
    const v = S.v2, t2 = T2.info;
    const v2set = v ? `<section class="acard"><div class="h"><div><h2>v2 launch terms and fees</h2><p>New v2 launches snapshot these; live pools keep the terms they launched with. The protocol fee recipient is live for every pool.</p></div></div>
      ${setRow('Launch fee', hype(v.launchFee), 'Paid by the creator on every launch, sent to the protocol fee recipient.', 'b-fee', E.formatEther(v.launchFee), C.chain.quote, 'launchFee2', 'factoryV2')}
      ${setRow('Max creator fee', pct(v.maxCreatorTaxBps), 'The highest creator tax a launch can pick. Up to 10%.', 'b-maxtax', v.maxCreatorTaxBps / 100, '%', 'maxTax2', 'factoryV2')}
      ${setRow('Snipe tax start', pct(v.snipeStartBps), 'The tax on buys right after launch. Above the trade fee and up to 99%, or 0 for off.', 'b-snipe', v.snipeStartBps / 100, '%', 'snipeStart2', 'factoryV2')}
      ${setRow('Snipe tax window', v.snipeSeconds + ' s', 'How long the snipe tax runs after launch. 1 to 60 seconds.', 'b-snipes', v.snipeSeconds, 's', 'snipeSec2', 'factoryV2')}
      ${setRow('Pool fee', pct(v.hookFeeBps), 'Taken on every trade, in the pair. Up to 10%.', 'b-hookfee', v.hookFeeBps / 100, '%', 'hookFee2', 'hookV2')}
      ${setRow('Protocol share', pct(v.protocolShareBps), 'The protocol\'s part of the pool fee; the creator gets the rest. Up to 50%.', 'b-pshare', v.protocolShareBps / 100, '%', 'pShare2', 'hookV2')}
      <div class="sub"><b>Volatility fee</b><span class="hint">Now ${pct(v.vol.extra)} extra when the price moves ${pct(v.vol.threshold)} against the price ${v.vol.window} s earlier, fading over ${v.vol.decay} s.</span>
        <div class="grid4"><div class="fld"><label for="b-vt">Move</label><div class="ipw"><input class="inp" id="b-vt" value="${v.vol.threshold / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="b-vw">Reference</label><div class="ipw"><input class="inp" id="b-vw" value="${v.vol.window}"><span class="suf">s</span></div></div><div class="fld"><label for="b-ve">Extra fee</label><div class="ipw"><input class="inp" id="b-ve" value="${v.vol.extra / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="b-vd">Fades over</label><div class="ipw"><input class="inp" id="b-vd" value="${v.vol.decay}"><span class="suf">s</span></div></div></div>
        <div class="row-end"><button class="btn sm" data-act="vol2" ${ctl('hookV2')}>Save volatility fee</button></div></div>
      ${setRow('Protocol fee recipient', esc(shortAddr(v.protocolFeeRecipient)), 'Receives the protocol share of every pool and the launch fees.', 'b-prec', v.protocolFeeRecipient, '', 'pRec2', 'hookV2')}
      <div class="sub"><b>Whitelisted launchers</b><span class="hint">A whitelisted wallet can launch on v2 while v2 launches are off.</span><div class="sr"><div class="ipw"><input class="inp" id="b-wl" placeholder="0x… wallet" autocomplete="off" spellcheck="false"></div><button class="btn sm" data-act="wlCheck2">Check</button><button class="btn sm" data-act="wlOn2" ${ctl('factoryV2')}>Allow</button><button class="btn sm" data-act="wlOff2" ${ctl('factoryV2')}>Remove</button></div></div></section>` : '';
    const tok2Body = !t2 ? '' : `<div class="kvg">
        <div><span>Creator</span><b>${link(t2.rec.creator)}</b></div><div><span>Fee recipient</span><b>${link(t2.rec.creatorFeeRecipient)}</b></div><div><span>Launched</span><b>${APP.fmtDate(Number(t2.rec.launchedAt))}</b></div>
        <div><span>Pair</span><b>${esc(pairOf(t2.pair).sym)}</b></div><div><span>Creator tax</span><b>${pct(t2.rec.creatorTaxBps)}</b></div><div><span>Fee now</span><b>${t2.now ? `${pct(t2.now.base + t2.now.vol)}${t2.now.vol ? ' (vol ' + pct(t2.now.vol) + ')' : ''}${t2.now.snipe ? ', snipe ' + pct(t2.now.snipe) : ''}` : 'n/a'}</b></div>
        <div><span>Unpaid creator fees</span><b>${inPair(t2.pendCreator, t2.pair)}</b></div><div><span>Unpaid protocol fees</span><b>${inPair(t2.pendProtocol, t2.pair)}</b></div><div><span>Liquidity</span><b>${t2.locked ? 'Locked, 3 positions' : 'Not locked'}</b></div>
        <div><span>Position IDs</span><b>${esc(t2.pos.join(', ') || 'none')}</b></div><div><span>Pool ID</span><b title="${t2.poolId}">${esc(shortAddr(t2.poolId))}</b></div></div>
      <div class="row-end"><button class="btn sm pri" data-act="payout2" ${t2.pendCreator + t2.pendProtocol > 0n ? '' : 'disabled title="Nothing to pay out"'}>Pay out fees</button></div>
      <div class="sub"><b>Collect liquidity</b><span class="hint">Removes this share of each locked position and sends both sides to the recipient. It cannot be undone and it moves the token's price.</span><div class="grid2"><div class="fld"><label for="b-cbps">Share of liquidity</label><div class="ipw"><input class="inp" id="b-cbps" placeholder="10" inputmode="decimal"><span class="suf">%</span></div></div><div class="fld"><label for="b-crec">Recipient</label><input class="inp" id="b-crec" value="${esc(m || '')}" spellcheck="false"></div></div><div class="row-end"><button class="btn sm warn" data-act="collect2" ${ctl('lockerV2')}>Collect</button></div></div>
      <div class="sub"><b>Creator fee recipient</b><span class="hint">For a creator who lost their key. The change waits 3 days, then anyone can execute it within the next 3 days. You can cancel it meanwhile.</span>${t2.pend ? `<div class="note-w">Change to ${link(t2.pend.newRecipient)} proposed. It can run from ${APP.fmtDate(Number(t2.pend.effectiveAt))} until ${APP.fmtDate(Number(t2.pend.expiresAt))}.</div><div class="row-end"><button class="btn sm" data-act="recExec2">Execute</button><button class="btn sm" data-act="recCancel2" ${ctl('factoryV2')}>Cancel</button></div>` : `<div class="sr"><div class="ipw"><input class="inp" id="b-newrec" placeholder="0x… new recipient" spellcheck="false"></div><button class="btn sm" data-act="recSet2" ${ctl('factoryV2')}>Propose</button></div>`}</div>`;
    const v2tokens = v ? `<section class="acard"><div class="h"><div><h2>v2 token tools</h2><p>Pick a v2 token, or paste its address, to pay out its fees, collect liquidity or recover its creator fee recipient.</p></div></div>
      <div class="toklist" id="b-toklist">${tokList(2)}</div>
      <div class="sr"><div class="ipw"><input class="inp" id="b-tok" placeholder="0x… token address" value="${esc(T2.addr)}" spellcheck="false" autocomplete="off"></div><button class="btn sm pri" data-act="tokLoad2">Look up</button></div>${tok2Body}</section>` : '';
    const cfg2Rows = v ? v.configs.map((c, n) => !c ? '' : `<div class="cfg"><b>#${n}</b><span>${esc(pairOf(c.pairToken).sym)}</span><span>${inPair(c.startMcap, c.pairToken)}</span><span class="c-x">${inPair(c.band1Mcap, c.pairToken)} / ${inPair(c.band2Mcap, c.pairToken)}</span><span class="c-x">${pct(c.band0Bps)} / ${pct(c.band1Bps)} / ${pct(10000 - c.band0Bps - c.band1Bps)}</span><span>${c.tickSpacing}</span><span>${c.enabled ? 'On' : 'Off'}</span><span class="act"><button class="btn sm" data-cfg2="${n}" ${ctl('factoryV2')}>${c.enabled ? 'Turn off' : 'Turn on'}</button></span></div>`).join('') : '';
    const v2configs = v ? `<section class="acard"><div class="h"><div><h2>v2 launch configs</h2><p>One per pair: the pair, the opening market cap and the ranges a launch seeds its three positions with.</p></div></div>
      <div><div class="cfg h"><span>ID</span><span>Pair</span><span>Opens at</span><span class="c-x">Band edges</span><span class="c-x">Supply split</span><span>Spacing</span><span>Status</span><span></span></div>${cfg2Rows}</div></section>` : '';
    const lv = v && v.lev, n = (x) => Number(x || 0);
    const levCard = lv ? `<section class="acard"><div class="h"><div><h2>Leverage</h2><p>Longs on ETH-pair coins, funded by each coin's own pool: the locker lends part of the ETH in the bands the price has passed. ${n(lv.nextId) - 1} positions opened so far.</p></div></div>
      <div class="big"><div class="sl"><b><span class="dot ${lv.opensEnabled ? 'on' : ''}"></span>New positions are ${lv.opensEnabled ? 'on' : 'off'}</b><span>Closing, topping up and liquidations always work.</span></div><button class="btn sm${lv.opensEnabled ? ' warn' : ' pri'}" data-act="levToggle" ${ctl('marginV2')}>${lv.opensEnabled ? 'Turn off' : 'Turn on'}</button></div>
      ${setRow('Lend cap', pct(n(lv.lendCapBps)), 'The share of a coin\'s passed-band ETH that can be out on loan at once. Up to 50%.', 'l-cap', n(lv.lendCapBps) / 100, '%', 'levCap', 'lockerV2')}
      <div class="sub"><b>Risk</b><span class="hint">Max leverage ${n(lv.maxLeverageBps) / 1e4}x · liquidation below ${pct(n(lv.maintenanceBps))} equity · opens need ${pct(n(lv.initialBps))} · flag stands ${n(lv.liquidationDelay)} s · one position up to ${pct(n(lv.positionCapBps))} of the pool's pair · ETH-pair pools at least ${hype(lv.minPoolDepth)} (stock pairs: about 5 ETH's worth, set per stock route) · coin at least ${Math.round(n(lv.minCoinAge) / 60)} min old · margin at least ${hype(lv.minMargin)}.</span>
        <div class="grid4"><div class="fld"><label for="l-max">Max leverage</label><div class="ipw"><input class="inp" id="l-max" value="${n(lv.maxLeverageBps) / 1e4}"><span class="suf">x</span></div></div><div class="fld"><label for="l-mnt">Liquidation equity</label><div class="ipw"><input class="inp" id="l-mnt" value="${n(lv.maintenanceBps) / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="l-ini">Opening equity</label><div class="ipw"><input class="inp" id="l-ini" value="${n(lv.initialBps) / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="l-dly">Flag delay</label><div class="ipw"><input class="inp" id="l-dly" value="${n(lv.liquidationDelay)}"><span class="suf">s</span></div></div>
          <div class="fld"><label for="l-pos">Position cap</label><div class="ipw"><input class="inp" id="l-pos" value="${n(lv.positionCapBps) / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="l-dep">Min pool (ETH pairs)</label><div class="ipw"><input class="inp" id="l-dep" value="${E.formatEther(lv.minPoolDepth || 0n)}"><span class="suf">${C.chain.quote}</span></div></div><div class="fld"><label for="l-age">Min coin age</label><div class="ipw"><input class="inp" id="l-age" value="${n(lv.minCoinAge)}"><span class="suf">s</span></div></div><div class="fld"><label for="l-mm">Min margin</label><div class="ipw"><input class="inp" id="l-mm" value="${E.formatEther(lv.minMargin || 0n)}"><span class="suf">${C.chain.quote}</span></div></div></div>
        <div class="row-end"><button class="btn sm" data-act="levRisk" ${ctl('marginV2')}>Save risk</button></div></div>
      <div class="sub"><b>Fees</b><span class="hint">A one-time ${pct(n(lv.borrowFeeBps))} borrow fee at open and a ${pct(n(lv.liquidationFeeBps))} liquidation penalty, both paid back into the coin's pool; no running interest. The liquidator gets ${pct(n(lv.keeperRewardBps))} of the sale.</span>
        <div class="grid4"><div class="fld"><label for="l-apr">Borrow fee</label><div class="ipw"><input class="inp" id="l-apr" value="${n(lv.borrowFeeBps) / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="l-lf">Liquidation penalty</label><div class="ipw"><input class="inp" id="l-lf" value="${n(lv.liquidationFeeBps) / 100}"><span class="suf">%</span></div></div><div class="fld"><label for="l-kr">Keeper reward</label><div class="ipw"><input class="inp" id="l-kr" value="${n(lv.keeperRewardBps) / 100}"><span class="suf">%</span></div></div></div>
        <div class="row-end"><button class="btn sm" data-act="levFees" ${ctl('marginV2')}>Save fees</button></div></div></section>` : '';
    const v2all = v2card + levCard + v2tokens + v2set + v2configs;
    root.innerHTML = v2only ? head + v2all : head + v2all + ownership + launches + fees + earnings + tokens + configs;
    bind();
  }

  function bind() {
    $$('[data-anet]', root).forEach((b) => b.onclick = () => { if (b.dataset.anet === C.chain.key) return; C.useChain(b.dataset.anet); location.reload(); }); // each chain has its own contracts
    $$('[data-accept]', root).forEach((b) => b.onclick = guard(async () => { const k = b.dataset.accept; await after(await send('Accept ' + k, k, 'acceptOwnership')); }));
    const aa = $('#acc-all'); if (aa) aa.onclick = guard(async () => { if (!live) return send('Accept all'); for (const [k] of OWNED) if (lc(S.owners[k].pending) === me()) { if (!(await send('Accept ' + k, k, 'acceptOwnership'))) break; } await after(true); });
    $$('[data-cfg]', root).forEach((b) => b.onclick = guard(async () => { const n = Number(b.dataset.cfg), c = S.configs[n]; await after(await send((c.enabled ? 'Turn off' : 'Turn on') + ' config #' + n, 'factory', 'updateLaunchConfig', [n, { ...c, enabled: !c.enabled }])); }));
    $$('[data-cfg2]', root).forEach((b) => b.onclick = guard(async () => { const n = Number(b.dataset.cfg2), c = S.v2.configs[n]; await after(await send((c.enabled ? 'Turn off' : 'Turn on') + ' v2 config #' + n, 'factoryV2', 'updateLaunchConfig', [n, { ...c, enabled: !c.enabled }])); }));
    const av2 = $('#acc-v2'); if (av2) av2.onclick = guard(async () => { for (const [k] of OWNED2) if (lc(S.v2.owners[k].pending) === me()) { if (!(await send('Accept ' + k, k, 'acceptOwnership'))) break; } await after(true); });
    const A = {
      toggleV2: () => send(S.v2.launchEnabled ? 'Turn v2 launches off' : 'Turn v2 launches on', 'factoryV2', 'setLaunchEnabled', [!S.v2.launchEnabled]),
      levToggle: () => send(S.v2.lev.opensEnabled ? 'Turn leverage off' : 'Turn leverage on', 'marginV2', 'setOpensEnabled', [!S.v2.lev.opensEnabled]),
      levCap: () => send('Lend cap', 'lockerV2', 'setLendCap', [toBps('l-cap', 5000)]),
      levRisk: () => { const x = Number(val('l-max')); if (!(x > 1 && x <= 5)) throw new Error('Max leverage: above 1x, up to 5x'); return send('Leverage risk', 'marginV2', 'setRiskParams', [Math.round(x * 1e4), toBps('l-mnt', 5000), toBps('l-ini', 5000), toInt('l-dly', 1, 600), toBps('l-pos', 2000), E.parseEther(val('l-dep') || '0'), toInt('l-age', 0, 604800), E.parseEther(val('l-mm') || '0')]); },
      levFees: () => send('Leverage fees', 'marginV2', 'setFees', [toBps('l-kr', 300), toBps('l-lf', 1000), toBps('l-apr', 300)]),
      launchFee2: () => { const v = val('b-fee'); if (!v || !(Number(v) >= 0)) throw new Error('Enter a fee in ' + C.chain.quote); return send('v2 launch fee', 'factoryV2', 'setLaunchFee', [E.parseEther(v)]); },
      maxTax2: () => send('v2 max creator fee', 'factoryV2', 'setMaxCreatorTaxBps', [toBps('b-maxtax', 1000)]),
      snipeStart2: () => send('v2 snipe tax start', 'factoryV2', 'setSnipeTaxStartBps', [toBps('b-snipe', 9900)]),
      snipeSec2: () => send('v2 snipe tax window', 'factoryV2', 'setSnipeTaxSeconds', [toInt('b-snipes', 1, 60)]),
      hookFee2: () => send('v2 pool fee', 'hookV2', 'setHookFeeBps', [toBps('b-hookfee', 1000)]),
      pShare2: () => send('v2 protocol share', 'hookV2', 'setProtocolFeeShareBps', [toBps('b-pshare', 5000)]),
      vol2: () => send('v2 volatility fee', 'hookV2', 'setVolatilityTerms', [toBps('b-vt', 9999), toInt('b-vw', 1, 3600), toBps('b-ve', 1000), toInt('b-vd', 1, 3600)]),
      pRec2: () => send('v2 protocol fee recipient', 'hookV2', 'setProtocolFeeRecipient', [toAddr('b-prec')]),
      wlCheck2: async () => { const a = toAddr('b-wl'); const [w, can] = await readMany([[K.factoryV2, 'factoryV2', 'whitelistedLaunchers', [a]], [K.factoryV2, 'factoryV2', 'canLaunch', [a]]]); APP.toast(`${shortAddr(a)} is ${w ? '' : 'not '}whitelisted on v2 and ${can ? 'can' : 'cannot'} launch now.`, 'info', 5000); return false; },
      wlOn2: () => send('v2 whitelist launcher', 'factoryV2', 'setWhitelistedLauncher', [toAddr('b-wl'), true]),
      wlOff2: () => send('v2 remove launcher', 'factoryV2', 'setWhitelistedLauncher', [toAddr('b-wl'), false]),
      tokLoad2: async () => { const a = toAddr('b-tok'); T2.addr = a; T2.info = null; T2.info = await loadToken2(a); render(); return false; },
      payout2: () => send('Pay out fees', 'hookV2', 'payout', [T2.info.poolId]),
      collect2: () => { const bps = toBps('b-cbps', 10000); if (!bps) throw new Error('Enter a share above 0%'); return confirmCollect(bps, toAddr('b-crec'), 'lockerV2', T2.addr); },
      recSet2: () => send('Propose fee recipient', 'factoryV2', 'setCreatorFeeRecipient', [T2.addr, toAddr('b-newrec')]),
      recExec2: () => send('Execute recipient change', 'factoryV2', 'executeCreatorFeeRecipientChange', [T2.addr]),
      recCancel2: () => send('Cancel recipient change', 'factoryV2', 'cancelCreatorFeeRecipientChange', [T2.addr]),
      toggleLaunch: () => send(S.launchEnabled ? 'Turn launches off' : 'Turn launches on', 'factory', 'setLaunchEnabled', [!S.launchEnabled]),
      launchFee: () => { const v = val('a-fee'); if (!v || !(Number(v) >= 0)) throw new Error('Enter a fee in ' + C.chain.quote); return send('Launch fee', 'factory', 'setLaunchFee', [E.parseEther(v)]); },
      maxTax: () => send('Max creator fee', 'factory', 'setMaxCreatorTaxBps', [toBps('a-maxtax', 1000)]),
      snipeStart: () => send('Snipe tax start', 'factory', 'setSnipeTaxStartBps', [toBps('a-snipe', 9900)]),
      snipeSec: () => send('Snipe tax window', 'factory', 'setSnipeTaxSeconds', [toInt('a-snipes', 1, 60)]),
      wlCheck: async () => { const a = toAddr('a-wl'); if (!live) return APP.toast('Preview only.', 'info'); const [w, can] = await readMany([[K.factory, 'factory', 'whitelistedLaunchers', [a]], [K.factory, 'factory', 'canLaunch', [a]]]); APP.toast(`${shortAddr(a)} is ${w ? '' : 'not '}whitelisted and ${can ? 'can' : 'cannot'} launch now.`, 'info', 5000); return false; },
      wlOn: () => send('Whitelist launcher', 'factory', 'setWhitelistedLauncher', [toAddr('a-wl'), true]),
      wlOff: () => send('Remove launcher', 'factory', 'setWhitelistedLauncher', [toAddr('a-wl'), false]),
      hookFee: () => send('Pool fee', 'hook', 'setHookFeeBps', [toBps('a-hookfee', 1000)]),
      pShare: () => send('Protocol share', 'hook', 'setProtocolFeeShareBps', [toBps('a-pshare', 5000)]),
      bbShare: () => send('Buyback share', 'hook', 'setBuybackBurnBps', [toBps('a-bb', 10000)]),
      impact: () => send('Max price impact', 'hook', 'setMaxInternalPriceImpactBps', [toBps('a-impact', 10000)]),
      vol: () => send('Volatility fee', 'hook', 'setVolatilityTerms', [toBps('a-vt', 10000), toInt('a-vw', 1, 3600), toBps('a-ve', 1000), toInt('a-vd', 1, 3600)]),
      pRec: () => send('Protocol fee recipient', 'hook', 'setProtocolFeeRecipient', [toAddr('a-prec')]),
      op: () => send('Fee sweep operator', 'hook', 'setFeeSweepOperator', [toAddr('a-op')]),
      claim: () => send('Claim protocol fees', 'escrow', 'claim()'),
      tokLoad: async () => { const a = toAddr('a-tok'); T.addr = a; T.info = null; T.info = await loadToken(a); render(); return false; },
      sweep: () => send('Sweep fees', 'hook', 'sweepPoolFees', [T.info.poolId, 0, 0]),
      rescue: () => send('Rescue fees', 'hook', 'rescuePoolFees', [T.info.poolId]),
      bbOff: () => send('Turn buyback off', 'factory', 'setBuybackEnabled', [T.addr, false]),
      collect: () => { const bps = toBps('a-cbps', 10000); if (!bps) throw new Error('Enter a share above 0%'); const rec = toAddr('a-crec'); return confirmCollect(bps, rec); },
      recSet: () => send('Propose fee recipient', 'factory', 'setCreatorFeeRecipient', [T.addr, toAddr('a-newrec')]),
      recExec: () => send('Execute recipient change', 'factory', 'executeCreatorFeeRecipientChange', [T.addr]),
      recCancel: () => send('Cancel recipient change', 'factory', 'cancelCreatorFeeRecipientChange', [T.addr]),
      cfgAdd: () => {
        const sup = val('n-sup'), st = val('n-start'), b1 = val('n-b1'), b2 = val('n-b2');
        if (!(Number(st) > 0 && Number(b1) > Number(st) && Number(b2) > Number(b1))) throw new Error('Bands must rise: opens at < band 2 < band 3');
        const p0 = toBps('n-p0', 10000), p1 = toBps('n-p1', 10000); if (p0 + p1 >= 10000) throw new Error('Band 1 and band 2 must leave supply for band 3');
        return send('Add config', 'factory', 'addLaunchConfig', [{ supply: E.parseEther(sup), startMcap: E.parseEther(st), band1Mcap: E.parseEther(b1), band2Mcap: E.parseEther(b2), band0Bps: p0, band1Bps: p1, tickSpacing: toInt('n-ts', 1, 16383), enabled: true }]);
      },
    };
    $$('[data-act]', root).forEach((b) => { const f = A[b.dataset.act]; if (f) b.onclick = guard(async () => { const r = await f(); if (r) await after(r); }); });
  }
  function confirmCollect(bps, rec, k = 'locker', addr = T.addr) {
    return new Promise((done) => {
      const ov = APP.dialog('Collect liquidity', `<div style="display:flex;flex-direction:column;gap:16px"><p style="font-size:15px;line-height:20px;color:var(--ink-80)">Remove ${pct(bps)} of the locked liquidity of ${esc(shortAddr(addr))} and send the pair and the tokens to ${esc(shortAddr(rec))}. This cannot be undone and it moves the price.</p><div class="row-end"><button class="btn sm" data-x>Cancel</button><button class="btn sm warn" id="c-go">Collect</button></div></div>`);
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) done(false); });
      $('#c-go', ov).onclick = async () => { ov.remove(); done(await send('Collect liquidity', k, 'collect', [addr, bps, rec])); };
    });
  }

  root.innerHTML = '<div class="empty">Loading…</div>';
  try { await load(); } catch (e) { root.innerHTML = `<div class="acard gate"><p>Could not read the contracts: ${esc(APP.errMsg(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  render();
  APP.onWallet(render);
  APP.onUpdate(() => { const el = $('#a-toklist'); if (el) el.innerHTML = tokList(); const e2 = $('#b-toklist'); if (e2) e2.innerHTML = tokList(2); }); // keeps typed inputs, refreshes the lists
  root.addEventListener('click', (e) => { const b2 = e.target.closest('[data-pick2]'); if (b2) return guard(async () => { T2.addr = ethers.getAddress(b2.dataset.pick2); T2.info = null; render(); T2.info = await loadToken2(T2.addr); render(); const c = $('#b-cbps'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); })();
    const b = e.target.closest('[data-pick]'); if (!b) return; guard(async () => { T.addr = ethers.getAddress(b.dataset.pick); T.info = null; render(); T.info = await loadToken(T.addr); render(); const c = $('#a-cbps'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); })(); });
};
