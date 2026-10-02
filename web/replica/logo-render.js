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
 const def=fs.readFileSync('img/t-default.svg','utf8'); const blobPath=def.match(/<path d="(M[^"]+)"\/>/)[1]; const drops=def.match(/<circle[^>]+\/>(<circle[^>]+\/>)*/)[0];
 const blot=(txt,s,rot=-5,fsz=78)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${s}" height="${s}"><g transform="rotate(${rot} 128 128)"><g fill="#f3f5f9" stroke="#f3f5f9" stroke-width="18" stroke-linejoin="round"><path d="${blobPath}"/>${drops}</g><g fill="#14121a" stroke="#14121a" stroke-width="7" stroke-linejoin="round"><path d="${blobPath}"/>${drops}</g><g fill="#ff4fa3"><path d="${blobPath}"/>${drops}</g><path fill="#ff7cbb" d="M78 86c8-18 26-30 48-30-20 6-34 20-40 40-2 8-12 8-12-2 0-3 2-5 4-8z"/><text x="128" y="158" text-anchor="middle" font-family="'Titan One'" font-size="${fsz}" fill="#f3f5f9" stroke="#14121a" stroke-width="9" stroke-linejoin="round" paint-order="stroke" transform="rotate(-3 128 140)">${txt}</text></g></svg>`;
 await shot(`<div style="position:relative;width:1200px;height:630px;background:#0e1117;color:#f3f5f9;font-family:Geist;overflow:hidden">
   <div style="position:absolute;left:40px;top:85px;width:460px;height:460px">${sz(logo,460)}</div>
   <div style="position:absolute;left:520px;top:150px">${wordmark(620)}</div>
   <div style="position:absolute;left:534px;top:385px;font:600 27px Geist;line-height:1.2;white-space:nowrap">Memecoins on Ink that pay holders in stocks.</div>
   <div style="position:absolute;left:520px;top:438px">${blot('NVDAx',140,-8,62)}</div><div style="position:absolute;left:640px;top:458px">${blot('SPYx',120,9,70)}</div><div style="position:absolute;left:745px;top:433px">${blot('TSLAx',140,-12,62)}</div>
   <svg style="position:absolute;left:0;top:0" width="1200" height="630" viewBox="0 0 1200 630" fill="#ff4fa3" stroke="#14121a" stroke-width="6"><circle cx="1120" cy="80" r="12"/><circle cx="1160" cy="560" r="8"/><circle cx="40" cy="590" r="9"/><circle cx="560" cy="60" r="7"/></svg>
 </div>`,1200,630,'img/og.png','#0e1117');
 await b.close(); })();
