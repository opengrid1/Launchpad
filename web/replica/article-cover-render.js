const { chromium } = require('playwright'); const fs=require('fs'); const wordmark=require('./wordmark.js');
(async()=>{ const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--proxy-server='+process.env.HTTPS_PROXY,'--ignore-certificate-errors']});
 const logo=fs.readFileSync('img/logo.svg','utf8'); const def=fs.readFileSync('img/t-default.svg','utf8');
 const blobPath=def.match(/<path d="(M[^"]+)"\/>/)[1]; const drops=def.match(/<circle[^>]+\/>(<circle[^>]+\/>)*/)[0];
 const sz=(svg,s)=>svg.replace(/width="\d+" height="\d+"/,`width="${s}" height="${s}"`);
 const blot=(txt,s,rot=-5,fs=78)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${s}" height="${s}"><g transform="rotate(${rot} 128 128)"><g fill="#f3f5f9" stroke="#f3f5f9" stroke-width="18" stroke-linejoin="round"><path d="${blobPath}"/>${drops}</g><g fill="#14121a" stroke="#14121a" stroke-width="7" stroke-linejoin="round"><path d="${blobPath}"/>${drops}</g><g fill="#ff4fa3"><path d="${blobPath}"/>${drops}</g><path fill="#ff7cbb" d="M78 86c8-18 26-30 48-30-20 6-34 20-40 40-2 8-12 8-12-2 0-3 2-5 4-8z"/><text x="128" y="158" text-anchor="middle" font-family="'Titan One'" font-size="${fs}" fill="#f3f5f9" stroke="#14121a" stroke-width="9" stroke-linejoin="round" paint-order="stroke" transform="rotate(-3 128 140)">${txt}</text></g></svg>`;
 const ink='data:image/png;base64,'+fs.readFileSync('img/ink.png').toString('base64');
 const font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titan+One&family=Geist:wght@500;600;700&display=swap">';
 const p=await b.newPage({viewport:{width:2000,height:800},deviceScaleFactor:1});
 const abs=(x,y,inner,extra='')=>`<div style="position:absolute;left:${x}px;top:${y}px;${extra}">${inner}</div>`;
 await p.setContent(`<!doctype html><html><head>${font}<style>html,body{margin:0;background:#0e1117;width:2000px;height:800px;overflow:hidden;font-family:Geist}</style></head><body><div style="position:relative;width:2000px;height:800px;background:#0e1117;color:#f3f5f9">
  ${abs(100,235,wordmark(760))}
  ${abs(122,520,`<div style="display:inline-flex;align-items:center;gap:12px;font:500 26px Geist;color:#c3c9d6;padding:12px 20px;border-radius:999px;border:1px solid #1e2430;background:#141821"><img src="${ink}" style="width:30px;height:30px;border-radius:50%">Built on Ink</div>`)}
  ${abs(1040,470,blot('NVDAx',180,-8,62))}${abs(1180,520,blot('SPYx',150,9,70))}${abs(1295,460,blot('TSLAx',180,-12,62))}
  ${abs(1420,80,sz(logo,600))}
  <svg style="position:absolute;left:0;top:0" width="2000" height="800" viewBox="0 0 2000 800" fill="#ff4fa3" stroke="#14121a" stroke-width="6"><circle cx="1000" cy="90" r="12"/><circle cx="1960" cy="620" r="9"/><circle cx="980" cy="700" r="7"/><circle cx="60" cy="700" r="14"/><circle cx="760" cy="160" r="8"/><circle cx="1380" cy="130" r="9"/></svg>
 </div></body></html>`);
 await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(700); await p.screenshot({path:'img/article-cover.png'}); await b.close(); })();
