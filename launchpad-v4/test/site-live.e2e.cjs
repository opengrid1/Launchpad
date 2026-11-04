// LiquidFi site E2E on the local chain 99901 (Elysium bytecode, Uniswap UR/Quoter, our stack): serves the site and
// its /api functions like Vercel, drives the pages with a wallet that forwards to the node, and checks the chain.
// E2E_NET=ethereum runs the BuzzPad build (dist/buzzpad) on a local Ethereum mainnet fork instead (chain id 1, ETH).
const http = require('http'), fs = require('fs'), path = require('path');
const ETH = process.env.E2E_NET === 'ethereum';
const SP = '/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad', ROOT = ETH ? '/home/user/Launchpad/launchpad-v4/dist/buzzpad' : '/home/user/Launchpad/launchpad-v4/site', OUT = SP + '/shots';
const NODE = 'http://127.0.0.1:8548', D = require(SP + (ETH ? '/lqf-eth-local.json' : '/lqf-local.json'));
const N = ETH ? { key: 'ethereum', hex: '0x1', id: '1', name: 'Ethereum', quote: 'ETH', start: 1.75, dev: '0.0175', buy: 0.0105, router: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', logo: '/img/eth.svg', explorer: 'https://etherscan.io' }
  : { key: 'elysium', hex: '0x1863d', id: '99901', name: 'Elysium', quote: 'HYPE', start: 50, dev: '0.5', buy: 0.3, router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45', logo: '/img/hyper.png', explorer: 'https://scan.elysp.com/#' };
const USER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // hardhat account 3
if (ETH) Object.assign(process.env, { ETH_RPC: NODE, ETH_FACTORY: D.factory, ETH_HOOK: D.hook, ETH_LOCKER: D.locker, ETH_ESCROW: D.feeEscrow, ETH_VAULT: D.buybackVault, ETH_FROM_BLOCK: String(D.fromBlock), SWEEP_MIN_HYPE: '0.00001' });
Object.assign(process.env, { ELYSIUM_RPC: NODE, LQF_FACTORY: D.factory, LQF_HOOK: D.hook, LQF_LOCKER: D.locker, LQF_ESCROW: D.feeEscrow, LQF_VAULT: D.buybackVault, LQF_FROM_BLOCK: "0", LOCAL_UPLOAD_DIR: SP + '/uploads', LOCAL_UPLOAD_BASE: '', DIRECT_SEND: '1', LQF_ONLY: N.key, CRON_SECRET: 'local', SWEEP_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' });
const { ethers } = require(ROOT + '/node_modules/ethers');
const API = { state: require(ROOT + '/api/state.js'), upload: require(ROOT + '/api/upload.js'), sweep: require(ROOT + '/api/sweep.js') };
const K = { factory: D.factory, hook: D.hook, locker: D.locker, escrow: D.feeEscrow, vault: D.buybackVault, poolManager: D.poolManager, positionManager: D.positionManager, multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: N.router, quoter: ETH ? '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203' : '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5' };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  const api = p.match(/^\/api\/(\w+)$/); if (api && API[api[1]]) { req.query = {}; return API[api[1]](req, res); }
  if (p.startsWith('/logos/')) { const f = path.join(SP, 'uploads', p); if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] }); return fs.createReadStream(f).pipe(res); } }
  if (p.startsWith('/token/')) p = '/token.html'; if (p === '/') p = '/index.html'; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f); if (p === '/config.js') body = String(body).replace(/chains: \[[\s\S]*?\n  \],\n/, () => `chains: [ { key: '${N.key}', evm: true, id: ${N.id}, hex: '${N.hex}', name: '${N.name}', short: '${N.name}', quote: '${N.quote}', rpc: '${NODE}', explorer: '${N.explorer}', logo: '${N.logo}', blockSec: 1, main: true, contracts: ${JSON.stringify(K)} } ],\n`);
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});
srv.listen(8791, async () => {
  let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  const P = new ethers.JsonRpcProvider(NODE, undefined, { staticNetwork: true, cacheTimeout: -1 });
  const erc = (a) => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)'], P);
  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(({ NODE, USER, N }) => {
    let id = 0; const fw = async (method, params) => { const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [USER]; if (method === 'eth_chainId') return N.hex; if (method === 'net_version') return N.id;
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      return fw(method, params || []);
    } };
    window.__toasts = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }));
  }, { NODE, USER, N });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  const toasts = async () => (await pg.evaluate(() => (window.__toasts || []).join(' | ')));
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await pg.waitForTimeout(500); } return false; };
  const B = 'http://127.0.0.1:8791';
  try {
    if (process.env.DEBUG_BUY) { await pg.goto(B + '/token/' + process.env.DEBUG_BUY); await pg.waitForTimeout(2500); await pg.evaluate(() => APP.W.connect()); await pg.waitForTimeout(500); await pg.click('[data-i="0"]').catch(() => {}); await pg.waitForTimeout(1500);
      const r = await pg.evaluate(async (a) => { try { return await DATA.buy(a, 'hyper', 0.3, 0); } catch (e) { return 'ERR ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | '); } }, process.env.DEBUG_BUY); console.log('DEBUG', JSON.stringify(r)); throw new Error('debug done'); }
    // 1. empty board
    await pg.goto(B + '/'); await pg.waitForTimeout(2500); await pg.screenshot({ path: OUT + '/live-home-empty.png' });
    ok(await pg.evaluate(() => DATA.mode === 'live' && DATA.tokens().length === 0), 'live data layer, empty board');
    // 2. launch through the form
    await pg.goto(B + '/launch'); await pg.waitForTimeout(1200);
    await pg.click('#acc-desc .ah').catch(() => {}); await pg.setInputFiles('#f-img', SP + '/test-token.png'); await pg.waitForTimeout(300);
    await pg.fill('#f-name', 'Liquid Test'); await pg.fill('#f-sym', 'lqt'); await pg.fill('#f-desc', 'The first live test on the local chain.');
    await pg.click('#next', { timeout: 1500 }).catch(() => {}); await pg.waitForTimeout(400); await pg.fill('#f-dev', N.dev); await pg.fill('#f-tax', '2'); await pg.waitForTimeout(300);
    await pg.click('#go'); await pg.waitForTimeout(500); await pg.click('[data-i="0"]').catch(() => {}); await pg.waitForTimeout(1500);
    await pg.click('#go'); const launched = await waitFor(async () => /\/token\/0x/.test(pg.url()), 90000);
    ok(launched, 'launch redirected to the token page ' + pg.url() + ' ' + (await toasts()));
    const addr = (pg.url().match(/0x[0-9a-f]{40}/i) || [''])[0].toLowerCase();
    await waitFor(async () => (await pg.textContent('#t-name')) === 'Liquid Test', 30000);
    ok((await pg.textContent('#t-name')) === 'Liquid Test', 'token page shows the launched token');
    const v0 = await pg.evaluate((a) => { const t = DATA.token(a); return { mcap: t.mcap, trades: t.trades, holders: DATA.holders(a).map((h) => [h.wallet, Math.round(h.bal)]), img: t.img }; }, addr);
    ok(v0.trades === 1 && v0.holders.some(([w]) => w === USER.toLowerCase()), `opening buy indexed: ${v0.trades} trade, holders ${JSON.stringify(v0.holders.slice(0, 3))}`);
    ok(v0.mcap > N.start * 0.98 && v0.mcap < N.start * 1.2, `market cap just above the ${N.start} ${N.quote} start: ` + v0.mcap.toFixed(4));
    ok(/^\/logos\/[0-9a-f]{40}\.(webp|png)$/.test(v0.img), 'logo uploaded and stored onchain: ' + v0.img);
    const onchainBal = Number(ethers.formatEther(await erc(addr).balanceOf(USER)));
    await pg.screenshot({ path: OUT + '/live-token.png', fullPage: true });
    // 3. buy N.buy of the quote coin: quote vs result
    await pg.waitForTimeout(11000); // past the 10 s snipe window
    const qb = await pg.evaluate(([a, n]) => DATA.quoteBuy(a, 'hyper', n), [addr, N.buy]);
    await pg.fill('#t-amt', String(N.buy)); await pg.waitForTimeout(600); console.log('  panel:', JSON.stringify(await pg.evaluate(() => ({ go: document.querySelector('#t-go').textContent, dis: document.querySelector('#t-go').disabled, conn: APP.W.connected, bal: DATA.hypeBalance('hyper'), ctl: (document.querySelector('#t-ctl')||{}).textContent })))); await pg.click('#t-go');
    const bought = await waitFor(async () => /Bought/.test(await toasts()), 60000); ok(bought, 'buy through the UniversalRouter: ' + (await toasts()).slice(-80));
    const afterBuy = Number(ethers.formatEther(await erc(addr).balanceOf(USER)));
    const got = afterBuy - onchainBal; ok(Math.abs(got / qb.tokens - 1) < 0.002, `quote ${qb.tokens.toFixed(0)} vs received ${got.toFixed(0)} tokens (${((got / qb.tokens - 1) * 100).toFixed(4)}%)`);
    await waitFor(async () => pg.evaluate((a) => DATA.token(a).trades === 2, addr), 30000);
    ok(await pg.evaluate((a) => DATA.token(a).trades === 2, addr), 'buy indexed as the second trade');
    // 4. sell half (token approval + Permit2 + swap)
    await pg.click('[data-s="sell"]'); await pg.waitForTimeout(300); const sellAmt = Math.floor(got / 2);
    const qs = await pg.evaluate(([a, n]) => DATA.quoteSell(a, 'hyper', n), [addr, sellAmt]);
    const hype0 = Number(ethers.formatEther(await P.getBalance(USER))), blk0 = await P.getBlockNumber();
    await pg.fill('#t-amt', String(sellAmt)); await pg.waitForTimeout(300); await pg.click('#t-go');
    const sold = await waitFor(async () => /Sold/.test(await toasts()), 90000); ok(sold, 'sell with approvals: ' + (await toasts()).slice(-100));
    let gasPaid = 0n; for (let b = blk0 + 1, top = await P.getBlockNumber(); b <= top; b++) { const bl = await P.getBlock(b, true); for (const tx of bl.prefetchedTransactions) if (tx.from.toLowerCase() === USER.toLowerCase()) { const rc = await P.getTransactionReceipt(tx.hash); gasPaid += rc.gasUsed * rc.gasPrice; } }
    const hype1 = Number(ethers.formatEther(await P.getBalance(USER) + gasPaid)); // what the sell paid, gas added back
    ok(Math.abs((hype1 - hype0) / qs.hype - 1) < 0.01, `sell quote ${qs.hype.toFixed(5)} vs received ${(hype1 - hype0).toFixed(5)} ${N.quote} (gas added back)`);
    await waitFor(async () => pg.evaluate((a) => DATA.token(a).trades === 3, addr), 30000);
    const tr = await pg.evaluate((a) => DATA.trades(a).map((t) => [t.buy ? 'buy' : 'sell', t.wallet.slice(0, 8), +t.hype.toFixed(4), Math.round(t.tokens), t.feeBps]), addr);
    ok(tr.length === 3 && tr.every((t) => t[1] === USER.toLowerCase().slice(0, 8)), 'trades with the trader and fee: ' + JSON.stringify(tr));
    await pg.screenshot({ path: OUT + '/live-token-trades.png', fullPage: true });
    // 5. keeper sweeps, creator claims
    const sres = await new Promise((done) => { const r = { h: {}, setHeader() {}, end(b) { done(JSON.parse(b)); } }; API.sweep({ headers: { authorization: 'Bearer local' } }, r); });
    const sw = sres[N.key] || {}; ok(sw.swept && sw.swept.length === 1 && sw.swept[0].status === 1, 'keeper swept the pool: ' + JSON.stringify(sres).slice(0, 200));
    await pg.goto(B + '/creator'); await pg.waitForTimeout(2500); await waitFor(async () => { await pg.click('[data-tab="fees"]').catch(() => {}); return pg.evaluate((w) => DATA.creator(w).claimable > 0 && !!document.querySelector('#p-claim'), USER.toLowerCase()); }, 30000);
    const cl = await pg.evaluate((w) => DATA.creator(w), USER.toLowerCase());
    ok(cl.claimable > 0, 'creator fees claimable in the escrow: ' + cl.claimable.toFixed(6) + ' ' + N.quote + '; lifetime ' + cl.lifetime.toFixed(6));
    await pg.screenshot({ path: OUT + '/live-creator.png', fullPage: true });
    const claimBtn = await pg.$('#p-claim'); ok(!!claimBtn, 'claim button shown');
    if (claimBtn) { const e0 = await P.getBalance(USER); await claimBtn.click(); await waitFor(async () => (await P.getBalance(USER)) > e0, 60000); ok((await P.getBalance(USER)) > e0, 'claim paid ' + N.quote + ' to the creator'); }
    // 6. board
    await pg.goto(B + '/'); await pg.waitForTimeout(2500); ok(await pg.evaluate(() => DATA.tokens().length === 1), 'board lists the token');
    await pg.screenshot({ path: OUT + '/live-home.png', fullPage: true });
  } catch (e) { ok(false, 'exception ' + e.message.slice(0, 300)); await pg.screenshot({ path: OUT + '/live-fail.png', fullPage: true }); }
  ok(!errs.length, 'no console errors ' + errs.slice(0, 5).join(' || '));
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); await br.close(); srv.close(); process.exit(fails ? 1 : 0);
});
