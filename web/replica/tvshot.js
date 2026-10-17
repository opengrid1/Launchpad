const { chromium } = require('playwright');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-server=' + process.env.HTTPS_PROXY, '--ignore-certificate-errors'] });
  for (const [w,h] of [[1440,900],[390,844]]) { const p = await b.newPage({ viewport:{width:w,height:h} }); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error'&&!/net::|404|Failed to load/.test(m.text())) errs.push('console '+m.text().slice(0,160)); });
    await p.goto('http://127.0.0.1:8767/token.html',{waitUntil:'networkidle'}); await p.waitForTimeout(6000);
    const info=await p.evaluate(()=>({ iframe: !!document.querySelector('#tv iframe'), size:[document.querySelector('#tv').clientWidth,document.querySelector('#tv').clientHeight], active: !!window.tvActive })); console.log(w, info, errs.slice(0,5));
    await p.evaluate(y=>{ document.querySelector('main').scrollTop=y; }, w<500?300:120); await p.screenshot({path:`shots/tv-${w}.png`}); await p.close(); }
  await b.close(); })();
