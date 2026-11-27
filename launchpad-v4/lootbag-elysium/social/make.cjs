// Draws the profile picture and the banner for X from the site's logo and colours:
//   node social/make.cjs        (needs Playwright; writes the PNGs beside this file)
// pfp: 1000x1000, the mark filling the square so X's round crop shows the logo itself.
// banner: 1500x500 (and 3000x1000). X lays the profile picture over the banner's lower left, so nothing sits there.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const INK = '#17132b', CREAM = '#fff5e4', SUN = '#ffd23f', TAN = '#ff7a1a', MINT = '#b9f3d4', LILAC = '#cfc2ff', PINK = '#ff8fb1';
const logo = fs.readFileSync(path.join(__dirname, '../site/img/logo.svg'), 'utf8');
// the ear alone (the logo without its disc), in any colour
const ear = (fill) => logo.replace(/<circle[^>]*fill="#17132b"[^>]*\/>/, '').split(CREAM).join(fill);
const FONT = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=DM+Sans:opsz,wght@9..40,500;9..40,700&display=swap">`;
const pfp = (bg, fg) => `${FONT}<body style="margin:0;width:1000px;height:1000px;background:${bg};display:grid;place-items:center"><div style="width:860px;height:860px">${ear(fg)}</div></body>`;
const banner = (dark) => { const bg = dark ? INK : CREAM, fg = dark ? CREAM : INK, sub = dark ? '#cfc8e6' : '#453f5e';
  return `${FONT}<body style="margin:0;width:1500px;height:500px;background:${bg};color:${fg};font-family:'DM Sans';overflow:hidden;position:relative">
  <div style="position:absolute;right:-120px;top:-60px;width:620px;height:620px;border-radius:50%;background:${dark ? SUN : INK}"></div>
  <div style="position:absolute;right:-62px;top:-2px;width:504px;height:504px">${ear(dark ? INK : CREAM)}</div>
  <div style="position:absolute;left:372px;top:78px;display:flex;gap:10px">
    ${[['On Elysium', LILAC], ['Paid in HYPE or KNTQ', MINT], ['Straight to the wallet', PINK]].map(([t, c]) => `<span style="height:38px;padding:0 16px;display:inline-flex;align-items:center;border-radius:999px;background:${c};color:${INK};border:3px solid ${INK};font:700 17px/1 'DM Sans';letter-spacing:.02em">${t}</span>`).join('')}</div>
  <h1 style="position:absolute;left:368px;top:138px;margin:0;font:800 80px/1 'Bricolage Grotesque';letter-spacing:-.035em;white-space:nowrap">Coins that <span style="background:${SUN};color:${INK};border-radius:14px;padding:0 .13em">feed</span></h1>
  <h1 style="position:absolute;left:368px;top:226px;margin:0;font:800 80px/1 'Bricolage Grotesque';letter-spacing:-.035em;white-space:nowrap">their holders.</h1>
  <p style="position:absolute;left:372px;top:334px;margin:0;font:500 25px/1.3 'DM Sans';color:${sub}">Every trade pays the people who hold the coin.</p>
  <div style="position:absolute;left:108px;top:66px;font:800 44px/1 'Bricolage Grotesque';letter-spacing:-.02em">Ambrosia</div>
  </body>`; };
(async () => {
  const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
  const shot = async (html, w, h, scale, file) => { const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale }); await p.setContent(html, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); await p.screenshot({ path: path.join(__dirname, file) }); await p.close(); };
  await shot(pfp(INK, CREAM), 1000, 1000, 1, 'x-pfp.png');
  await shot(pfp(SUN, INK), 1000, 1000, 1, 'x-pfp-yellow.png');
  await shot(banner(false), 1500, 500, 1, 'x-banner.png');
  await shot(banner(false), 1500, 500, 2, 'x-banner@2x.png');
  await shot(banner(true), 1500, 500, 1, 'x-banner-dark.png');
  await shot(banner(true), 1500, 500, 2, 'x-banner-dark@2x.png');
  await b.close(); console.log('written to', __dirname);
})();
