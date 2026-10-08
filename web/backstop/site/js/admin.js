/* Admin: backing tokens on the live oracle (list USDT, Ondo stocks with Chainlink feeds, the rest
   at a set price, and price refreshes), plus the coin list. Only shown to the admin wallet. */
(function () {
  const U = () => window.UI;
  const KEY = 'bs:hidden';
  const MULTICALL = '0xcA11bde05977b3631167028862bE2a173976CA11';
  const ORACLE_ABI = ['function listed(address) view returns (bool listed, uint64 usdPrice8, address feed)', 'function sources(address) view returns (uint8 dex, address pool, address anchor, int24, uint64, bytes32, uint256, uint32, uint256, uint32)', 'function setListed(address token, bool on, uint64 usdPrice8, address feed)'];
  const MC_ABI = ['function aggregate3((address target,bool allowFailure,bytes callData)[]) view returns ((bool success,bytes returnData)[])'];
  const DRIFT = 0.02; // refresh a set price once it is 2% off
  const GAS_EACH = 52000;
  const hidden = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
  let backing = null; let state = null; let busy = false; let filter = ''; let progress = '';

  const usd8 = v => BigInt(Math.round(v * 1e8));
  const fmt = v => v >= 1000 ? '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '$' + v.toFixed(2);

  async function load() {
    if (!backing) { const r = await fetch('/backing.json', { cache: 'no-store' }); backing = r.ok ? await r.json() : null; }
    if (!backing || !window.bsEthers) return;
    const { JsonRpcProvider, Contract, Interface } = window.bsEthers; const cfg = BS.cfg;
    const p = new JsonRpcProvider(cfg.rpcs[0], 1, { staticNetwork: true });
    const oi = new Interface(ORACLE_ABI); const mc = new Contract(MULTICALL, MC_ABI, p);
    const toks = [{ symbol: 'USDT', address: backing.usdt.address, usdt: true }, ...backing.tokens];
    const calls = []; toks.forEach(t => { calls.push({ target: backing.oracle, allowFailure: true, callData: oi.encodeFunctionData('listed', [t.address]) }); calls.push({ target: backing.oracle, allowFailure: true, callData: oi.encodeFunctionData('sources', [t.address]) }); });
    const res = []; for (let i = 0; i < calls.length; i += 300) res.push(...await mc.aggregate3(calls.slice(i, i + 300)));
    state = {};
    toks.forEach((t, k) => {
      const l = res[2 * k].success ? oi.decodeFunctionResult('listed', res[2 * k].returnData) : [false, 0n, null];
      const s = res[2 * k + 1].success ? oi.decodeFunctionResult('sources', res[2 * k + 1].returnData) : [0];
      state[t.address.toLowerCase()] = { listed: l[0], price: Number(l[1]) / 1e8, feed: l[2] && l[2] !== '0x0000000000000000000000000000000000000000' ? l[2] : null, dex: Number(s[0]) };
    });
  }

  const st = t => (state && state[t.address.toLowerCase()]) || { listed: false, price: 0, feed: null, dex: 0 };
  function status(t) {
    const s = st(t);
    if (s.listed && s.feed) return ['Chainlink', 'vault'];
    if (s.listed) return ['Set price', ''];
    if (s.dex) return ['Pool price', 'vault'];
    return ['Not listed', 'sample'];
  }
  function todo() {
    const T = backing.tokens;
    return {
      usdt: st(backing.usdt).listed ? [] : [backing.usdt],
      feeds: T.filter(t => t.feed && !(st(t).listed && st(t).feed && st(t).feed.toLowerCase() === t.feed.toLowerCase())),
      prices: T.filter(t => !t.feed && t.usd && !st(t).listed && !st(t).dex),
      drift: T.filter(t => !t.feed && t.usd && st(t).listed && !st(t).feed && Math.abs(st(t).price - t.usd) / t.usd > DRIFT),
    };
  }
  const callFor = (oi, t, kind) => kind === 'usdt' ? oi.encodeFunctionData('setListed', [t.address, true, 100000000n, t.feed])
    : kind === 'feeds' ? oi.encodeFunctionData('setListed', [t.address, true, usd8(t.usd || t.feedUsd), t.feed])
    : oi.encodeFunctionData('setListed', [t.address, true, usd8(t.usd), '0x0000000000000000000000000000000000000000']);

  // EIP-5792 batches where the wallet supports them, otherwise one transaction at a time
  async function send(list, kind) {
    const { Interface } = window.bsEthers; const oi = new Interface(ORACLE_ABI); const { toast } = U();
    const signer = await bsWallet.getSigner(); if (!signer) { bsWallet.open(); return; }
    const from = await signer.getAddress(); const prov = signer.provider;
    const calls = list.map(t => ({ to: backing.oracle, data: callFor(oi, t, kind), value: '0x0' }));
    busy = true; let done = 0; const CH = 50;
    try {
      let batched = true;
      for (let i = 0; i < calls.length && batched; i += CH) {
        const part = calls.slice(i, i + CH);
        progress = `Confirm batch ${i / CH + 1} of ${Math.ceil(calls.length / CH)} in your wallet (${part.length} listings)`; paint();
        try {
          const id = await prov.send('wallet_sendCalls', [{ version: '2.0.0', chainId: '0x1', from, atomicRequired: false, calls: part }]);
          const bid = typeof id === 'string' ? id : id && id.id;
          for (let w = 0; w < 120; w++) { // up to ~6 minutes per batch
            await new Promise(r => setTimeout(r, 3000));
            let s; try { s = await prov.send('wallet_getCallsStatus', [bid]); } catch { break; }
            if (s && (s.status === 200 || s.status === 'CONFIRMED')) break;
            if (s && typeof s.status === 'number' && s.status >= 400) throw new Error('batch failed');
          }
          done += part.length;
        } catch (e) {
          if (e && (e.code === 4001 || e.code === 'ACTION_REJECTED')) throw e;
          if (done === 0) batched = false; else throw e; // wallet without batching: fall back below
        }
      }
      if (!batched) {
        for (let i = 0; i < calls.length; i++) {
          progress = `Transaction ${i + 1} of ${calls.length}: ${list[i].symbol}. Confirm in your wallet.`; paint();
          const tx = await signer.sendTransaction({ to: calls[i].to, data: calls[i].data });
          progress = `Transaction ${i + 1} of ${calls.length}: ${list[i].symbol} sent, waiting for the block`; paint();
          await tx.wait(); done++;
        }
      }
      toast(`Listed ${done} token${done === 1 ? '' : 's'}`);
    } catch (e) {
      toast(e && (e.code === 4001 || e.code === 'ACTION_REJECTED') ? `Stopped. ${done} listed before you cancelled.` : `Stopped after ${done}: ${(e && (e.shortMessage || e.message)) || 'error'}`);
    }
    busy = false; progress = 'Reading the oracle…'; paint(); await load(); progress = ''; paint();
  }

  function backingSection() {
    const { esc, addrLink, short } = U();
    if (!backing) return `<section class="panel" style="margin-bottom:18px"><div class="panel-h"><h2>Backing tokens</h2></div><div class="panel-b"><p class="faint">backing.json is missing from this build.</p></div></section>`;
    if (!state) return `<section class="panel" style="margin-bottom:18px"><div class="panel-h"><h2>Backing tokens</h2></div><div class="panel-b"><div class="skel" style="height:120px"></div></div></section>`;
    const T = backing.tokens; const td = todo();
    const n = s => T.filter(t => status(t)[0] === s).length;
    const gas = c => `about ${(c * GAS_EACH / 1e6).toFixed(1)}M gas`;
    const row = (kind, title, desc, list) => `<div class="srow" style="display:flex;align-items:center;gap:14px;padding:12px 16px;border-top:1px solid var(--line)">
        <div style="flex:1;min-width:0"><b>${title}</b><div class="faint" style="font-size:13px;margin-top:2px">${desc}</div></div>
        <button class="btn ${list.length ? 'btn-ink' : 'btn-line'}" data-act="${kind}" ${!list.length || busy ? 'disabled' : ''}>${list.length ? `List ${list.length}` : 'Done'}</button></div>`;
    const q = filter.trim().toLowerCase();
    const rows = T.filter(t => !q || t.symbol.toLowerCase().includes(q) || (t.name || '').toLowerCase().includes(q)).slice(0, q ? 80 : 30);
    return `<section class="panel" style="margin-bottom:18px">
      <div class="panel-h"><h2>Backing tokens</h2><span class="r faint" style="font-size:12.5px">Oracle <a class="addr" href="${addrLink(backing.oracle)}" target="_blank" rel="noopener">${short(backing.oracle)}</a> · prices from ${esc(backing.generatedAt.slice(0, 10))}</span></div>
      <div class="kpis" style="padding:14px 16px;margin:0"><div><span>Pool price</span><b>${n('Pool price')}</b><small>registered from Uniswap</small></div><div><span>Chainlink</span><b>${n('Chainlink')}</b><small>updates itself</small></div><div><span>Set price</span><b>${n('Set price')}</b><small>${td.drift.length} need a refresh</small></div><div><span>Not listed</span><b>${n('Not listed')}</b><small>of ${T.length} Ondo stocks</small></div></div>
      ${progress ? `<div class="notice" style="margin:0 16px 12px">${esc(progress)}</div>` : ''}
      ${row('usdt', 'USDT', 'Lists USDT at $1 with its Chainlink feed, so stocks with USDT pools can price from them.', td.usdt)}
      ${row('feeds', 'Stocks with a Chainlink feed', `${td.feeds.map(t => esc(t.symbol)).join(', ') || 'All listed'}. Listed with the feed, the price follows Chainlink. ${td.feeds.length ? gas(td.feeds.length) + '.' : ''}`, td.feeds)}
      ${row('prices', 'All other Ondo stocks', `Listed at the underlying's last price times Ondo's share multiplier. Coins backed by these trade in the stock itself (no ETH route). ${td.prices.length ? gas(td.prices.length) + ', sent in batches of 50 where your wallet supports it.' : ''}`, td.prices)}
      ${row('drift', 'Refresh set prices', `Stocks whose set price is more than ${DRIFT * 100}% off the latest price. Rebuild the site to fetch new prices, then run this.`, td.drift)}
      <div style="padding:12px 16px;border-top:1px solid var(--line)"><input class="input" id="bkq" placeholder="Search ${T.length} stocks" value="${esc(filter)}" autocomplete="off" spellcheck="false"></div>
      <div class="table-wrap" style="border:0"><table class="list"><thead><tr><th>Stock</th><th>Status</th><th>Oracle</th><th>Latest</th></tr></thead><tbody>
      ${rows.map(t => { const [label, cls] = status(t); const s = st(t); return `<tr><td><div><b>${esc(t.symbol)}</b><small class="faint" style="display:block">${esc(t.name || '')}</small></div></td><td><span class="tag ${cls}">${label}</span></td><td><span class="num">${s.listed ? (s.feed ? 'feed' : fmt(s.price)) : s.dex ? 'pool' : '–'}</span></td><td><span class="num">${t.usd ? fmt(t.usd) : t.feedUsd ? fmt(t.feedUsd) : '–'}</span></td></tr>`; }).join('')}
      </tbody></table></div>
      ${!q && T.length > 30 ? `<p class="faint" style="padding:10px 16px;font-size:12.5px">Showing 30 of ${T.length}. Search to find the rest.</p>` : ''}
    </section>`;
  }

  function paint() {
    const { esc, usd, short, addrLink, pairGlyph, $, $$, isAdmin } = U(); const cfg = BS.cfg;
    if (!isAdmin()) { $('#adm').innerHTML = `<div class="empty"><h3>Admin only</h3><p>Connect the admin wallet <span class="mono">${esc(short(cfg.admin))}</span> to see this page.</p><button class="btn btn-ink" data-wallet-open>Connect</button></div>`; const b = $('[data-wallet-open]'); if (b) b.onclick = () => window.bsWallet && bsWallet.open(); return; }
    const all = BS.tokens(); const h = hidden(); const total = all.reduce((s, x) => s + x.fees.platform, 0); const C = cfg.contracts || {};
    const focus = document.activeElement && document.activeElement.id === 'bkq' ? document.activeElement.selectionStart : null;
    $('#adm').innerHTML = `<header class="page-h"><h1>Admin</h1><p>${C.factory ? 'Contracts are live on Ethereum. The coin list below still shows the sample coins.' : 'Contracts are not deployed yet. Numbers below come from the sample coins.'}</p></header>
      <div class="kpis" style="margin-bottom:18px"><div><span>Platform fees</span><b>${usd(total)}</b><small>1% of all volume</small></div><div><span>Coins</span><b>${all.length}</b><small>${h.length} hidden</small></div><div><span>Admin</span><b style="font-size:14px"><a class="addr" href="${addrLink(cfg.admin)}" target="_blank" rel="noopener">${short(cfg.admin)}</a></b><small>Ethereum</small></div><div><span>Factory</span><b style="font-size:14px">${C.factory ? `<a class="addr" href="${addrLink(C.factory)}" target="_blank" rel="noopener">${short(C.factory)}</a>` : 'Not deployed'}</b><small>${C.factory ? 'renounced, admin kept' : 'launches closed'}</small></div></div>
      ${backingSection()}
      <section class="panel"><div class="panel-h"><h2>Coins</h2><span class="r faint" style="font-size:12.5px">Preview: listing changes are kept in this browser only</span></div><div class="table-wrap" style="border:0"><table class="list"><thead><tr><th>Coin</th><th>Platform fees</th><th>Volume 24h</th><th>Listed</th></tr></thead><tbody>
      ${all.map(x => `<tr><td><div class="coin-cell">${pairGlyph(x, 'sm')}<div><b>${esc(x.name)}</b><small>$${esc(x.symbol)}</small></div></div></td><td><span class="num">${usd(x.fees.platform)}</span></td><td><span class="num">${usd(x.vol24)}</span></td><td><button class="switch" role="switch" data-h="${x.addr}" aria-checked="${!h.includes(x.addr)}" aria-label="List ${esc(x.symbol)}" style="margin-left:auto;display:block"></button></td></tr>`).join('')}
      </tbody></table></div></section>`;
    $$('[data-h]').forEach(b => b.onclick = () => { const a = b.dataset.h; const cur = hidden(); const next = cur.includes(a) ? cur.filter(v => v !== a) : [...cur, a]; try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {} paint(); });
    $$('[data-act]').forEach(b => b.onclick = () => { if (busy) return; const td = todo(); send(td[b.dataset.act], b.dataset.act === 'drift' ? 'prices' : b.dataset.act); });
    const q = $('#bkq'); if (q) { q.oninput = () => { filter = q.value; paint(); }; if (focus !== null) { q.focus(); q.setSelectionRange(focus, focus); } }
  }

  async function start() { paint(); if (U().isAdmin()) { try { await load(); } catch (e) { progress = 'Could not read the oracle: ' + ((e && e.message) || 'error'); } paint(); } }
  window.addEventListener('DOMContentLoaded', () => BS.ready.then(start));
  window.addEventListener('bs:wallet', () => BS.ready.then(start));
})();
