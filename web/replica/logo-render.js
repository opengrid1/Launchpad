const { chromium } = require('playwright'); const fs=require('fs'); const wordmark=require('./wordmark.js');
(async()=>{ const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--proxy-server='+process.env.HTTPS_PROXY,'--ignore-certificate-errors']});
 const p=await b.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
 const logo=fs.readFileSync('img/logo.svg','utf8'), head=fs.readFileSync('img/favicon.svg','utf8'); const ink='data:image/png;base64,'+fs.readFileSync('img/ink.png').toString('base64');
 const font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titan+One&family=Geist:wght@500;600&display=swap">';
 const shot=async(html,w,h,file,bg)=>{ await p.setViewportSize({width:w,height:h}); await p.setContent(`<!doctype html><html><head>${font}<style>html,body{margin:0;background:${bg||'transparent'};width:${w}px;height:${h}px;overflow:hidden}</style></head><body>${html}</body></html>`); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(500); await p.screenshot({path:file,omitBackground:!bg}); };
 const sz=(svg,s)=>svg.replace(/width="\d+" height="\d+"/,`width="${s}" height="${s}"`);
 await shot(sz(logo,512),512,512,'img/logo-512.png');
 await shot(sz(logo,192),192,192,'img/icon-192.png');
 await shot(`<div style="background:#ff4fa3;width:180px;height:180px;display:grid;place-items:center">${sz(head,150)}</div>`,180,180,'img/apple-touch-icon.png','#ff4fa3');
 await shot(sz(head,32),32,32,'img/favicon-32.png');
 await shot(sz(head,64),64,64,'img/favicon-64.png');
 const wm=(fg)=>`<div style="display:flex;align-items:center;gap:18px;height:140px;padding:0 24px"><div style="width:120px;height:120px">${sz(logo,120)}</div><div style="padding-top:4px">${wordmark(400,{edge:fg==='#14121a'?'#0e1117':'#f3f5f9'})}</div></div>`;
 await shot(wm('#f3f5f9'),600,140,'img/wordmark-dark.png','#0e1117');
 await shot(wm('#14121a'),600,140,'img/wordmark-light.png','#ffffff');
 await shot(`<div style="position:relative;width:1200px;height:630px;background:#0e1117;color:#f3f5f9;font-family:Geist;overflow:hidden">
   <div style="position:absolute;left:70px;top:95px;width:440px;height:440px">${sz(logo,440)}</div>
   <div style="position:absolute;left:560px;top:100px">${wordmark(560)}</div>
   <div style="position:absolute;left:566px;top:318px;font:600 34px Geist;line-height:1.25;color:#f3f5f9;width:560px">Memecoins on Ink that pay holders in stocks.</div>
   <div style="position:absolute;left:566px;top:418px;font:500 22px Geist;color:#c3c9d6;width:560px;line-height:1.5">Liquidity locked forever. 2% fee on every trade: creator, holders in NVDAx / SPYx / TSLAx, and a 3-day trader prize pool.</div>
   <div style="position:absolute;left:566px;top:520px;display:flex;align-items:center;gap:10px;font:500 20px Geist;color:#7c8498"><img src="${ink}" style="width:26px;height:26px;border-radius:50%">Built on Ink · inkypump.fun</div>
 </div>`,1200,630,'img/og.png','#0e1117');
 await b.close(); })();
