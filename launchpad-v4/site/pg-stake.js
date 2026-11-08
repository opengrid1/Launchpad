/* Stake: stake the platform token (CFG.stake.token), earn the protocol's fees in the quote coin. Reads the staking
   contract and the splitter through Multicall3 in one call, the flywheel history from /api/state (flywheel),
   writes through the connected wallet: approve + stake, withdraw, getReward, exit. Anyone can also trigger the
   splitter's distribute() from here. */
window.PAGE = async () => {
  const { $, $$, esc, ic, fmtNum, fmtUsd, shortAddr, toast, errMsg } = APP, C = CFG, E = ethers, ST = C.stake || {};
  const root = $('#pg-stake'), K = C.chain.contracts, MC = K.multicall || '0xcA11bde05977b3631167028862bE2a173976CA11';
  const SYM = ST.symbol || 'TOKEN', Q = C.chain.quote;
  const live = !!(ST.staking && ST.splitter && ST.token);
  const I = {
    staking: new E.Interface(['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)', 'function earned(address) view returns (uint256)', 'function rewardRate() view returns (uint256)', 'function periodFinish() view returns (uint256)', 'function duration() view returns (uint256)', 'function paused() view returns (bool)', 'function stake(uint256)', 'function withdraw(uint256)', 'function getReward()', 'function exit()', 'error Paused()', 'error ZeroAmount()']),
    splitter: new E.Interface(['function stakingBps() view returns (uint16)', 'function burnBps() view returns (uint16)', 'function pendingBuyback() view returns (uint256)', 'function treasury() view returns (address)', 'function distribute()', 'error NothingToDo()']),
    escrow: new E.Interface(['function balanceOf(address) view returns (uint256)']),
    erc20: new E.Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function totalSupply() view returns (uint256)']),
    mc: new E.Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])', 'function getEthBalance(address) view returns (uint256)']),
  };
  const W = APP.W, lc = (a) => String(a || '').toLowerCase(), DEAD = '0x000000000000000000000000000000000000dEaD';
  const f18 = (v) => Number(E.formatEther(v || 0n));
  let S = null, mode = 'stake', busy = false, flyAt = 0, fly = null, amt = '';

  async function rpc(method, params) {
    for (let i = 0; ; i++) {
      const r = await fetch(C.chain.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).catch(() => null);
      let j = null; try { j = r && r.ok ? await r.json() : null; } catch {}
      if (j && !j.error) return j.result;
      if (i >= 4) throw new Error((j && j.error && j.error.message) || 'RPC unavailable');
      await new Promise((res) => setTimeout(res, 700 * 2 ** i));
    }
  }
  async function readMany(calls) {
    const data = I.mc.encodeFunctionData('aggregate3', [calls.map(([t, k, f, a]) => [t, true, I[k].encodeFunctionData(f, a || [])])]);
    const [out] = I.mc.decodeFunctionResult('aggregate3', await rpc('eth_call', [{ to: MC, data }, 'latest']));
    return out.map(([ok, rd], n) => { if (!ok) return null; try { const r = I[calls[n][1]].decodeFunctionResult(calls[n][2], rd); return r.length === 1 ? r[0] : r; } catch { return null; } });
  }
  async function load() {
    if (!live) { S = null; return; }
    const me = W.connected ? W.address : null;
    const calls = [[ST.staking, 'staking', 'totalSupply'], [ST.staking, 'staking', 'rewardRate'], [ST.staking, 'staking', 'periodFinish'], [ST.staking, 'staking', 'duration'], [ST.staking, 'staking', 'paused'],
      [ST.splitter, 'splitter', 'stakingBps'], [ST.splitter, 'splitter', 'burnBps'], [ST.splitter, 'splitter', 'pendingBuyback'], [K.escrow || ST.splitter, 'escrow', 'balanceOf', [ST.splitter]], [MC, 'mc', 'getEthBalance', [ST.splitter]], [MC, 'mc', 'getEthBalance', [ST.staking]],
      [ST.token, 'erc20', 'balanceOf', [DEAD]], [ST.token, 'erc20', 'totalSupply']];
    if (me) calls.push([ST.staking, 'staking', 'balanceOf', [me]], [ST.staking, 'staking', 'earned', [me]], [ST.token, 'erc20', 'balanceOf', [me]], [ST.token, 'erc20', 'allowance', [me, ST.staking]]);
    const r = await readMany(calls);
    S = { total: r[0] || 0n, rate: r[1] || 0n, finish: Number(r[2] || 0n), duration: Number(r[3] || 0n), paused: !!r[4], stakingBps: Number(r[5] || 0), burnBps: Number(r[6] || 0), pendingBuyback: r[7] || 0n, owed: K.escrow ? r[8] || 0n : 0n, splitterBal: r[9] || 0n, stakingBal: r[10] || 0n, burned: r[11] || 0n, supply: r[12] || 0n,
      mine: me ? { staked: r[13] || 0n, earned: r[14] || 0n, wallet: r[15] || 0n, allowance: r[16] || 0n } : null };
  }
  async function loadFly() {
    if (Date.now() - flyAt < 15000) return; flyAt = Date.now();
    try { const j = await (await fetch('/api/state?chain=' + C.chain.key)).json(); fly = j.flywheel || null; } catch { fly = fly || null; }
  }

  // the token's price from the indexer, for USD figures and the APR
  const tokenPx = () => { const t = (window.DATA && DATA.token && ST.token) ? DATA.token(lc(ST.token)) : null; return t ? t.px || 0 : 0; }; // quote per token
  const streamLeft = () => Math.max(0, S.finish - (Date.now() / 1000));
  const yearly = () => f18(S.rate) * 365 * 86400; // quote per year at the current rate
  const apr = () => { const px = tokenPx(), staked = f18(S.total); if (!px || !staked || !S.rate || streamLeft() === 0) return null; return yearly() / (staked * px) * 100; };

  function header() {
    const t = (window.DATA && DATA.token && ST.token) ? DATA.token(lc(ST.token)) : null;
    return `<div class="sh"><div><h1>Stake $${esc(SYM)}</h1><p>Every launch fee and every protocol share of the trading fees on ${esc(C.brand)} is split on-chain: ${ST.stakingBps / 100 || 35}% streams to stakers in ${esc(Q)}, ${ST.burnBps / 100 || 35}% buys $${esc(SYM)} on its own pool and burns it, and the rest funds the treasury. Stake any time, withdraw any time.</p></div>${t ? `<a class="btn pri" href="${APP.tokenUrl(t)}">Buy $${esc(SYM)}</a>` : ''}</div>`;
  }
  function stats() {
    if (!S) return '';
    const a = apr(), px = tokenPx();
    return `<div class="stats">
      <div class="stat"><span>Total staked</span><b>${fmtNum(f18(S.total))} $${esc(SYM)}</b><small>${px ? APP.usd(f18(S.total) * px) : `${S.supply > 0n ? (Number(S.total * 10000n / S.supply) / 100).toFixed(2) : '0'}% of supply`}</small></div>
      <div class="stat"><span>APR</span><b>${a == null ? '—' : fmtNum(a, 1) + '%'}</b><small>${S.rate > 0n && streamLeft() > 0 ? `${fmtNum(f18(S.rate) * 86400, 4)} ${esc(Q)} per day` : 'no stream running'}</small></div>
      <div class="stat"><span>Streaming now</span><b>${fmtNum(f18(S.rate) * streamLeft(), 4)} ${esc(Q)}</b><small>${streamLeft() > 0 ? `${(streamLeft() / 86400).toFixed(1)} days left` : 'ended; the next distribution restarts it'}</small></div>
      <div class="stat"><span>Burned so far</span><b>${fmtNum(f18(S.burned))} $${esc(SYM)}</b><small>${S.supply > 0n ? (Number(S.burned * 10000n / S.supply) / 100).toFixed(2) : '0'}% of supply</small></div>
    </div>`;
  }
  function panel() {
    const m = S && S.mine, bal = mode === 'stake' ? (m ? m.wallet : 0n) : (m ? m.staked : 0n);
    return `<section class="card">
      <div class="seg"><button data-m="stake" class="${mode === 'stake' ? 'on' : ''}">Stake</button><button data-m="unstake" class="${mode === 'unstake' ? 'on' : ''}">Unstake</button></div>
      <div class="amt"><div class="in"><input id="s-amt" inputmode="decimal" placeholder="0" autocomplete="off" value="${esc(amt)}"><b>$${esc(SYM)}</b></div><div class="bal"><span>${mode === 'stake' ? 'In wallet' : 'Staked'}: ${fmtNum(f18(bal))}</span>${W.connected ? '<button id="s-max">Max</button>' : ''}</div></div>
      ${!W.connected ? `<button class="btn pri full" id="s-conn">${ic('wallet')}Sign in</button>` : `<button class="btn pri full" id="s-go" ${busy || (S && S.paused && mode === 'stake') ? 'disabled' : ''}>${busy ? 'Confirm in your wallet…' : S && S.paused && mode === 'stake' ? 'Staking is paused' : mode === 'stake' ? 'Stake' : 'Unstake'}</button>`}
      ${m ? `<div class="kv"><div><span>Your stake</span><b>${fmtNum(f18(m.staked))} $${esc(SYM)}</b></div><div><span>Claimable</span><b>${fmtNum(f18(m.earned), 5)} ${esc(Q)} <span class="muted">${APP.usd(f18(m.earned))}</span></b></div></div>
      <div class="row" style="gap:8px"><button class="btn full" id="s-claim" ${m.earned > 0n && !busy ? '' : 'disabled'}>Claim ${esc(Q)}</button><button class="btn full" id="s-exit" ${m.staked > 0n && !busy ? '' : 'disabled'}>Claim and unstake all</button></div>` : ''}
      <p class="hint">Rewards stream over ${S ? Math.round(S.duration / 86400) : ST.durationDays || 7} days from each distribution and accrue per second to every staker in proportion. Nothing is locked.</p>
    </section>`;
  }
  function flywheel() {
    if (!S) return '';
    const f = fly || { toStaking: 0, toBuyback: 0, toTreasury: 0, burnedQuote: 0, burnedTokens: 0, events: [] };
    const waiting = f18(S.owed) + f18(S.splitterBal) - f18(S.pendingBuyback);
    return `<section class="card"><div class="sb"><h2>The flywheel</h2><button class="btn sm" id="s-dist" ${waiting > 0 && !busy ? '' : 'disabled title="Nothing waiting to be distributed"'}>Distribute ${waiting > 0 ? fmtNum(waiting, 4) + ' ' + esc(Q) : ''}</button></div>
      <p class="hint">Protocol fees wait in the fee escrow until anyone presses Distribute. The split is set in the contract: stakers ${S.stakingBps / 100}%, buyback and burn ${S.burnBps / 100}%, treasury ${(10000 - S.stakingBps - S.burnBps) / 100}%. Buybacks are executed by the keeper with a minimum output, so nobody can pick their price.</p>
      <div class="flow"><div><span>Streamed to stakers</span><b>${fmtNum(f.toStaking, 4)} ${esc(Q)}</b><small>${APP.usd(f.toStaking)} all time</small></div><div><span>Bought back and burned</span><b>${fmtNum(f.burnedTokens)} $${esc(SYM)}</b><small>${fmtNum(f.burnedQuote, 4)} ${esc(Q)} spent · ${fmtNum(f18(S.pendingBuyback), 4)} ${esc(Q)} queued</small></div><div><span>To the treasury</span><b>${fmtNum(f.toTreasury, 4)} ${esc(Q)}</b><small>${APP.usd(f.toTreasury)} all time</small></div></div>
      ${f.events && f.events.length ? `<div class="rows fl"><div class="rh"><span>Age</span><span>Event</span><span class="ra c-x">Stakers</span><span class="ra c-x">Buyback</span><span class="ra">Treasury</span></div>${f.events.slice(0, 20).map((e) => e.kind === 'burn' ? `<div class="r"><span class="cell muted" style="text-align:left">${APP.ago(e.ts)}</span><span>Buyback and burn: ${fmtNum(e.tokens)} $${esc(SYM)} for ${fmtNum(e.quote, 4)} ${esc(Q)}</span><span class="cell c-x"></span><span class="cell c-x">${fmtNum(e.quote, 4)}</span><span class="cell"></span></div>` : `<div class="r"><span class="cell muted" style="text-align:left">${APP.ago(e.ts)}</span><span>Distribution</span><span class="cell c-x">${fmtNum(e.toStaking, 4)}</span><span class="cell c-x">${fmtNum(e.toBuyback, 4)}</span><span class="cell">${fmtNum(e.toTreasury, 4)}</span></div>`).join('')}</div>` : '<div class="empty">No distributions yet. The first one happens once fees have been swept to the escrow.</div>'}
    </section>`;
  }
  function render() {
    if (!live) { root.innerHTML = header() + `<div class="empty">Staking opens once $${esc(SYM)} is launched and the flywheel contracts are live.</div>`; return; }
    if (!S) { root.innerHTML = header() + '<div class="empty">Loading…</div>'; return; }
    root.innerHTML = header() + stats() + `<div class="two">${flywheel()}${panel()}</div>`;
    $$('[data-m]', root).forEach((b) => b.onclick = () => { mode = b.dataset.m; amt = ''; render(); });
    const ai = $('#s-amt'); if (ai) ai.oninput = () => { amt = ai.value.replace(/[^0-9.]/g, ''); };
    const conn = $('#s-conn'); if (conn) conn.onclick = W.connect;
    const mx = $('#s-max'); if (mx) mx.onclick = () => { amt = E.formatEther(mode === 'stake' ? S.mine.wallet : S.mine.staked); $('#s-amt').value = amt; };
    const go = $('#s-go'); if (go) go.onclick = () => act(mode === 'stake' ? doStake : doUnstake);
    const cl = $('#s-claim'); if (cl) cl.onclick = () => act(() => tx('Claim', ST.staking, I.staking, 'getReward', [], 150000n));
    const ex = $('#s-exit'); if (ex) ex.onclick = () => act(() => tx('Claim and unstake', ST.staking, I.staking, 'exit', [], 200000n));
    const di = $('#s-dist'); if (di) di.onclick = () => act(() => tx('Distribute', ST.splitter, I.splitter, 'distribute', [], 400000n));
  }
  const amount = () => { const v = (amt || '').trim(); if (!v || !(Number(v) > 0)) throw new Error('Enter an amount'); return E.parseEther(v); };
  async function doStake() {
    const a = amount(); if (a > S.mine.wallet) throw new Error(`You hold ${fmtNum(f18(S.mine.wallet))} $${SYM}`);
    if (S.mine.allowance < a) await tx('Approve', ST.token, I.erc20, 'approve', [ST.staking, E.MaxUint256], 80000n);
    await tx('Stake', ST.staking, I.staking, 'stake', [a], 200000n);
  }
  async function doUnstake() { const a = amount(); if (a > S.mine.staked) throw new Error(`You have ${fmtNum(f18(S.mine.staked))} $${SYM} staked`); await tx('Unstake', ST.staking, I.staking, 'withdraw', [a], 200000n); }
  async function tx(label, to, iface, fn, args, gas) {
    await W.require(); if (!W.provider) throw new Error('Connect a browser wallet to send transactions.');
    const signer = await new E.BrowserProvider(W.provider).getSigner(); const c = new E.Contract(to, iface, signer);
    try { await c[fn].staticCall(...args); } catch (e) { if (e && (e.revert || (typeof e.data === 'string' && e.data.length > 2))) throw new Error(label + ' would fail: ' + ((e.revert && e.revert.name) || errMsg(e))); }
    const t = APP.toast(label + ': confirm in your wallet', 'info', 120000);
    try { const r = await c[fn](...args, { gasLimit: gas }); t.remove(); const t2 = APP.toast(label + ': waiting for the block', 'info', 120000); await r.wait(); t2.remove(); APP.toast(label + ' done', 'ok'); }
    catch (e) { t.remove(); throw e; }
  }
  async function act(fn) { if (busy) return; busy = true; render(); try { await fn(); amt = ''; flyAt = 0; await Promise.all([load(), loadFly()]); } catch (e) { toast(errMsg(e), 'err', 7000); } busy = false; render(); }

  render();
  try { await Promise.all([load(), loadFly()]); } catch (e) { toast('Could not read the staking contracts: ' + errMsg(e), 'err'); }
  render();
  APP.onWallet(() => load().then(render).catch(() => {}));
  setInterval(() => { if (!busy && !document.hidden) Promise.all([load(), loadFly()]).then(render).catch(() => {}); }, 15000);
};
