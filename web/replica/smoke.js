const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--ignore-certificate-errors'] });
  const errs = [];
  async function pg(w,h){ const p = await b.newPage({ viewport:{width:w,height:h} }); p.on('pageerror', e => errs.push(e.message)); return p; }
  // desktop token flows
  let p = await pg(1440,900); await p.goto('http://127.0.0.1:8767/token.html',{waitUntil:'networkidle'}); await p.waitForTimeout(800);
  await p.click('header button[aria-label="Launchpad"]'); console.log('brand menu', !!await p.$('.o-menu'));
  await p.keyboard.press('Escape');
  await p.keyboard.press('/'); await p.waitForTimeout(300); console.log('search dialog', !!await p.$('#sq')); await p.type('#sq','mog'); await p.waitForTimeout(100); console.log('search results', (await p.$$('#sres .opt')).length); await p.keyboard.press('Escape');
  await p.click('header button[aria-label^="Language"]'); console.log('lang dialog', !!await p.$('[data-lang]')); await p.keyboard.press('Escape');
  await p.click('#cta'); await p.waitForTimeout(200); console.log('connect dialog', !!await p.$('[data-w]')); await p.click('[data-w="MetaMask"]'); await p.waitForTimeout(1300);
  console.log('wallet pill', await p.textContent('header .relative.flex.h-9.shrink-0.items-stretch button'), '| cta', await p.textContent('#cta'), '| pos visible', await p.isVisible('#pos'));
  await p.click('#flip'); await p.waitForTimeout(100); console.log('after flip cta', await p.textContent('#cta'), '| out', await p.inputValue('#amtOut'));
  await p.click('[data-q="50%"]'); console.log('50% amt', await p.inputValue('#amtIn'));
  await p.click('#detBtn'); console.log('details open', await p.getAttribute('#detBtn','aria-expanded'));
  for (const t of ['hold','rew','top','upd','tx']) { await p.click(`#tabs [data-tab="${t}"]`); await p.waitForTimeout(80); console.log('tab',t, await p.evaluate(k=>[...document.querySelectorAll('#panes [data-pane]')].filter(e=>getComputedStyle(e).display!=='none').map(e=>e.dataset.pane).join(','),t)); }
  await p.click('#seg [data-side="sell"]'); console.log('sell filter rows visible', await p.evaluate(()=>[...document.querySelectorAll('#tb tr')].filter(r=>r.style.display!=='none').every(r=>r.dataset.k==='sell')));
  await p.click('#loadmore button'); console.log('rows after load more', (await p.$$('#tb tr')).length);
  await p.click('#warn button'); console.log('warn expanded', await p.getAttribute('#warn button','aria-expanded'));
  await p.click('#tfBtn'); console.log('tf menu', (await p.$$('.o-menu [data-tf]')).length); await p.click('.o-menu [data-tf="5m"]'); console.log('tf now', await p.textContent('#tfBtn'));
  await p.click('header .relative.flex.h-9.shrink-0.items-stretch button'); await p.waitForTimeout(100); console.log('wallet menu', (await p.$$('.o-menu [data-act]')).length);
  await p.close();
  // mobile token flows
  p = await pg(390,844); await p.goto('http://127.0.0.1:8767/token.html',{waitUntil:'networkidle'}); await p.waitForTimeout(600);
  await p.click('#mbar [data-side="buy"]',{position:{x:60,y:24}}); await p.waitForTimeout(300); console.log('mobile sheet', !!await p.$('.o-sheet #m_cta'), await p.textContent('.o-sheet #m_cta'));
  await p.keyboard.press('Escape'); await p.click('header button:has(.lucide-menu)'); await p.waitForTimeout(300); console.log('drawer items', (await p.$$('.o-drawer [data-go]')).length); await p.close();
  // home flows
  p = await pg(1440,900); await p.goto('http://127.0.0.1:8767/index.html',{waitUntil:'networkidle'}); await p.waitForTimeout(600);
  console.log('feed rows', (await p.$$('#rows .group')).length, 'trend', (await p.$$('#trend button.h-16')).length, 'chips', (await p.$$('#newchips .group')).length);
  await p.click('[data-filter="new"]'); console.log('new filter rows', (await p.$$('#rows .group')).length);
  await p.click('[data-sort="liq"]'); console.log('first after liq sort', await p.textContent('#rows .group .n1, #rows .group .text-sm.font-bold'));
  await p.click('[data-dd="assets"] >> visible=true'); await p.waitForTimeout(100); console.log('assets menu', (await p.$$('.o-menu [data-o]')).length);
  await p.evaluate(()=>document.querySelector('main').scrollTo(0,900)); await p.waitForTimeout(300); console.log('feed bar bg', await p.evaluate(()=>document.getElementById('feed').style.backgroundColor));
  await p.close();
  // launch wizard
  p = await pg(1440,900); await p.goto('http://127.0.0.1:8767/launch.html',{waitUntil:'networkidle'}); await p.waitForTimeout(500);
  await p.click('[data-next="2"]'); console.log('step2 visible', await p.isVisible('[data-wiz="2"]'), 'picks', (await p.$$('#pick [data-s]')).length);
  await p.click('#pick [data-s="TSLAx"]'); console.log('pkC', await p.textContent('#pkC'));
  await p.click('[data-next="3"]'); console.log('step3 visible', await p.isVisible('[data-wiz="3"]'), 'tags', (await p.$$('#rTags span')).length);
  await p.close();
  // leaderboard / profile / docs / admin load
  for (const n of ['leaderboard','portfolio','docs','admin']) { p = await pg(1440,900); await p.goto('http://127.0.0.1:8767/'+n+'.html',{waitUntil:'networkidle'}); await p.waitForTimeout(500); if(n==='leaderboard'){ await p.click('[data-board="vol"]'); console.log('vol board rows', (await p.$$('#btb tr')).length); } if(n==='portfolio'){ await p.keyboard.press('Escape'); await p.click('[data-ptab="act"]'); console.log('activity rows', (await p.$$('#act > div')).length); } await p.close(); }
  console.log('ERRORS', errs);
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
