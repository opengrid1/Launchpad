// Zappy (Base, v2 contracts only) through the website, on a fresh Base mainnet fork (node at 127.0.0.1:8549) holding
// the live Zappy contracts. Serves dist/zappy and its /api functions with the RPC pointed at the fork, drives the pages
// with a wallet that forwards to the node: launch an ETH-pair coin from the form with an opening buy, buy and sell it
// from the token page, pay out its creator fees from the profile page, and check the admin page's v2 card.
//   node test/site-zappy.e2e.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const SP = '/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad', ROOT = path.join(__dirname, '../dist/zappy'), OUT = SP + '/shots';
const NODE = 'http://127.0.0.1:8549', USER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906', ADMIN = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const dep = require('../deployments/zappy-v2-base.json');
Object.assign(process.env, { BASE_RPC: NODE, BASE_V2: '1', LQF_ONLY: 'base', LOCAL_UPLOAD_DIR: SP + '/uploads', LOCAL_UPLOAD_BASE: '', CRON_SECRET: 'local', SWEEP_MIN_HYPE: '0.0000001', SWEEP_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' });
delete process.env.BLOB_READ_WRITE_TOKEN;
const { ethers } = require(path.join(__dirname, '../site/node_modules/ethers'));
const API = { state: require(ROOT + '/api/state.js'), upload: require(ROOT + '/api/upload.js'), sweep: require(ROOT + '/api/sweep.js') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
let WALLET = USER;
const srv = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  const api = p.match(/^\/api\/(\w+)$/); if (api && API[api[1]]) { req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); return API[api[1]](req, res); }
  if (p.startsWith('/logos/')) { const f = path.join(SP, 'uploads', p); if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] }); return fs.createReadStream(f).pipe(res); } }
  if (p.startsWith('/token/')) p = '/token.html'; if (p === '/') p = '/index.html'; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f); if (p === '/config.js') body = String(body).replace("rpc: 'https://mainnet.base.org'", `rpc: '${NODE}'`);
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});
srv.listen(8794, async () => {
  let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  const P = new ethers.JsonRpcProvider(NODE, undefined, { staticNetwork: true, cacheTimeout: -1 });
  await P.send('hardhat_setBalance', [USER, '0x' + (50n * 10n ** 18n).toString(16)]);
  // launches on, from the deployer (still the owner until the admin accepts)
  await P.send('hardhat_impersonateAccount', [dep.deployer]); await P.send('hardhat_setBalance', [dep.deployer, '0x' + (10n ** 18n).toString(16)]);
  const h = await P.send('eth_sendTransaction', [{ from: dep.deployer, to: dep.factory, data: new ethers.Interface(['function setLaunchEnabled(bool)']).encodeFunctionData('setLaunchEnabled', [true]) }]); await P.waitForTransaction(h);
  const erc = (a) => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)'], P);
  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.exposeFunction('walletAddr', () => WALLET);
  await ctx.addInitScript(({ NODE }) => {
    let id = 0; const fw = async (method, params) => { const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [await window.walletAddr()]; if (method === 'eth_chainId') return '0x2105'; if (method === 'net_version') return '8453';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      return fw(method, params || []);
    } };
    window.__toasts = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }));
  }, { NODE });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  const toasts = async () => pg.evaluate(() => (window.__toasts || []).join(' | '));
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await pg.waitForTimeout(500); } return false; };
  const B = 'http://127.0.0.1:8794';
  const connect = async () => { await pg.evaluate(() => APP.W.connect()).catch(() => {}); await pg.waitForTimeout(500); await pg.click('[data-i="0"]').catch(() => {}); await pg.waitForTimeout(1200); };
  try {
    await pg.goto(B + '/'); await pg.waitForTimeout(3000);
    ok(await pg.evaluate(() => DATA.mode === 'live' && Array.isArray(DATA.tokens())), 'board loads on Base: ' + (await pg.evaluate(() => DATA.tokens().length)) + ' coins');
    // launch with an opening buy
    await pg.goto(B + '/launch'); await pg.waitForTimeout(1500); await connect();
    await pg.click('#acc-desc .ah').catch(() => {}); await pg.setInputFiles('#f-img', SP + '/test-token.png'); await pg.waitForTimeout(300);
    await pg.fill('#f-name', 'Zap Test'); await pg.fill('#f-sym', 'zapt'); await pg.fill('#f-desc', 'A Zappy test coin on Base.');
    await pg.click('#next', { timeout: 1500 }).catch(() => {}); await pg.waitForTimeout(400);
    ok(!(await pg.isVisible('#f-bb')), 'no buyback & vest option on v2');
    await pg.fill('#f-dev', '0.0175'); await pg.waitForTimeout(300);
    await pg.screenshot({ path: OUT + '/zappy-launch.png', fullPage: true });
    await pg.click('#go'); const launched = await waitFor(async () => /\/token\/0x/.test(pg.url()), 120000);
    ok(launched, 'launched, on the token page ' + pg.url() + ' ' + (await toasts()).slice(-100));
    const coin = (pg.url().match(/0x[0-9a-f]{40}/i) || [''])[0].toLowerCase();
    await waitFor(() => pg.evaluate((a) => !!DATA.token(a), coin), 60000);
    const v = await pg.evaluate((a) => { const t = DATA.token(a); return t && { v: t.v, pairSym: t.pairSym, mcap: t.mcap, trades: t.trades }; }, coin);
    ok(v && v.v === 2 && v.pairSym === 'ETH' && v.mcap > 1.7 && v.mcap < 2.2 && v.trades === 1, 'coin on the board with its opening buy: ' + JSON.stringify(v));
    ok((await erc(coin).balanceOf(USER)) > 0n, 'opening buy coins in the wallet');
    // buy and sell from the page
    await P.send('evm_increaseTime', [15]); await P.send('evm_mine', []); await pg.waitForTimeout(4000);
    const b0 = await erc(coin).balanceOf(USER), qb = await pg.evaluate((a) => DATA.quoteBuy(a, 'hyper', 0.05), coin);
    await pg.fill('#t-amt', '0.05'); await pg.waitForTimeout(600); await pg.click('#t-go');
    ok(await waitFor(async () => /Bought/.test(await toasts()), 90000), 'buy from the page: ' + (await toasts()).slice(-80));
    const got = Number(ethers.formatEther((await erc(coin).balanceOf(USER)) - b0));
    ok(Math.abs(got / qb.tokens - 1) < 0.01, `buy quote ${qb.tokens.toFixed(0)} vs received ${got.toFixed(0)} (${((got / qb.tokens - 1) * 100).toFixed(3)}%)`);
    await pg.click('[data-s="sell"]'); await pg.waitForTimeout(300);
    const sellAmt = Math.floor(got / 2), qs = await pg.evaluate(([a, n]) => DATA.quoteSell(a, 'hyper', n), [coin, sellAmt]);
    const e0 = await P.getBalance(USER), blk0 = await P.getBlockNumber();
    await pg.fill('#t-amt', String(sellAmt)); await pg.waitForTimeout(300); await pg.click('#t-go');
    ok(await waitFor(async () => /Sold/.test(await toasts()), 120000), 'sell from the page: ' + (await toasts()).slice(-90));
    let gas = 0n; for (let b = blk0 + 1, top = await P.getBlockNumber(); b <= top; b++) { const bl = await P.getBlock(b, true); for (const tx of bl.prefetchedTransactions) if (tx.from.toLowerCase() === USER.toLowerCase()) { const rc = await P.getTransactionReceipt(tx.hash); gas += rc.gasUsed * rc.gasPrice + (rc.l1Fee ? BigInt(rc.l1Fee) : 0n); } }
    const back = Number(ethers.formatEther((await P.getBalance(USER)) + gas - e0));
    ok(Math.abs(back / qs.hype - 1) < 0.01, `sell quote ${qs.hype.toFixed(6)} vs received ${back.toFixed(6)} ETH`);
    await pg.screenshot({ path: OUT + '/zappy-token.png', fullPage: true });
    // creator payout from the profile
    await pg.goto(B + '/creator?tab=fees'); await pg.waitForTimeout(3000);
    await waitFor(async () => { await pg.click('[data-tab="fees"]').catch(() => {}); return !!(await pg.$('#p-claim')); }, 60000);
    const c0 = await P.getBalance(USER), blk1 = await P.getBlockNumber();
    await pg.click('#p-claim');
    ok(await waitFor(async () => /Claimed/.test(await toasts()), 90000), 'payout from the profile: ' + (await toasts()).slice(-60));
    let g2 = 0n; for (let b = blk1 + 1, top = await P.getBlockNumber(); b <= top; b++) { const bl = await P.getBlock(b, true); for (const tx of bl.prefetchedTransactions) if (tx.from.toLowerCase() === USER.toLowerCase()) { const rc = await P.getTransactionReceipt(tx.hash); g2 += rc.gasUsed * rc.gasPrice; } }
    ok((await P.getBalance(USER)) + g2 > c0, `creator received ${ethers.formatEther((await P.getBalance(USER)) + g2 - c0)} ETH`);
    // admin page as the admin wallet: the v2 card with Accept buttons
    WALLET = ADMIN; await pg.goto(B + '/admin'); await pg.waitForTimeout(1500); await connect(); await pg.waitForTimeout(3000);
    const acc = await pg.$$eval('[data-accept]', (x) => x.map((e) => e.dataset.accept));
    ok(acc.length === 3, 'admin v2 card offers Accept for ' + acc.join(', '));
    await pg.screenshot({ path: OUT + '/zappy-admin.png', fullPage: true });
  } catch (e) { ok(false, 'exception ' + e.message.slice(0, 300)); await pg.screenshot({ path: OUT + '/zappy-fail.png', fullPage: true }); }
  ok(!errs.length, 'no console errors ' + errs.slice(0, 5).join(' || '));
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); await br.close(); srv.close(); process.exit(fails ? 1 : 0);
});
