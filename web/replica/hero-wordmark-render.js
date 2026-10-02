const { chromium } = require('playwright'); const wordmark=require('./wordmark.js');
(async()=>{ const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--proxy-server='+process.env.HTTPS_PROXY,'--ignore-certificate-errors']});
 const p=await b.newPage({viewport:{width:470,height:170},deviceScaleFactor:3});
 await p.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Titan+One&display=swap"><style>html,body{margin:0;background:transparent;width:470px;height:170px;overflow:hidden}div{position:absolute;left:20px;top:10px}</style></head><body><div>${wordmark(430)}</div></body></html>`);
 await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(600); await p.screenshot({path:'img/hero-wordmark.png',omitBackground:true}); await b.close(); })();
