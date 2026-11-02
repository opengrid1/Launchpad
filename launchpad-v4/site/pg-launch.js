/* Launch form: step 1 identity, step 2 economics, live "on the board" preview, one transaction. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtHype, toast, errMsg } = APP, C = CFG, E = C.econ, L = C.limits;
  const F = { image: '', name: '', symbol: '', description: '', x: '', telegram: '', website: '', chains: ['hyper'], creatorTaxBps: 0, buyback: false, devBuy: 0, creatorSol: '' };
  let busy = false;
  const setStep = (s) => { $('#st1').classList.toggle('hidden', s !== 1); $('#st2').classList.toggle('hidden', s !== 2); $('#w-h2').textContent = s === 1 ? 'Give it a name and a face.' : 'Set the economics.'; $$('.steps span').forEach((x) => { const n = +x.dataset.st; x.classList.toggle('on', n === s); x.classList.toggle('ok', n < s); }); scrollTo({ top: 0, behavior: 'smooth' }); };
  // identity
  const hasLink = (s) => /(https?:\/\/|www\.|\.(com|xyz|io|net|org|fun|app|gg|me)\b|t\.me|x\.com)/i.test(s);
  const drop = $('#drop'), fi = $('#f-img');
  const readImg = (file) => { if (!file) return; if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('PNG, JPG, GIF or WEBP only', 'err'); if (file.size > L.imageMb * 1048576) return toast(`Image is over ${L.imageMb} MB`, 'err'); const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { if (Math.abs(im.width - im.height) > Math.max(im.width, im.height) * 0.05) toast('Square images look best; this one will be cropped', 'info'); F.image = r.result; drop.innerHTML = `<img src="${F.image}" alt="">`; preview(); }; im.src = r.result; }; r.readAsDataURL(file); };
  fi.onchange = () => readImg(fi.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') readImg(e.dataTransfer.files[0]); }));
  const bind = (id, key, n, max, up) => { const el = $(id); el.oninput = () => { let v = el.value; if (up) v = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (max) v = v.slice(0, max); if (up) el.value = v; F[key] = v.trim(); if (n) $(n).textContent = `${v.length}/${max}`; if (key === 'description') { const bad = hasLink(v); $('#desc-err').classList.toggle('hidden', !bad); el.classList.toggle('err', bad); } preview(); }; };
  bind('#f-name', 'name', '#n-name', L.name); bind('#f-sym', 'symbol', '#n-sym', L.ticker, true); bind('#f-desc', 'description', '#n-desc', L.desc); bind('#f-x', 'x'); bind('#f-tg', 'telegram'); bind('#f-web', 'website');
  const validate = () => { if (!F.name) { toast('Give the coin a name', 'err'); $('#f-name').focus(); return false; } if (!F.symbol) { toast('Give the coin a ticker', 'err'); $('#f-sym').focus(); return false; } if (hasLink(F.description)) { toast('Remove the link from the description', 'err'); return false; } for (const [k, re] of [['x', /^https?:\/\/(x|twitter)\.com\/.+/i], ['telegram', /^https?:\/\/t\.me\/.+/i], ['website', /^https?:\/\/.+\..+/i]]) if (F[k] && !re.test(F[k])) { toast(`Check the ${k} link`, 'err'); return false; } return true; };
  $('#next').onclick = () => { if (validate()) setStep(2); };
  $('#back').onclick = () => setStep(1);
  // economics
  const taxes = [0, 100, 200, 300, 500, 1000]; $('#f-tax').innerHTML = taxes.map((t) => `<button type="button" data-t="${t}" class="${t === 0 ? 'on' : ''}">${t ? '+' + t / 100 + '%' : 'None'}</button>`).join('');
  $$('#f-tax button').forEach((b) => b.onclick = () => { $$('#f-tax button').forEach((x) => x.classList.toggle('on', x === b)); F.creatorTaxBps = +b.dataset.t; cost(); preview(); });
  $('#f-bb').onclick = (e) => { e.stopPropagation(); F.buyback = !F.buyback; $('#f-bb').classList.toggle('on', F.buyback); preview(); };
  $('#f-dev').oninput = (e) => { F.devBuy = Math.max(0, parseFloat(e.target.value) || 0); cost(); };
  $$('#f-qd button').forEach((b) => b.onclick = () => { $('#f-dev').value = +b.dataset.v ? b.dataset.v : ''; F.devBuy = +b.dataset.v; cost(); });
  function cost() {
    const maxTok = E.supply * E.maxDevBuyBps / 10000;
    const net = F.devBuy * (1 - (E.feeBps + F.creatorTaxBps) / 10000), tokens = F.devBuy > 0 ? E.supply * (1 - E.openMcapHype / (E.openMcapHype + net)) : 0, over = tokens > maxTok;
    $('#dev-hint').innerHTML = F.devBuy > 0 ? `<span>You get about <b>${fmtNum(tokens, 0)} ${esc(F.symbol || 'tokens')}</b>${over ? ` <span class="dn">· over the 5% cap, lower it</span>` : ''}</span><span>${(tokens / E.supply * 100).toFixed(2)}% of 5%</span>` : `<span>Lands in the launch transaction, before anyone else can trade.</span><span>0% of 5%</span>`;
    $('#dev-hint').dataset.over = over ? '1' : '';
    const cap = $('#dev-cap'); cap.classList.toggle('over', !!over); cap.firstElementChild.style.width = Math.min(100, tokens / maxTok * 100).toFixed(1) + '%';
    const gasHype = 1_200_000 * (APP.gasGwei || 20) / 1e9; const tot = E.launchFeeHype + F.devBuy + gasHype;
    $('#c-fee').textContent = fmtHype(E.launchFeeHype); $('#c-dev').textContent = F.devBuy > 0 ? fmtHype(F.devBuy) : '—'; $('#c-gas').textContent = fmtHype(gasHype, 4) + (APP.gasGwei ? ` at ${APP.gasGwei.toFixed(APP.gasGwei < 10 ? 1 : 0)} gwei` : ''); $('#c-tot').textContent = fmtHype(tot, 4) + ` (${APP.usd(tot)})`;
    const pay = (E.feeBps + F.creatorTaxBps) / 100, earn = (E.feeBps * E.creatorShareBps / 10000 + F.creatorTaxBps) / 100; $('#fs-pay').textContent = pay.toFixed(pay % 1 ? 1 : 0) + '%'; $('#fs-earn').textContent = earn.toFixed(1) + '%'; $('#fs-bar').innerHTML = `<i style="width:${(earn / pay * 100).toFixed(1)}%;background:var(--acid)"></i><i style="flex:1;background:rgba(12,21,0,.3)"></i>`;
    $('#pv-mc').textContent = `${E.openMcapHype + net > E.openMcapHype ? fmtNum((E.openMcapHype + net) ** 2 / E.openMcapHype, 1) : E.openMcapHype} HYPE`;
    $('#tax-hint').textContent = F.creatorTaxBps ? `Traders pay ${(1 + F.creatorTaxBps / 100).toFixed(1)}% per swap: 1% split 70/30 with the protocol, plus ${F.creatorTaxBps / 100}% that is all yours. Fixed for good and shown on the coin page.` : 'Traders pay 1% per swap and 70% of it is yours. Add a creator fee if you want more; it is fixed for good and shown on the coin page.';
    goBtn();
  }
  function goBtn() { const b = $('#go'); if (busy) return; if (!APP.W.connected) { b.textContent = 'Connect to deploy'; b.onclick = () => APP.W.connect(); return; } if (!APP.W.chainOk) { b.textContent = 'Switch to HyperEVM'; b.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; } b.textContent = `Deploy ${F.symbol ? '$' + F.symbol : 'the coin'}`; b.onclick = launch; }
  function preview() {
    $('#pv-img').src = F.image || '/img/logo.svg'; $('#pv-n').textContent = F.name || 'Your coin'; $('#pv-t').innerHTML = `<span>${esc(F.symbol || 'TICKER')}</span><span class="badge">HYPE pair</span>`; $('#pv-d').textContent = F.description || 'A line or two about the coin goes here.';
    $('#pv-l').innerHTML = [['x', 'X'], ['telegram', 'Telegram'], ['website', 'Website']].filter(([k]) => F[k]).map(([, l]) => `<span class="badge">${l}</span>`).join('');
    $('#pv-fee').textContent = `${F.creatorTaxBps / 100}%${F.buyback ? ' · buyback' : ''}`;
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
