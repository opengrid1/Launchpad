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
  const mcI = new E.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])']);
  const ZERO = E.ZeroAddress, lc = (a) => String(a || '').toLowerCase();
  const OWNED = [['factory', 'Factory'], ['hook', 'Hook'], ['locker', 'Locker'], ['vault', 'Buyback vault']];
  const pct = (bps) => (Number(bps) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
  const hype = (wei) => Number(E.formatEther(wei || 0n)).toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' HYPE';
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

  let S = null, T = { addr: '', info: null }, busy = false;
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
    S = s;
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
  const GAS = { collect: 1500000n, sweepPoolFees: 1500000n, rescuePoolFees: 600000n, addLaunchConfig: 500000n, updateLaunchConfig: 300000n, 'claim()': 200000n };
  const me =() => (W.connected ? lc(W.address) : '');
  const isOwner = (k) => S && lc(S.owners[k].owner) === me();
  function revertText(e) {
    if (e && e.revert && e.revert.name) return `${e.revert.name}(${(e.revert.args || []).map(String).join(', ')})`;
    const d = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof d === 'string' && d.length >= 10) for (const k of Object.keys(I)) { try { const p = I[k].parseError(d); if (p) return `${p.name}(${p.args.map(String).join(', ')})`; } catch {} }
    return APP.errMsg(e);
  }
  async function send(label, k, fn, args = [], opts = {}) {
    if (!live) { APP.toast('Preview only. Contracts are not deployed yet, so nothing was sent.', 'info'); return false; }
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
  const after = async (ok) => { if (ok) { await load().catch(() => {}); if (T.addr) T.info = await loadToken(T.addr).catch(() => T.info); render(); } };

  // ---- inputs
  const val = (id) => ($('#' + id) || {}).value?.trim() || '';
  const toBps = (id, max) => { const v = Number(val(id)); if (!val(id) || !isFinite(v) || v < 0 || v * 100 > max) throw new Error(`Enter 0 to ${max / 100}%`); return Math.round(v * 100); };
  const toInt = (id, min, max) => { const v = Number(val(id)); if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Enter a whole number from ${min} to ${max}`); return v; };
  const toAddr = (id) => { const v = val(id); if (!E.isAddress(v)) throw new Error('Enter a valid address'); return E.getAddress(v); };
  const guard = (fn) => async () => { try { await fn(); } catch (e) { APP.toast(APP.errMsg(e), 'err'); } };

  // ---- render
  // every launched token (from the indexer), one click to open its tools
  function tokList() {
    const ts = window.DATA && DATA.tokens ? DATA.tokens() : [];
    if (!ts.length) return `<span class="hint">${live ? 'No tokens launched yet.' : 'Tokens appear here once the contracts are live.'}</span>`;
    return ts.slice(0, 50).map((t) => `<button class="tk${lc(T.addr) === t.addr ? ' on' : ''}" data-pick="${t.addr}"><img src="${esc(t.img)}" alt=""><span><b>${esc(t.name)}</b><i>${esc(t.symbol)} · ${APP.fmtNum(t.mcap, 1)} HYPE</i></span></button>`).join('');
  }
  const setRow = (title, now, desc, id, value, suf, act, owner = 'factory', extra = '') => `<div class="set"><div class="sl"><b>${title}</b><span><span class="now">Now ${now}.</span> ${desc}</span></div><div class="sr"><div class="ipw"><input class="inp" id="${id}" value="${esc(value)}" inputmode="decimal" autocomplete="off">${suf ? `<span class="suf">${suf}</span>` : ''}</div><button class="btn sm" data-act="${act}" ${ctl(owner)}>Save</button>${extra}</div></div>`;
  const ctl = (k) => (!live || isOwner(k) ? '' : 'disabled title="Only the owner of this contract can do this"');
  function render() {
    const m = me();
    const pendingMine = live ? OWNED.filter(([k]) => lc(S.owners[k].pending) === m && m) : [];
    const anyOwner = live && OWNED.some(([k]) => lc(S.owners[k].owner) === m);
    const allowed = !live || (m && (anyOwner || pendingMine.length || m === lc(C.admin)));
    const head = `<section class="ahd"><h1>Admin</h1><p>Owner controls for the ${esc(C.brand)} contracts on ${esc(C.chain.name)}. Every change is a transaction from the owner wallet, and the contracts check that.</p><div class="bdg">${live ? `<span class="badge ok"><i></i>Live on ${esc(C.chain.name)}</span>` : '<span class="badge warn"><i></i>Preview. Contracts not deployed yet, nothing is sent.</span>'}${m ? `<span class="badge">${esc(shortAddr(m))}${anyOwner ? ' · owner' : pendingMine.length ? ' · ownership offered' : ''}</span>` : ''}</div></section>`;
    if (!allowed) {
      root.innerHTML = head + `<div class="acard gate">${!m ? `<p>Sign in with the owner wallet to manage the contracts.</p><button class="btn pri" id="g-in">${ic('wallet')}Sign in</button>` : `<p>${esc(shortAddr(m))} does not own these contracts. Sign in with the owner wallet, ${esc(shortAddr(C.admin))}.</p>`}</div>`;
      const b = $('#g-in'); if (b) b.onclick = W.connect; return;
    }
    const s = S;
    const ownRows = OWNED.map(([k, n]) => { const o = s.owners[k]; const mineO = lc(o.owner) === m && m, mineP = lc(o.pending) === m && m; return `<div class="orow"><b>${n}</b><span class="mono">${live ? link(K[k]) : '<span class="mono">not deployed</span>'}</span><span class="c-own mono">${link(o.owner)}${mineO ? '<i class="me">you</i>' : ''}</span><span class="c-pen mono">${o.pending && o.pending !== ZERO ? link(o.pending) + (mineP ? '<i class="me">you</i>' : '') : '<span class="mono">none</span>'}</span><span class="act">${mineP || !live ? `<button class="btn sm pri" data-accept="${k}" ${!live || mineP ? '' : 'disabled'}>Accept</button>` : mineO ? '<span class="hint">Owner</span>' : ''}</span></div>`; }).join('');
    const ownership = `<section class="acard"><div class="h"><div><h2>Ownership</h2><p>Ownership moves in two steps. The current owner offers it, and the new owner accepts it here. Until you accept, the deployer stays owner.</p></div>${pendingMine.length > 1 || !live ? `<button class="btn pri sm" id="acc-all">Accept all</button>` : ''}</div><div class="own"><div class="orow h"><span>Contract</span><span>Address</span><span class="c-own">Owner</span><span class="c-pen">Offered to</span><span></span></div>${ownRows}</div></section>`;

    const launches = `<section class="acard"><div class="h"><div><h2>Launches</h2><p>What creators pay and the terms new launches start with. Changes apply to launches made after them; live pools keep their terms.</p></div></div>
      <div class="big"><div class="sl"><b><i class="dot ${s.launchEnabled ? 'on' : ''}"></i>Launches are ${s.launchEnabled ? 'on' : 'off'}</b><span>${s.launchEnabled ? 'Anyone can launch a token.' : 'Nobody can launch until you turn them on. Whitelisted wallets can still launch.'} ${live ? s.tokenCount + ' tokens launched so far.' : ''}</span></div><button class="btn ${s.launchEnabled ? 'warn' : 'pri'}" data-act="toggleLaunch" ${ctl('factory')}>${s.launchEnabled ? 'Turn off' : 'Turn on'}</button></div>
      ${setRow('Launch fee', hype(s.launchFee), 'Paid by the creator on every launch, credited to the protocol.', 'a-fee', E.formatEther(s.launchFee), 'HYPE', 'launchFee')}
      ${setRow('Max creator fee', pct(s.maxCreatorTaxBps), 'The highest creator fee a launch can pick. Up to 10%.', 'a-maxtax', s.maxCreatorTaxBps / 100, '%', 'maxTax')}
      ${setRow('Snipe tax start', pct(s.snipeStartBps), 'The tax on buys right after launch, halving 14 times. Above 20% and up to 99%, or 0 for off.', 'a-snipe', s.snipeStartBps / 100, '%', 'snipeStart')}
      ${setRow('Snipe tax window', s.snipeSeconds + ' s', 'How long the snipe tax runs after launch. 1 to 60 seconds.', 'a-snipes', s.snipeSeconds, 's', 'snipeSec')}
      <div class="sub"><b>Whitelisted launchers</b><span class="hint">A whitelisted wallet can launch while launches are off, for test launches.</span><div class="sr"><div class="ipw"><input class="inp" id="a-wl" placeholder="0x… wallet" autocomplete="off" spellcheck="false"></div><button class="btn sm" data-act="wlCheck">Check</button><button class="btn sm" data-act="wlOn" ${ctl('factory')}>Allow</button><button class="btn sm" data-act="wlOff" ${ctl('factory')}>Remove</button></div></div></section>`;

    const fees = `<section class="acard"><div class="h"><div><h2>Trading fees</h2><p>The hook's fee policy. New launches snapshot it; live pools keep the policy they launched with.</p></div></div>
      ${setRow('Pool fee', pct(s.hookFeeBps), 'Taken on every trade. Up to 10%.', 'a-hookfee', s.hookFeeBps / 100, '%', 'hookFee', 'hook')}
      ${setRow('Protocol share', pct(s.protocolShareBps), 'The protocol\'s part of the pool fee; the creator gets the rest. Up to 50%.', 'a-pshare', s.protocolShareBps / 100, '%', 'pShare', 'hook')}
      ${setRow('Buyback share', pct(s.buybackBurnBps), 'Of the creator\'s part, when the creator turns buyback on.', 'a-bb', s.buybackBurnBps / 100, '%', 'bbShare', 'hook')}
      ${setRow('Max price impact of fee swaps', pct(s.maxImpactBps), 'Caps the swap that converts token fees to HYPE.', 'a-impact', s.maxImpactBps / 100, '%', 'impact', 'hook')}
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

    const cfgRows = s.configs.map((c, n) => !c ? '' : `<div class="cfg"><b>#${n}</b><span>${APP.fmtNum(Number(E.formatEther(c.supply)))}</span><span>${APP.fmtNum(Number(E.formatEther(c.startMcap)))} HYPE</span><span class="c-x">${APP.fmtNum(Number(E.formatEther(c.band1Mcap)))} / ${APP.fmtNum(Number(E.formatEther(c.band2Mcap)))} HYPE</span><span class="c-x">${pct(c.band0Bps)} / ${pct(c.band1Bps)} / ${pct(10000 - c.band0Bps - c.band1Bps)}</span><span>${c.tickSpacing}</span><span>${c.enabled ? 'On' : 'Off'}</span><span class="act"><button class="btn sm" data-cfg="${n}" ${ctl('factory')}>${c.enabled ? 'Turn off' : 'Turn on'}</button></span></div>`).join('');
    const configs = `<section class="acard"><div class="h"><div><h2>Launch configs</h2><p>The supply and price ranges a launch seeds its three positions with. The launch form uses config #0.</p></div></div>
      <div><div class="cfg h"><span>ID</span><span>Supply</span><span>Opens at</span><span class="c-x">Band edges</span><span class="c-x">Supply split</span><span>Spacing</span><span>Status</span><span></span></div>${cfgRows}</div>
      <details class="sub"><summary class="hint" style="cursor:pointer">Add a config</summary><div class="grid4" style="margin-top:12px"><div class="fld"><label for="n-sup">Supply</label><input class="inp" id="n-sup" value="1000000000"></div><div class="fld"><label for="n-start">Opens at</label><div class="ipw"><input class="inp" id="n-start" value="50"><span class="suf">HYPE</span></div></div><div class="fld"><label for="n-b1">Band 2 from</label><div class="ipw"><input class="inp" id="n-b1" value="200"><span class="suf">HYPE</span></div></div><div class="fld"><label for="n-b2">Band 3 from</label><div class="ipw"><input class="inp" id="n-b2" value="1000"><span class="suf">HYPE</span></div></div><div class="fld"><label for="n-p0">Band 1 supply</label><div class="ipw"><input class="inp" id="n-p0" value="20"><span class="suf">%</span></div></div><div class="fld"><label for="n-p1">Band 2 supply</label><div class="ipw"><input class="inp" id="n-p1" value="30"><span class="suf">%</span></div></div><div class="fld"><label for="n-ts">Tick spacing</label><input class="inp" id="n-ts" value="200"></div></div><div class="row-end" style="margin-top:12px"><button class="btn sm" data-act="cfgAdd" ${ctl('factory')}>Add config</button></div></details></section>`;

    root.innerHTML = head + ownership + launches + fees + earnings + tokens + configs;
    bind();
  }

  function bind() {
    $$('[data-accept]', root).forEach((b) => b.onclick = guard(async () => { const k = b.dataset.accept; await after(await send('Accept ' + k, k, 'acceptOwnership')); }));
    const aa = $('#acc-all'); if (aa) aa.onclick = guard(async () => { if (!live) return send('Accept all'); for (const [k] of OWNED) if (lc(S.owners[k].pending) === me()) { if (!(await send('Accept ' + k, k, 'acceptOwnership'))) break; } await after(true); });
    $$('[data-cfg]', root).forEach((b) => b.onclick = guard(async () => { const n = Number(b.dataset.cfg), c = S.configs[n]; await after(await send((c.enabled ? 'Turn off' : 'Turn on') + ' config #' + n, 'factory', 'updateLaunchConfig', [n, { ...c, enabled: !c.enabled }])); }));
    const A = {
      toggleLaunch: () => send(S.launchEnabled ? 'Turn launches off' : 'Turn launches on', 'factory', 'setLaunchEnabled', [!S.launchEnabled]),
      launchFee: () => { const v = val('a-fee'); if (!v || !(Number(v) >= 0)) throw new Error('Enter a fee in HYPE'); return send('Launch fee', 'factory', 'setLaunchFee', [E.parseEther(v)]); },
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
  function confirmCollect(bps, rec) {
    return new Promise((done) => {
      const ov = APP.dialog('Collect liquidity', `<div style="display:flex;flex-direction:column;gap:16px"><p style="font-size:15px;line-height:20px;color:var(--ink-80)">Remove ${pct(bps)} of the locked liquidity of ${esc(shortAddr(T.addr))} and send the HYPE and tokens to ${esc(shortAddr(rec))}. This cannot be undone and it moves the price.</p><div class="row-end"><button class="btn sm" data-x>Cancel</button><button class="btn sm warn" id="c-go">Collect</button></div></div>`);
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-x]')) done(false); });
      $('#c-go', ov).onclick = async () => { ov.remove(); done(await send('Collect liquidity', 'locker', 'collect', [T.addr, bps, rec])); };
    });
  }

  root.innerHTML = '<div class="empty">Loading…</div>';
  try { await load(); } catch (e) { root.innerHTML = `<div class="acard gate"><p>Could not read the contracts: ${esc(APP.errMsg(e))}</p><button class="btn" onclick="location.reload()">Try again</button></div>`; return; }
  render();
  APP.onWallet(render);
  APP.onUpdate(() => { const el = $('#a-toklist'); if (el) el.innerHTML = tokList(); }); // keeps typed inputs, refreshes the list
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; guard(async () => { T.addr = ethers.getAddress(b.dataset.pick); T.info = null; render(); T.info = await loadToken(T.addr); render(); const c = $('#a-cbps'); if (c) c.scrollIntoView({ block: 'center', behavior: 'smooth' }); })(); });
};
