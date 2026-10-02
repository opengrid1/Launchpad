const { chromium } = require('playwright'); const fs = require('fs');
const CFG = fs.readFileSync(__dirname + '/config.js', 'utf8').replace(/reownProjectId: '[^']*'/, "reownProjectId: ''");
const TOKEN = '0x5c1138fa782f7165a3be4c950cc0f32c6b70d08e';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--ignore-certificate-errors', '--proxy-bypass-list=127.0.0.1;localhost'] });
  const errs = [];
  async function pg(w, h, wallet) { const p = await b.newPage({ viewport: { width: w, height: h } }); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); }); await p.route('**/config.js', r => r.fulfill({ contentType: 'application/javascript', body: CFG })); if (wallet) await p.addInitScript(() => localStorage.setItem('wallet', '1')); return p; }
  const ready = async p => { await p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 40000 }); await p.waitForTimeout(400); };
  // home
  let p = await pg(1440, 900); await p.goto('http://127.0.0.1:8767/', { waitUntil: 'domcontentloaded' }); await ready(p);
  console.log('home feed rows', (await p.$$('#rows .group')).length, '| trend', (await p.$$('#trend button.h-16')).length, '| chips', (await p.$$('#newchips .group')).length, '| stats', await p.evaluate(() => [...document.querySelectorAll('[data-home] div.text-lg')].map(d => d.textContent)));
  console.log('feed first row', await p.evaluate(() => document.querySelector('#rows .group') && document.querySelector('#rows .group').innerText.replace(/\n/g, ' | ')));
  await p.keyboard.press('/'); await p.waitForTimeout(300); await p.type('#sq', 'ink'); await p.waitForTimeout(100); console.log('search results', (await p.$$('#sres .opt')).length, await p.getAttribute('#sres .opt', 'data-go')); await p.keyboard.press('Escape');
  await p.click('#rows .group'); await p.waitForURL(/\/token\/0x/); console.log('navigated to', p.url()); await p.close();
  // token page desktop
  p = await pg(1440, 900, true); await p.goto('http://127.0.0.1:8767/token/' + TOKEN, { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(2500);
  console.log('title', await p.title()); console.log('hero', await p.textContent('#hName'), await p.textContent('#hSym'), await p.textContent('.hAddrT'), '| tags', await p.evaluate(() => document.getElementById('tags').innerText.replace(/\n/g, ' ')));
  console.log('stats', await p.evaluate(() => [...document.querySelectorAll('[data-stat]')].map(s => s.innerText.replace(/\n/g, ' ')).join(' || ')));
  console.log('info', await p.evaluate(() => [...document.querySelectorAll('[data-info]')].map(s => s.innerText.replace(/\n/g, ' ')).join(' || ')), '| creator', await p.textContent('#infoCreator'), await p.textContent('#infoCreated'));
  console.log('trades rows', (await p.$$('#tb tr')).length, '|', await p.evaluate(() => document.querySelector('#tb tr') && document.querySelector('#tb tr').innerText.replace(/\n/g, ' | ')));
  console.log('tv iframe', !!await p.$('#tv iframe'), '| cta', await p.textContent('#cta'), '| pos visible', await p.isVisible('#pos'), await p.evaluate(() => document.getElementById('pos').innerText.replace(/\n/g, ' | ')));
  await p.fill('#amtIn', '0.001'); await p.waitForTimeout(1500); console.log('buy quote out', await p.inputValue('#amtOut'), '| min', await p.textContent('#d_minr'), '| impact', await p.textContent('#d_impact'), '| cta', await p.textContent('#cta'));
  await p.click('#flip'); await p.fill('#amtIn', '1000'); await p.waitForTimeout(1500); console.log('sell quote out', await p.inputValue('#amtOut'), '| cta', await p.textContent('#cta'));
  for (const t of ['hold', 'top', 'rew']) { await p.click(`#tabs [data-tab="${t}"]`); await p.waitForTimeout(2500); console.log('tab', t, await p.evaluate(k => { const e = document.querySelector(`#panes [data-pane="${k}"]`); return e.innerText.replace(/\s+/g, ' ').slice(0, 300); }, t)); }
  console.log('disclosures', await p.evaluate(() => [...document.querySelectorAll('[data-disc]')].map(e => e.textContent.slice(0, 90)).join(' // ')));
  await p.close();
  // token page mobile
  p = await pg(390, 844); await p.goto('http://127.0.0.1:8767/token/' + TOKEN, { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(1500);
  await p.click('#mbar [data-side="buy"]', { position: { x: 60, y: 24 } }); await p.waitForTimeout(300); console.log('mobile sheet', !!await p.$('.o-sheet #m_cta'), await p.textContent('.o-sheet #m_cta')); await p.close();
  // 404 token
  p = await pg(1440, 900); await p.goto('http://127.0.0.1:8767/token/0x0000000000000000000000000000000000000001', { waitUntil: 'domcontentloaded' }); await ready(p); console.log('unknown token', await p.evaluate(() => document.querySelector('main .o-empty h2').textContent)); await p.close();
  // launch
  p = await pg(1440, 900, true); await p.goto('http://127.0.0.1:8767/launch', { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(1500);
  console.log('picks', (await p.$$('#pick [data-s]')).length, '| pairs', (await p.$$('#pairMenu [data-p]')).length, '| pair prices', await p.evaluate(() => document.getElementById('pairMenu').innerText.replace(/\n/g, ' ').slice(0, 160)));
  await p.fill('#fName', 'Gorb'); await p.fill('#fTick', 'INKT'); console.log('taken check', await p.textContent('#tMsg')); await p.fill('#fTick', 'GORB'); console.log('avail', await p.textContent('#tMsg'), '| preview', await p.textContent('#pvPrice'), '| cta', await p.textContent('#deploy'));
  await p.close();
  // leaderboard
  p = await pg(1440, 900, true); await p.goto('http://127.0.0.1:8767/leaderboard', { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(2500);
  console.log('board cards', await p.evaluate(() => [...document.querySelectorAll('#boardPage .grid > div')].map(d => d.innerText.replace(/\n/g, ' ')).join(' || ')), '| podium', await p.evaluate(() => document.getElementById('podium').innerText.replace(/\s+/g, ' ').slice(0, 200)));
  await p.close();
  // profile (demo wallet = admin address)
  p = await pg(1440, 900, true); await p.goto('http://127.0.0.1:8767/profile', { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(4000);
  console.log('profile', await p.evaluate(() => document.getElementById('pfTags').innerText.replace(/\n/g, ' ')), '|', await p.evaluate(() => [...document.querySelectorAll('#profilePage .items-stretch > div')].map(d => d.innerText.replace(/\n/g, ' ')).join(' || ')));
  console.log('rewards', await p.evaluate(() => document.getElementById('rewards').innerText.replace(/\s+/g, ' ').slice(0, 200)));
  await p.close();
  // admin
  p = await pg(1440, 900, true); await p.goto('http://127.0.0.1:8767/admin', { waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(4000);
  console.log('admin', await p.evaluate(() => document.getElementById('admBody').innerText.replace(/\s+/g, ' ').slice(0, 500)));
  await p.close();
  // docs
  p = await pg(1440, 900); await p.goto('http://127.0.0.1:8767/docs/introduction', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(500); console.log('docs links', await p.evaluate(() => [...document.querySelectorAll('#navigation-items a')].slice(0, 4).map(a => a.getAttribute('href')).join(' ')), '| pagination', await p.evaluate(() => [...document.querySelectorAll('#pagination a')].map(a => a.getAttribute('href')).join(' '))); await p.close();
  console.log('ERRORS', errs);
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
