// The link-preview picture (og.png) and the home-screen icon, drawn from the site's logo:  node brand/og.cjs
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const out = process.argv[2] || require('path').join(__dirname, '../site/img'), logo = fs.readFileSync(out + '/logo.svg', 'utf8'); const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY } });
  const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p.setContent(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:wght@500;700&display=swap">
    <body style="margin:0;width:1200px;height:630px;background:#fff5e4;color:#17132b;font-family:'DM Sans';overflow:hidden;position:relative">
    <div style="position:absolute;inset:26px;border:5px solid #17132b;border-radius:38px;background:#fff5e4;box-shadow:12px 12px 0 #17132b"></div>
    <div style="position:absolute;left:84px;top:78px;display:flex;align-items:center;gap:18px"><div style="width:74px;height:74px">${logo}</div><b style="font:800 54px/1 'Bricolage Grotesque';letter-spacing:-.02em">KinetiqPump</b></div>
    <h1 style="position:absolute;left:84px;top:196px;margin:0;font:800 104px/.98 'Bricolage Grotesque';letter-spacing:-.035em;width:820px">Coins that <span style="background:#ffd23f;border-radius:16px;padding:0 .12em">feed</span> their holders.</h1>
    <p style="position:absolute;left:84px;bottom:76px;margin:0;font:500 30px/1.3 'DM Sans';color:#453f5e">On Elysium. Paid in HYPE or KNTQ, straight to the wallet.</p>
    <div style="position:absolute;right:92px;top:150px;width:230px;height:230px;transform:rotate(8deg)">${logo}</div></body>`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800); await p.screenshot({ path: out + '/og.png' });
  await p.setViewportSize({ width: 180, height: 180 }); await p.setContent(`<body style="margin:0;width:180px;height:180px;background:#fff5e4;display:grid;place-items:center"><div style="width:148px;height:148px">${logo}</div></body>`);
  await p.screenshot({ path: out + '/apple-icon.png' }); await b.close(); })();
