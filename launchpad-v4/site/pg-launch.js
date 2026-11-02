/* Launch form: step 1 identity, step 2 economics, live preview, one transaction. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtHype, toast, errMsg } = APP, C = CFG, E = C.econ, L = C.limits;
  const F = { image: '', name: '', symbol: '', description: '', x: '', telegram: '', website: '', chains: ['hyper'], creatorTaxBps: 0, buyback: false, devBuy: 0, creatorSol: '' };
  let step = 1, busy = false;
  const setStep = () => {}; // single page now
  // identity
  const hasLink = (s) => /(https?:\/\/|www\.|\.(com|xyz|io|net|org|fun|app|gg|me)\b|t\.me|x\.com)/i.test(s);
  const drop = $('#drop'), fi = $('#f-img');
  const readImg = (file) => { if (!file) return; if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('PNG, JPG, GIF or WEBP only', 'err'); if (file.size > L.imageMb * 1048576) return toast(`Image is over ${L.imageMb} MB`, 'err'); const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { if (Math.abs(im.width - im.height) > Math.max(im.width, im.height) * 0.05) toast('Square images look best; this one will be cropped', 'info'); F.image = r.result; drop.innerHTML = `<img src="${F.image}" alt="">`; preview(); }; im.src = r.result; }; r.readAsDataURL(file); };
  fi.onchange = () => readImg(fi.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') readImg(e.dataTransfer.files[0]); }));
  const bind = (id, key, n, max, up) => { const el = $(id); el.oninput = () => { let v = el.value; if (up) v = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (max) v = v.slice(0, max); if (up) el.value = v; F[key] = v.trim(); if (n) $(n).textContent = `${v.length}/${max}`; if (key === 'description') { const bad = hasLink(v); $('#desc-err').classList.toggle('hidden', !bad); el.classList.toggle('err', bad); } preview(); }; };
  bind('#f-name', 'name', '#n-name', L.name); bind('#f-sym', 'symbol', '#n-sym', L.ticker, true); bind('#f-desc', 'description', '#n-desc', L.desc); bind('#f-x', 'x'); bind('#f-tg', 'telegram'); bind('#f-web', 'website');
  const validate = () => { if (!F.name) { toast('Give the coin a name', 'err'); $('#f-name').focus(); return false; } if (!F.symbol) { toast('Give the coin a ticker', 'err'); $('#f-sym').focus(); return false; } if (hasLink(F.description)) { toast('Remove the link from the description', 'err'); return false; } for (const [k, re] of [['x', /^https?:\/\/(x|twitter)\.com\/.+/i], ['telegram', /^https?:\/\/t\.me\/.+/i], ['website', /^https?:\/\/.+\..+/i]]) if (F[k] && !re.test(F[k])) { toast(`Check the ${k} link`, 'err'); return false; } return true; };
  $('#next').onclick = validate;
  $('#back').onclick = () => setStep(1);
  // economics
  const chs = $('#f-chains'); chs.innerHTML = C.chains.map((c) => `<button type="button" data-c="${c.key}" class="${F.chains.includes(c.key) ? 'on' : ''}"><img src="${c.logo}" alt=""><div><b>${c.name}</b><small>${c.key === 'hyper' ? 'your wallet signs here' : 'opened for you, same price'}</small></div><span class="tick"></span></button>`).join('');
  $$('button', chs).forEach((b) => b.onclick = () => { const k = b.dataset.c; if (k === 'hyper') return toast('HyperEVM is where the launch is signed; it is always on', 'info'); F.chains = F.chains.includes(k) ? F.chains.filter((x) => x !== k) : [...F.chains, k]; b.classList.toggle('on', F.chains.includes(k)); cost(); preview(); });
  const taxes = [0, 100, 200, 300, 500, 1000]; $('#f-tax').innerHTML = taxes.map((t) => `<button type="button" data-t="${t}" class="${t === 0 ? 'on' : ''}">${t ? '+' + t / 100 + '%' : 'Standard'}</button>`).join('');
  $$('#f-tax button').forEach((b) => b.onclick = () => { $$('#f-tax button').forEach((x) => x.classList.toggle('on', x === b)); F.creatorTaxBps = +b.dataset.t; cost(); preview(); });
  $('#f-bb').onclick = (e) => { e.stopPropagation(); F.buyback = !F.buyback; $('#f-bb').classList.toggle('on', F.buyback); preview(); };
  $('#f-dev').oninput = (e) => { F.devBuy = Math.max(0, parseFloat(e.target.value) || 0); cost(); };
  $$('#f-qd button').forEach((b) => b.onclick = () => { $('#f-dev').value = +b.dataset.v ? b.dataset.v : ''; F.devBuy = +b.dataset.v; cost(); });
  $('#f-solw').oninput = (e) => { F.creatorSol = e.target.value.trim(); };
  $('#sol-use').onclick = async () => { if (!APP.W.sol.connected) await APP.W.sol.connect(); if (APP.W.sol.connected) { F.creatorSol = APP.W.sol.address; $('#f-solw').value = F.creatorSol; } };
  function cost() {
    const q = F.devBuy > 0 ? DATA.quoteBuy ? null : null : null; const maxTok = E.supply * E.maxDevBuyBps / 10000;
    // tokens for the opening buy on a fresh pool: constant product from the opening market cap
    const net = F.devBuy * (1 - (E.feeBps + F.creatorTaxBps) / 10000), tokens = F.devBuy > 0 ? E.supply * (1 - E.openMcapHype / (E.openMcapHype + net)) : 0, over = tokens > maxTok;
    $('#dev-hint').innerHTML = F.devBuy > 0 ? `<span>You get about <b class="mono">${fmtNum(tokens, 0)} ${esc(F.symbol || 'tokens')}</b>${over ? ` <span class="dn">· over the 5% cap, lower it</span>` : ''}</span><span>${(tokens / E.supply * 100).toFixed(2)}% of 5% cap</span>` : `<span>Lands in the launch transaction, before anyone else can trade.</span><span>0% of 5% cap</span>`;
    $('#dev-hint').dataset.over = over ? '1' : '';
    const gasHype = 1_200_000 * (APP.gasGwei || 20) / 1e9; const tot = E.launchFeeHype + F.devBuy + gasHype;
    $('#c-fee').textContent = fmtHype(E.launchFeeHype); $('#c-dev').textContent = F.devBuy > 0 ? fmtHype(F.devBuy) : '—'; $('#c-gas').textContent = fmtHype(gasHype, 4) + (APP.gasGwei ? ` at ${APP.gasGwei.toFixed(APP.gasGwei < 10 ? 1 : 0)} gwei` : ''); $('#c-tot').textContent = fmtHype(tot, 4) + ` (${APP.usd(tot)})`;
    { const pay = (E.feeBps + F.creatorTaxBps) / 100, earn = (E.feeBps * E.creatorShareBps / 10000 + F.creatorTaxBps) / 100; $('#fs-pay').textContent = pay.toFixed(pay % 1 ? 1 : 0) + '%'; $('#fs-earn').textContent = earn.toFixed(1) + '%'; $('#fs-bar').innerHTML = `<i style="width:${(earn / pay * 100).toFixed(1)}%;background:var(--mint)"></i><i style="flex:1;background:#35464c"></i>`; const cap = $('#dev-cap'); if (cap) { cap.classList.toggle('over', !!over); cap.firstElementChild.style.width = Math.min(100, tokens / maxTok * 100).toFixed(1) + '%'; } const mc = $('#pv-mc'); if (mc) mc.textContent = APP.fmtUsd((E.openMcapHype + net) ** 2 / E.openMcapHype * APP.hypeUsd); }
    $('#tax-hint').textContent = F.creatorTaxBps ? `Traders pay ${(1 + F.creatorTaxBps / 100).toFixed(1)}% per swap: 1% split 70/30 with the protocol, plus ${F.creatorTaxBps / 100}% that is all yours.` : 'Traders pay 1% per swap, 70% of it to you. Add a creator fee if you want more; it shows on the coin page.';
    goBtn();
  }
  function goBtn() { const b = $('#go'); if (busy) return; if (!APP.W.connected) { b.textContent = 'Connect to deploy'; b.onclick = () => APP.W.connect(); return; } if (!APP.W.chainOk) { b.textContent = 'Switch to HyperEVM'; b.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; } b.textContent = `Deploy ${F.symbol ? '$' + F.symbol : 'the coin'}`; b.onclick = launch; }
  function preview() {
    $('#pv-img').src = F.image || '/img/logo.svg'; $('#pv-n').textContent = F.name || 'Coin name'; $('#pv-t').innerHTML = `$${esc(F.symbol || 'SYMBOL')} · ${F.chains.map((c) => `<img src="${C.chainOf(c).logo}" alt="">${C.chainOf(c).short}`).join(' · ')}`; $('#pv-d').textContent = F.description || '';
    $('#pv-l').innerHTML = [['x', 'X'], ['telegram', 'Telegram'], ['website', 'Website']].filter(([k]) => F[k]).map(([, l]) => `<span class="badge">${l}</span>`).join('') + F.chains.map((c) => `<span class="badge ac"><img src="${C.chainOf(c).logo}" alt="" style="width:12px;height:12px;border-radius:50%">${C.chainOf(c).name}</span>`).join('');
    $('#pv-sup').textContent = '1B'; $('#pv-fee').textContent = `${(1 + F.creatorTaxBps / 100).toFixed(F.creatorTaxBps % 100 ? 1 : 0)}% · 10s snipe tax${F.buyback ? ' · buyback' : ''}`;
    
  }
  async function launch() {
    if (!validate()) return; if ($('#dev-hint').dataset.over) return toast('The opening buy is over the 5% cap', 'err');
    
    busy = true; const b = $('#go'); b.disabled = true; b.textContent = 'Confirm in your wallet…'; const P = $('#prog'); P.classList.add('show'); const mark = (s, cls) => { const d = P.querySelector(`[data-s="${s}"]`); d.classList.remove('on', 'ok'); d.classList.add(cls); };
    mark('sign', 'on');
    try {
      const r = await DATA.launch(F); mark('sign', 'ok'); mark('hyper', 'ok'); $('#go-msg').innerHTML = `Launched. <a class="ac" href="${APP.tokenUrl(r.addr)}">Open ${esc(F.symbol)}</a>`; toast(`${F.symbol} is live on HyperEVM`, 'ok');
      mark('done', 'on');
      setTimeout(() => { location.href = APP.tokenUrl(r.addr); }, 1800);
    } catch (e) { toast(errMsg(e), 'err'); mark('sign', ''); busy = false; b.disabled = false; goBtn(); }
  }
  APP.onWallet(() => { goBtn(); preview(); }); APP.onUpdate(cost);
  cost(); preview();
};
