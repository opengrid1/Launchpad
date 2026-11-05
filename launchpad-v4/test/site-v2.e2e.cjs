// BuzzPad v2 through the website, on a fresh Ethereum mainnet fork (node at 127.0.0.1:8548) holding the live v1 and v2
// contracts and PBEE (XMR pair). Serves the BuzzPad build (dist/buzzpad) and its /api functions with the RPC pointed
// at the fork, drives the pages with a wallet that forwards to the node, and checks the chain:
// PBEE listed as a v2 XMR-pair coin; buy and sell PBEE from the token page (ETH in, ETH out); launch an AZTEC-pair coin
// from the launch form; buy it; pay out its creator fees from the profile page.
//   node test/site-v2.e2e.cjs
const http = require('fs') && require('http'), fs = require('fs'), path = require('path');
const SP = '/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad', ROOT = path.join(__dirname, '../dist/buzzpad'), OUT = SP + '/shots';
const NODE = 'http://127.0.0.1:8548', USER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const PBEE = '0x4e290806d8e085c29490e5bd168c3330ff5c438b', AZTEC = '0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2';
Object.assign(process.env, { ETH_RPC: NODE, ETH_FACTORY: '0x341585f9E00bB9fAcf561957075C7e5b7d529134', ETH_HOOK: '0xdb96Eb48C3BC9E3ECaf3bA119D48A34aa15DA044', ETH_LOCKER: '0x78508fFc10c9D776aa9816BE9974275513E2DA5e', ETH_ESCROW: '0x98B341bDF817658053a86c7e3Cb01E3D629902A5', ETH_VAULT: '0xDA5B1B6E70e0C67Ee73fec6E62916048602b32E4', ETH_FROM_BLOCK: '26343106', LQF_ONLY: 'ethereum', LOCAL_UPLOAD_DIR: SP + '/uploads', LOCAL_UPLOAD_BASE: '', CRON_SECRET: 'local', SWEEP_MIN_HYPE: '0.0000001', SWEEP_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' });
delete process.env.BLOB_READ_WRITE_TOKEN;
const { ethers } = require(path.join(__dirname, '../site/node_modules/ethers'));
const API = { state: require(ROOT + '/api/state.js'), upload: require(ROOT + '/api/upload.js'), sweep: require(ROOT + '/api/sweep.js') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  const api = p.match(/^\/api\/(\w+)$/); if (api && API[api[1]]) { req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); return API[api[1]](req, res); }
  if (p.startsWith('/logos/')) { const f = path.join(SP, 'uploads', p); if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] }); return fs.createReadStream(f).pipe(res); } }
  if (p.startsWith('/token/')) p = '/token.html'; if (p === '/') p = '/index.html'; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f); if (p === '/config.js') body = String(body).replace("rpc: 'https://ethereum-rpc.publicnode.com'", `rpc: '${NODE}'`);
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});
srv.listen(8792, async () => {
  let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  const P = new ethers.JsonRpcProvider(NODE, undefined, { staticNetwork: true, cacheTimeout: -1 });
  await P.send('hardhat_setBalance', [USER, '0x' + (50n * 10n ** 18n).toString(16)]);
  const erc = (a) => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)'], P);
  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(({ NODE, USER }) => {
    let id = 0; const fw = async (method, params) => { const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [USER]; if (method === 'eth_chainId') return '0x1'; if (method === 'net_version') return '1';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      return fw(method, params || []);
    } };
    window.__toasts = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }));
  }, { NODE, USER });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  const toasts = async () => pg.evaluate(() => (window.__toasts || []).join(' | '));
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await pg.waitForTimeout(500); } return false; };
  const B = 'http://127.0.0.1:8792';
  const connect = async () => { await pg.evaluate(() => APP.W.connect()).catch(() => {}); await pg.waitForTimeout(500); await pg.click('[data-i="0"]').catch(() => {}); await pg.waitForTimeout(1200); };
  try {
    // 1. the board lists PBEE as a v2 XMR-pair coin
    await pg.goto(B + '/'); await waitFor(() => pg.evaluate((a) => !!DATA.token(a), PBEE), 90000);
    const v = await pg.evaluate((a) => { const t = DATA.token(a); return t && { v: t.v, pairSym: t.pairSym, mcapUsd: t.mcapUsd, mcap: t.mcap }; }, PBEE);
    ok(v && v.v === 2 && v.pairSym === 'XMR' && v.mcapUsd > 3000 && v.mcapUsd < 20000, 'PBEE on the board: ' + JSON.stringify(v));
    await pg.screenshot({ path: OUT + '/v2-home.png' });

    // 2. buy PBEE from the token page with ETH
    await pg.goto(B + '/token/' + PBEE); await pg.waitForTimeout(2500); await connect();
    ok(/XMR pair · Ethereum · v2/.test(await pg.textContent('#t-meta')), 'token page: ' + (await pg.textContent('#t-meta')).replace(/\s+/g, ' ').slice(0, 80));
    const b0 = await erc(PBEE).balanceOf(USER);
    const qb = await pg.evaluate((a) => DATA.quoteBuy(a, 'hyper', 0.05), PBEE);
    await pg.fill('#t-amt', '0.05'); await pg.waitForTimeout(600); await pg.click('#t-go');
    ok(await waitFor(async () => /Bought/.test(await toasts()), 90000), 'buy from the page: ' + (await toasts()).slice(-90));
    const got = Number(ethers.formatEther((await erc(PBEE).balanceOf(USER)) - b0));
    ok(Math.abs(got / qb.tokens - 1) < 0.01, `buy quote ${qb.tokens.toFixed(0)} vs received ${got.toFixed(0)} (${((got / qb.tokens - 1) * 100).toFixed(3)}%)`);
    await pg.screenshot({ path: OUT + '/v2-token.png', fullPage: true });

    // 3. sell half back to ETH
    await pg.click('[data-s="sell"]'); await pg.waitForTimeout(300);
    const sellAmt = Math.floor(got / 2), qs = await pg.evaluate(([a, n]) => DATA.quoteSell(a, 'hyper', n), [PBEE, sellAmt]);
    const e0 = await P.getBalance(USER), blk0 = await P.getBlockNumber();
    await pg.fill('#t-amt', String(sellAmt)); await pg.waitForTimeout(300); await pg.click('#t-go');
    ok(await waitFor(async () => /Sold/.test(await toasts()), 120000), 'sell from the page: ' + (await toasts()).slice(-110));
    let gas = 0n; for (let b = blk0 + 1, top = await P.getBlockNumber(); b <= top; b++) { const bl = await P.getBlock(b, true); for (const tx of bl.prefetchedTransactions) if (tx.from.toLowerCase() === USER.toLowerCase()) { const rc = await P.getTransactionReceipt(tx.hash); gas += rc.gasUsed * rc.gasPrice; } }
    const back = Number(ethers.formatEther((await P.getBalance(USER)) + gas - e0));
    if (!(qs.hype > 0)) console.log('  debug quoteSell', JSON.stringify(qs), await pg.evaluate((a) => { const t = DATA.token(a); return JSON.stringify({ v: t && t.v, pair: t && t.pair, pairSym: t && t.pairSym }); }, PBEE));
    ok(Math.abs(back / qs.hype - 1) < 0.01, `sell quote ${qs.hype.toFixed(6)} ETH vs received ${back.toFixed(6)} ETH (${((back / qs.hype - 1) * 100).toFixed(3)}%)`);

    // 4. launch an AZTEC-pair coin from the form
    await pg.goto(B + '/launch'); await pg.waitForTimeout(1500); await connect();
    await pg.click('#acc-desc .ah').catch(() => {}); await pg.setInputFiles('#f-img', SP + '/test-token.png'); await pg.waitForTimeout(300);
    await pg.fill('#f-name', 'Aztec Bee'); await pg.fill('#f-sym', 'azb'); await pg.fill('#f-desc', 'A v2 test coin paired with AZTEC.');
    await pg.click('#next', { timeout: 1500 }).catch(() => {}); await pg.waitForTimeout(400);
    ok(await pg.$('[data-pair="aztec"]') !== null, 'pair picker shows ' + (await pg.$$eval('[data-pair]', (x) => x.map((e) => e.textContent).join(', '))));
    await pg.click('[data-pair="aztec"]'); await pg.waitForTimeout(300);
    ok(await pg.$eval('#f-dev', (e) => e.disabled), 'opening buy disabled for the AZTEC pair');
    await pg.screenshot({ path: OUT + '/v2-launch.png', fullPage: true });
    await pg.click('#go'); const launched = await waitFor(async () => /\/token\/0x/.test(pg.url()), 120000);
    ok(launched, 'launched, on the token page ' + pg.url() + ' ' + (await toasts()).slice(-100));
    const coin = (pg.url().match(/0x[0-9a-f]{40}/i) || [''])[0].toLowerCase();
    await waitFor(() => pg.evaluate((a) => !!DATA.token(a), coin), 60000);
    const cv = await pg.evaluate((a) => { const t = DATA.token(a); return t && { v: t.v, pairSym: t.pairSym, mcapUsd: Math.round(t.mcapUsd) }; }, coin);
    ok(cv && cv.v === 2 && cv.pairSym === 'AZTEC', 'the new coin is a v2 AZTEC-pair coin: ' + JSON.stringify(cv));

    // 5. buy it after the snipe window, then pay out its fees from the profile page
    await P.send('evm_increaseTime', [15]); await P.send('evm_mine', []); await pg.waitForTimeout(4000);
    const c0 = await erc(coin).balanceOf(USER);
    await pg.fill('#t-amt', '0.05'); await pg.waitForTimeout(600); await pg.click('#t-go');
    ok(await waitFor(async () => /Bought/.test(await toasts()), 90000), 'bought the AZTEC-pair coin with ETH');
    ok((await erc(coin).balanceOf(USER)) > c0, 'coins received');
    const az0 = await erc(AZTEC).balanceOf(USER);
    await pg.goto(B + '/creator?tab=fees'); await pg.waitForTimeout(3000);
    await waitFor(async () => { await pg.click('[data-tab="fees"]').catch(() => {}); return !!(await pg.$('#p-claim')); }, 60000);
    const cr = await pg.evaluate((w) => DATA.creator(w), USER.toLowerCase());
    ok(cr.payout > 0, 'creator payout pending: ' + cr.payout.toFixed(6) + ' ETH worth');
    await pg.screenshot({ path: OUT + '/v2-fees.png', fullPage: true });
    await pg.click('#p-claim');
    ok(await waitFor(async () => (await erc(AZTEC).balanceOf(USER)) > az0, 90000), `payout paid AZTEC to the creator: +${ethers.formatEther((await erc(AZTEC).balanceOf(USER)) - az0)}`);

    // 6. the keeper pays out what is left on every v2 pool
    const kres = await new Promise((done) => { const r = { setHeader() {}, end(b) { done(JSON.parse(b)); } }; API.sweep({ headers: { authorization: 'Bearer local' } }, r); });
    ok(kres['ethereum-v2'] && !kres['ethereum-v2'].error, 'keeper v2 payout: ' + JSON.stringify(kres['ethereum-v2']).slice(0, 160));
  } catch (e) { ok(false, 'exception ' + e.message.slice(0, 300)); await pg.screenshot({ path: OUT + '/v2-fail.png', fullPage: true }); }
  ok(!errs.length, 'no console errors ' + errs.slice(0, 5).join(' || '));
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); await br.close(); srv.close(); process.exit(fails ? 1 : 0);
});
