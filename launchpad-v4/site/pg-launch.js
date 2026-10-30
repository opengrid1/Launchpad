/* Launch form: step 1 identity, step 2 economics, live preview, one transaction. */
window.PAGE = async () => {
  const { $, $$, esc, fmtNum, fmtHype, toast, errMsg } = APP, C = CFG, E = C.econ, L = C.limits;
  const F = { image: '', name: '', symbol: '', description: '', x: '', telegram: '', website: '', chains: ['hyper', 'sol'], creatorTaxBps: 0, buyback: false, devBuy: 0, creatorSol: '' };
  let step = 1, busy = false;
  const setStep = (s) => { step = s; $('#st1').classList.toggle('hidden', s !== 1); $('#st2').classList.toggle('hidden', s !== 2); $$('.steps span').forEach((x) => { const n = +x.dataset.st; x.classList.toggle('on', n === s); x.classList.toggle('ok', n < s); }); scrollTo({ top: 0, behavior: 'smooth' }); };
  // identity
  const hasLink = (s) => /(https?:\/\/|www\.|\.(com|xyz|io|net|org|fun|app|gg|me)\b|t\.me|x\.com)/i.test(s);
  const drop = $('#drop'), fi = $('#f-img');
  const readImg = (file) => { if (!file) return; if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return toast('PNG, JPG, GIF or WEBP only', 'err'); if (file.size > L.imageMb * 1048576) return toast(`Image is over ${L.imageMb} MB`, 'err'); const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { if (Math.abs(im.width - im.height) > Math.max(im.width, im.height) * 0.05) toast('Square images look best; this one will be cropped', 'info'); F.image = r.result; drop.innerHTML = `<img src="${F.image}" alt="">`; preview(); }; im.src = r.result; }; r.readAsDataURL(file); };
  fi.onchange = () => readImg(fi.files[0]);
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); if (ev === 'drop') readImg(e.dataTransfer.files[0]); }));
  const bind = (id, key, n, max, up) => { const el = $(id); el.oninput = () => { let v = el.value; if (up) v = v.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (max) v = v.slice(0, max); if (up) el.value = v; F[key] = v.trim(); if (n) $(n).textContent = `${v.length}/${max}`; if (key === 'description') { const bad = hasLink(v); $('#desc-err').classList.toggle('hidden', !bad); el.classList.toggle('err', bad); } preview(); }; };
  bind('#f-name', 'name', '#n-name', L.name); bind('#f-sym', 'symbol', '#n-sym', L.ticker, true); bind('#f-desc', 'description', '#n-desc', L.desc); bind('#f-x', 'x'); bind('#f-tg', 'telegram'); bind('#f-web', 'website');
  $('#next').onclick = () => { if (!F.name) return toast('Give the coin a name', 'err'); if (!F.symbol) return toast('Give the coin a ticker', 'err'); if (hasLink(F.description)) return toast('Remove the link from the description', 'err'); for (const [k, re] of [['x', /^https?:\/\/(x|twitter)\.com\/.+/i], ['telegram', /^https?:\/\/t\.me\/.+/i], ['website', /^https?:\/\/.+\..+/i]]) if (F[k] && !re.test(F[k])) return toast(`Check the ${k} link`, 'err'); setStep(2); };
  $('#back').onclick = () => setStep(1);
  // economics
  const chs = $('#f-chains'); chs.innerHTML = C.chains.map((c) => `<button type="button" data-c="${c.key}" class="${F.chains.includes(c.key) ? 'on' : ''}"><img src="${c.logo}" alt=""><div><b>${c.name}</b><small>${c.key === 'hyper' ? 'your wallet launches here' : 'launched for you, same price'} · ${c.quote} pair</small></div><span class="tick"></span></button>`).join('');
  $$('button', chs).forEach((b) => b.onclick = () => { const k = b.dataset.c; if (k === 'hyper') return toast('HyperEVM is where the launch is signed; it is always on', 'info'); F.chains = F.chains.includes(k) ? F.chains.filter((x) => x !== k) : [...F.chains, k]; b.classList.toggle('on', F.chains.includes(k)); cost(); preview(); });
  const taxes = [0, 100, 200, 300, 500, 1000]; $('#f-tax').innerHTML = taxes.map((t) => `<button type="button" data-t="${t}" class="${t === 0 ? 'on' : ''}">${t ? '+' + t / 100 + '%' : 'None'}</button>`).join('');
  $$('#f-tax button').forEach((b) => b.onclick = () => { $$('#f-tax button').forEach((x) => x.classList.toggle('on', x === b)); F.creatorTaxBps = +b.dataset.t; cost(); preview(); });
  $('#f-bb').onclick = () => { F.buyback = !F.buyback; $('#f-bb').classList.toggle('on', F.buyback); preview(); };
  $('#f-dev').oninput = (e) => { F.devBuy = Math.max(0, parseFloat(e.target.value) || 0); cost(); };
  $('#f-solw').oninput = (e) => { F.creatorSol = e.target.value.trim(); };
  $('#sol-use').onclick = async () => { if (!APP.W.sol.connected) await APP.W.sol.connect(); if (APP.W.sol.connected) { F.creatorSol = APP.W.sol.address; $('#f-solw').value = F.creatorSol; } };
  function cost() {
    const q = F.devBuy > 0 ? DATA.quoteBuy ? null : null : null; const maxTok = E.supply * E.maxDevBuyBps / 10000;
    // tokens for the opening buy on a fresh pool: constant product from the opening market cap
    const net = F.devBuy * (1 - (E.feeBps + F.creatorTaxBps) / 10000), tokens = F.devBuy > 0 ? E.supply * (1 - E.openMcapHype / (E.openMcapHype + net)) : 0, over = tokens > maxTok;
    $('#dev-hint').innerHTML = F.devBuy > 0 ? `You get about <b class="mono">${fmtNum(tokens, 0)} ${esc(F.symbol || 'tokens')}</b> (${(tokens / E.supply * 100).toFixed(2)}% of the supply)${over ? ` <span class="dn">— over the 5% cap, lower it</span>` : ''}` : 'Your first buy lands in the launch transaction, before anyone else can trade.';
    $('#dev-hint').dataset.over = over ? '1' : '';
    const gasHype = 1_200_000 * (APP.gasGwei || 20) / 1e9; const tot = E.launchFeeHype + F.devBuy + gasHype;
    $('#c-fee').textContent = fmtHype(E.launchFeeHype); $('#c-dev').textContent = F.devBuy > 0 ? fmtHype(F.devBuy) : '—'; $('#c-gas').textContent = fmtHype(gasHype, 4) + (APP.gasGwei ? ` at ${APP.gasGwei.toFixed(APP.gasGwei < 10 ? 1 : 0)} gwei` : ''); $('#c-tot').textContent = fmtHype(tot, 4) + ` (${APP.usd(tot)})`;
    $('#tax-hint').textContent = F.creatorTaxBps ? `Traders pay ${(1 + F.creatorTaxBps / 100).toFixed(1)}% per swap: 1% split 70/30 with the protocol, plus ${F.creatorTaxBps / 100}% that is all yours.` : 'Traders pay 1% per swap, 70% of it to you. Add a creator fee if you want more; it shows on the coin page.';
    goBtn();
  }
  function goBtn() { const b = $('#go'); if (busy) return; if (!APP.W.connected) { b.textContent = 'Connect a wallet'; b.onclick = () => APP.W.connect(); return; } if (!APP.W.chainOk) { b.textContent = 'Switch to HyperEVM'; b.onclick = () => APP.W.switchChain().catch((e) => toast(errMsg(e), 'err')); return; } b.textContent = `Launch ${F.symbol ? '$' + F.symbol : 'the coin'}`; b.onclick = launch; }
  function preview() {
    $('#pv-img').src = F.image || '/img/logo.svg'; $('#pv-n').textContent = F.name || 'Your coin'; $('#pv-t').textContent = `$${F.symbol || 'TICKER'} · by ${APP.W.connected ? APP.W.short : 'you'}`; $('#pv-d').textContent = F.description || 'The description shows here.';
    $('#pv-l').innerHTML = [['x', 'X'], ['telegram', 'Telegram'], ['website', 'Website']].filter(([k]) => F[k]).map(([, l]) => `<span class="badge">${l}</span>`).join('') + F.chains.map((c) => `<span class="badge ac"><img src="${C.chainOf(c).logo}" alt="" style="width:12px;height:12px;border-radius:50%">${C.chainOf(c).name}</span>`).join('');
    $('#pv-sup').textContent = `1B per chain · ${F.chains.length} chain${F.chains.length > 1 ? 's' : ''}`; $('#pv-fee').textContent = `${(1 + F.creatorTaxBps / 100).toFixed(F.creatorTaxBps % 100 ? 1 : 0)}% · ${F.creatorTaxBps ? '70% of 1% + all of ' + F.creatorTaxBps / 100 + '%' : '70% to you'}${F.buyback ? ' · buyback' : ''}`;
    $('#prog').querySelector('[data-s="sol"]').classList.toggle('hidden', !F.chains.includes('sol'));
  }
  async function launch() {
    if ($('#dev-hint').dataset.over) return toast('The opening buy is over the 5% cap', 'err');
    if (F.chains.includes('sol') && F.creatorSol && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(F.creatorSol)) return toast('That Solana address does not look right', 'err');
    busy = true; const b = $('#go'); b.disabled = true; b.textContent = 'Confirm in your wallet…'; const P = $('#prog'); const mark = (s, cls) => { const d = P.querySelector(`[data-s="${s}"]`); d.classList.remove('on', 'ok'); d.classList.add(cls); };
    mark('sign', 'on');
    try {
      const r = await DATA.launch(F); mark('sign', 'ok'); mark('hyper', 'ok'); $('#go-msg').innerHTML = `Launched. <a class="ac" href="${APP.tokenUrl(r.addr)}">Open ${esc(F.symbol)}</a>`; toast(`${F.symbol} is live on HyperEVM`, 'ok');
      if (F.chains.includes('sol')) { mark('sol', 'on'); $('#go-msg').innerHTML += ` · the Solana pool opens within a minute.`; } mark('done', 'on');
      setTimeout(() => { location.href = APP.tokenUrl(r.addr); }, 1800);
    } catch (e) { toast(errMsg(e), 'err'); mark('sign', ''); busy = false; b.disabled = false; goBtn(); }
  }
  APP.onWallet(() => { goBtn(); preview(); }); APP.onUpdate(cost);
  cost(); preview();
};
