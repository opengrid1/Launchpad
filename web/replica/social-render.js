const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{ const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--proxy-server='+process.env.HTTPS_PROXY,'--ignore-certificate-errors']});
 const logo=fs.readFileSync('../site2/img/logo.svg','utf8'); const def=fs.readFileSync('t-default.svg','utf8');
 const blobPath=def.match(/<path d="(M[^"]+)"\/>/)[1]; const drops=def.match(/<circle[^>]+\/>(<circle[^>]+\/>)*/)[0];
 const sz=(svg,s)=>svg.replace(/width="\d+" height="\d+"/,`width="${s}" height="${s}"`);
 // sticker blot with a word in it (same construction as the default token logo)
 const blot=(txt,s,rot=-5,fs=78)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${s}" height="${s}"><g transform="rotate(${rot} 128 128)">
  <g fill="#f3f5f9" stroke="#f3f5f9" stroke-width="18" stroke-linejoin="round"><path d="${blobPath}"/>${drops}</g>
  <g fill="#14121a" stroke="#14121a" stroke-width="7" stroke-linejoin="round"><path d="${blobPath}"/>${drops}</g>
  <g fill="#ff4fa3"><path d="${blobPath}"/>${drops}</g>
  <path fill="#ff7cbb" d="M78 86c8-18 26-30 48-30-20 6-34 20-40 40-2 8-12 8-12-2 0-3 2-5 4-8z"/>
  <text x="128" y="158" text-anchor="middle" font-family="'Titan One'" font-size="${fs}" fill="#f3f5f9" stroke="#14121a" stroke-width="9" stroke-linejoin="round" paint-order="stroke" transform="rotate(-3 128 140)">${txt}</text></g></svg>`;
 const font='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titan+One&family=Geist:wght@500;600;700&display=swap">';
 const shot=async(html,w,h,file,scale)=>{ const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:scale||1}); await p.setContent(`<!doctype html><html><head>${font}<style>html,body{margin:0;background:#0e1117;width:${w}px;height:${h}px;overflow:hidden}</style></head><body>${html}</body></html>`); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(600); await p.screenshot({path:file}); await p.close(); };
 const abs=(x,y,inner,extra='')=>`<div style="position:absolute;left:${x}px;top:${y}px;${extra}">${inner}</div>`;
 // PFP 1000x1000: Inky centred (safe for circular crop), small ink drops around
 await shot(`<div style="position:relative;width:1000px;height:1000px;background:#0e1117">
   ${abs(130,110,sz(logo,760))}
   ${abs(150,690,blot('ink',150,12,88))}${abs(700,120,blot('pump',170,-14,70))}
   <svg style="position:absolute;left:0;top:0" width="1000" height="1000" viewBox="0 0 1000 1000" fill="#ff4fa3" stroke="#14121a" stroke-width="7"><circle cx="112" cy="300" r="22"/><circle cx="880" cy="760" r="18"/><circle cx="760" cy="880" r="10"/><circle cx="170" cy="200" r="9"/></svg>
 </div>`,1000,1000,'../site2/img/pfp.png');
 // X banner 1500x500, rendered at 2x. Avatar overlaps the bottom-left on X, so nothing important lives there.
 const banner=`<div style="position:relative;width:1500px;height:500px;background:#0e1117;color:#f3f5f9;font-family:Geist;overflow:hidden">
   ${abs(1110,22,sz(logo,450))}
   ${abs(90,135,`<div style="font:400 118px 'Titan One';line-height:1;letter-spacing:-2px">inkypump</div>`)}
   ${abs(96,285,`<div style="font:600 36px Geist;line-height:1.2;width:900px">Memecoins on Ink that pay holders in stocks.</div>`)}
   
   <svg style="position:absolute;left:0;top:0" width="1500" height="500" viewBox="0 0 1500 500" fill="#ff4fa3" stroke="#14121a" stroke-width="6"><circle cx="1000" cy="60" r="12"/><circle cx="1480" cy="110" r="8"/><circle cx="900" cy="400" r="9"/><circle cx="1440" cy="470" r="14"/><circle cx="1090" cy="470" r="7"/></svg>
 </div>`;
 await shot(banner,1500,500,'../site2/img/banner-x.png',2);
 await shot(banner,1500,500,'../site2/img/banner-x-1x.png',1);
 await b.close(); })();
