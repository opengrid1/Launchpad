/* Launch form: step 1 identity, step 2 economics (pair, fee wallet, creator fee, opening buy, where fees go),
   live "On the board" preview, one transaction. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, toast, errMsg } = APP, C = CFG, E = C.econ, L = C.limits, Q = () => C.chain.quote;
  // v2 pairs (chain.v2.pairs): the native coin, or an ERC-20 such as XMR or AZTEC; PR() is the chosen one
  const PAIRS = () => (window.DATA && DATA.pairs ? DATA.pairs() : []);
  const PR = () => PAIRS().find((p) => p.key === F.pair) || null;
  const ercPair = () => !!(PR() && PR().key !== 'eth');
  const F = { image: '', name: '', symbol: '', description: '', x: '', telegram: '', website: '', chains: ['hyper'], creatorTaxBps: 0, buyback: false, devBuy: 0, feeWallet: '', creatorSol: '' };
  let busy = false;
  const setStep = (s) => { $('#st1').classList.toggle('hidden', s !== 1); $('#st2').classList.toggle('hidden', s !== 2); $('#w-h2').textContent = s === 1 ? 'Give it a name and a face.' : 'Choose what it trades against.'; $$('.steps span').forEach((x) => { const n = +x.dataset.st; x.classList.toggle('on', n === s); x.classList.toggle('ok', n < s); }); scrollTo({ top: 0, behavior: 'smooth' }); };
  // identity
  const hasLink = (s) => /(https?:\/\/|www\.|\.(com|xyz|io|net|org|fun|app|gg|me)\b|t\.me|x\.com)/i.test(s);
  const drop = $('#drop'), fi = $('#f-img');
  const readImg = (file) => { if (!file) return; if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('PNG, JPG, GIF or WEBP only', 'err'); if (file.size > L.imageMb * 1048576) return toast(`Image is over ${L.imageMb} MB`, 'err'); const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { if (Math.abs(im.width - im.height) > Math.max(im.width, im.height) * 0.05) toast('Square images look best; this one will be cropped', 'info'); F.image = r.result; drop.innerHTML = `<img src="${F.image}" alt="">`; preview(); }; im.src = r.result; }; r.readAsDataURL(file); };
  fi.onchange = () => readImg(fi.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') readImg(e.dataTransfer.files[0]); }));
  const bind = (id, key, n, max, up) => { const el = $(id); el.oninput = () => { let v = el.value; if (up) v = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (max) v = v.slice(0, max); if (up) el.value = v; F[key] = v.trim(); if (n) $(n).textContent = `${v.length}/${max}`; if (key === 'description') { const bad = hasLink(v); $('#desc-err').classList.toggle('hidden', !bad); el.classList.toggle('err', bad); } preview(); }; };
  bind('#f-name', 'name', '#n-name', L.name); bind('#f-sym', 'symbol', '#n-sym', L.ticker, true); bind('#f-desc', 'description', '#n-desc', L.desc); bind('#f-x', 'x'); bind('#f-tg', 'telegram'); bind('#f-web', 'website');
  // an idea from the Trending page: name, ticker, description and logo filled in
  try { const pf = JSON.parse(sessionStorage.getItem('prefill') || 'null'); if (pf) { sessionStorage.removeItem('prefill'); for (const [id, v] of [['#f-name', pf.name], ['#f-sym', pf.symbol], ['#f-desc', pf.description]]) { const el = $(id); if (el && v) { el.value = v; el.oninput(); } } if (pf.image && /^data:image\/(png|webp|jpeg);base64,/.test(pf.image)) { F.image = pf.image; drop.innerHTML = `<img src="${F.image}" alt="">`; } setTimeout(() => toast('Filled in from Trending. Change anything you like.', 'info'), 300); } } catch {}
  const validate = () => { if (!F.image) { toast('Add an image for the token', 'err'); $('#drop').classList.add('over'); setTimeout(() => $('#drop').classList.remove('over'), 1200); return false; } if (!F.name) { toast('Give the token a name', 'err'); $('#f-name').focus(); return false; } if (!F.symbol) { toast('Give the token a ticker', 'err'); $('#f-sym').focus(); return false; } if (hasLink(F.description)) { toast('Remove the link from the description', 'err'); return false; } if (F.website && !/^https?:\/\/.+\..+/i.test(F.website)) { toast('Check the website link', 'err'); return false; } return true; };
  $('#next').onclick = () => { if (validate()) setStep(2); };
  $('#back').onclick = () => setStep(1);
  // economics
  $('#f-tax').oninput = (e) => { let v = parseFloat(e.target.value); if (!(v >= 0)) v = 0; if (v > E.creatorTaxMaxBps / 100) { v = E.creatorTaxMaxBps / 100; e.target.value = v; } F.creatorTaxBps = Math.round(v * 100); cost(); preview(); };
  $('#f-wallet').oninput = (e) => { F.feeWallet = e.target.value.trim(); };
  const pick = (bb) => { F.buyback = bb; $('#f-fw').classList.toggle('on', !bb); $('#f-bb').classList.toggle('on', bb); preview(); };
  $('#f-fw').onclick = (e) => { e.preventDefault(); pick(false); }; $('#f-bb').onclick = (e) => { e.preventDefault(); pick(true); };
  $('#f-dev').oninput = (e) => { F.devBuy = ercPair() ? 0 : Math.max(0, parseFloat(e.target.value) || 0); cost(); };
  function cost() {
    const maxTok = E.supply * E.maxDevBuyBps / 10000;
    const net = F.devBuy * (1 - (E.feeBps + F.creatorTaxBps) / 10000), tokens = F.devBuy > 0 ? E.supply * (1 - E.openMcapHype / (E.openMcapHype + net)) : 0, over = tokens > maxTok;
    $('#dev-hint').innerHTML = F.devBuy > 0 ? `About ${fmtNum(tokens, 0)} ${esc(F.symbol || 'tokens')}, ${(tokens / E.supply * 100).toFixed(2)}% of supply.${over ? ' <span class="dn">Over the 5% cap, lower it.</span>' : ''}` : 'Optional. Buys first, in the same transaction as the launch.';
    $('#dev-hint').dataset.over = over ? '1' : '';
    const gasHype = 1_200_000 * (APP.gasGwei || 20) / 1e9; const tot = E.launchFeeHype + F.devBuy + gasHype;
    $('#c-fee').textContent = E.launchFeeHype; $('#c-dev').textContent = F.devBuy; $('#c-gas').textContent = gasHype.toFixed(5); $('#c-tot').textContent = tot.toFixed(5);
    if (ercPair()) { $('#dev-hint').textContent = 'The opening buy is available with the ETH pair. Buy right after launch instead.'; $('#dev-hint').dataset.over = ''; }
    $('#w-terms').textContent = ercPair() ? `Launch fee ${E.launchFeeHype} ${Q()}. Paired with ${PR().sym}, opens at ${fmtNum(PR().open)} ${PR().sym}. Pool fee ${(E.feeBps / 100).toFixed(1)}%, paid in ${PR().sym}.` : `Launch fee ${E.launchFeeHype} ${Q()}. Opens at ${E.openMcapHype} ${Q()}. Pool fee ${(E.feeBps / 100).toFixed(1)}%.${F.devBuy > 0 ? ` Opening buy ${F.devBuy} ${Q()}.` : ''}`;
    $('#pv-mc').textContent = `${E.openMcapHype + net > E.openMcapHype ? fmtNum((E.openMcapHype + net) ** 2 / E.openMcapHype, 1) : E.openMcapHype} ${Q()}`;
    if (ercPair()) $('#pv-mc').textContent = `${fmtNum(PR().open)} ${PR().sym}`;
    goBtn();
  }
  function goBtn() { const b = $('#go'); if (busy) return; if (!APP.W.connected) { b.textContent = 'Sign in to launch'; b.onclick = () => APP.W.connect(); return; } if (!APP.W.chainOk) { b.textContent = 'Switch to ' + C.chain.name; b.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; } b.textContent = 'Launch'; b.onclick = launch; }
  function preview() {
    $('#pv-img').src = F.image || '/img/logo.svg'; $('#pv-n').textContent = F.name || 'Your token'; $('#pv-t').innerHTML = `<span>${esc(F.symbol || 'TICKER')}</span><span class="badge">${esc(PR() ? PR().sym : Q())} pair · ${esc(C.chain.name)}</span>`; $('#pv-d').textContent = F.description || 'A line or two about the token goes here.';
    $('#pv-l').innerHTML = [['x', 'X'], ['telegram', 'Telegram'], ['website', 'Website']].filter(([k]) => F[k]).map(([, l]) => `<span class="badge">${l}</span>`).join('');
    $('#pv-fee').textContent = `${F.creatorTaxBps / 100}%${F.buyback ? ' · buyback & vest' : ''}`;
  }
  async function launch() {
    if (!validate()) return; if ($('#dev-hint').dataset.over) return toast('The opening buy is over the 5% cap', 'err');
    busy = true; const b = $('#go'); b.disabled = true; b.textContent = 'Confirm in your wallet…'; const P = $('#prog'); P.classList.add('show'); const mark = (s, cls) => { const d = P.querySelector(`[data-s="${s}"]`); d.classList.remove('on', 'ok'); d.classList.add(cls); };
    mark('sign', 'on');
    try {
      const r = await DATA.launch(F); mark('sign', 'ok'); mark('hyper', 'ok'); const gm = $('#go-msg'); gm.classList.remove('hidden'); gm.innerHTML = `Launched. <a class="ac" href="${APP.tokenUrl(r.addr)}">Open ${esc(F.symbol)}</a>`; toast(`${F.symbol} is live on ${C.chain.name}`, 'ok');
      mark('done', 'on');
      setTimeout(() => { location.href = APP.tokenUrl(r.addr); }, 1800);
    } catch (e) { toast(errMsg(e), 'err'); mark('sign', ''); busy = false; b.disabled = false; goBtn(); }
  }
  // network: which chain the token launches on (the active chain); chains not live yet show as soon
  function nets() {
    const el = $('#f-net'); if (!el) return;
    el.innerHTML = C.chains.map((c) => `<button type="button" role="radio" aria-checked="${c.key === C.chain.key}" class="${c.key === C.chain.key ? 'on' : ''}" data-net="${c.key}" ${C.live(c) ? '' : 'disabled title="Soon"'}>${esc(c.name)}${C.live(c) ? '' : ' · soon'}</button>`).join('');
    $$('[data-net]', el).forEach((b) => b.onclick = async () => { await APP.setChain(b.dataset.net); nets(); preview(); goBtn(); });
    const n = $('#net-note'); if (n) n.textContent = `The pool opens on Uniswap v4 on ${C.chain.name}, chain ${C.chain.id}. Gas and the launch fee are paid in ${Q()} on ${C.chain.name}.`;
    const pn = $('#pair-net'); if (pn) pn.textContent = C.chain.name;
  }
  nets();
  // the pair picker replaces the fixed "Paired with" field when the chain has v2 pairs
  function pairPick() {
    const ps = PAIRS(); if (!ps.length) return; if (!F.pair) F.pair = ps[0].key;
    const sel = $('#st2 .sel'), host = sel ? sel.parentElement : $('#f-pair') && $('#f-pair').parentElement; if (!host) return;
    const html = `<div class="seg lg" id="f-pair" role="radiogroup" aria-label="Pair">${ps.map((p) => `<button type="button" role="radio" aria-checked="${p.key === F.pair}" class="${p.key === F.pair ? 'on' : ''}" data-pair="${p.key}" style="display:inline-flex;align-items:center;gap:6px"><img src="${esc(p.logo)}" alt="" style="width:18px;height:18px;border-radius:50%">${esc(p.sym)}</button>`).join('')}</div>`;
    if (sel) sel.outerHTML = html; else $('#f-pair').outerHTML = html;
    const note = host.querySelector('.note'); if (note) note.textContent = ercPair() ? `The pool trades against ${PR().name}. Buyers still pay in ETH: the site swaps ETH to ${PR().sym} and into the coin in one transaction. Fees are paid out in ${PR().sym}. The pair cannot change later.` : 'Buyers pay in ETH in the pool from the moment it launches. The pair cannot change later.';
    $$('[data-pair]', host).forEach((b) => b.onclick = () => { F.pair = b.dataset.pair; if (ercPair()) { F.devBuy = 0; $('#f-dev').value = ''; } $('#f-dev').disabled = ercPair(); pairPick(); cost(); preview(); });
    $('#f-dev').disabled = ercPair();
    // v2 pays creator fees straight out in the pair; it has no buyback & vest
    const bb = $('#f-bb'); if (bb) { bb.classList.add('hidden'); F.buyback = false; } const adv = $('#st2 details.adv'); if (adv) adv.classList.add('hidden');
    const fw = $('#f-fw small'); if (fw) fw.textContent = `Paid out in ${PR() ? PR().sym : 'the pair'} straight to your fee wallet, from your profile.`;
  }
  pairPick();
  APP.onWallet(() => { goBtn(); preview(); if (APP.W.connected && !$('#f-wallet').value) $('#f-wallet').placeholder = APP.W.address; }); APP.onUpdate(cost);
  cost(); preview();
};
