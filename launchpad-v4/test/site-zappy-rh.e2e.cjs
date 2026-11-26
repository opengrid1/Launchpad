// Zappy on Robinhood Chain through the website, on a Robinhood Chain fork (node at 127.0.0.1:8550) holding the stack
// deploy-v2.cjs put there with LEVERAGE=1 and STOCKS (deployments/zappytest-v2-robinhood-fork.json), the brand config
// written from it (build/zappy-rh-config.cjs) and dist/zappy built (build/brand-site.cjs zappy). Serves dist/zappy and
// its API against the fork; drives the pages with a wallet that forwards to the node:
//   launch an ETH-pair coin from the form, let a market buy it up, open a 2x long from the Leverage tab, close it,
//   open a 3x long, dump the price and run the keeper (flag, wait, liquidate); launch an NVDA-pair coin, buy it from
//   ETH and sell back; the admin page's leverage card.
//   node test/site-zappy-rh.e2e.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const SP = '/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad', ROOT = path.join(__dirname, '../dist/zappy'), OUT = SP + '/shots';
const NODE = 'http://127.0.0.1:8550', USER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906', OWNER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const dep = require('../deployments/zappytest-v2-robinhood-fork.json');
Object.assign(process.env, { ROBINHOOD_RPC: NODE, ROBINHOOD_V2: '1', ROBINHOOD_V2_FACTORY: dep.factory, ROBINHOOD_V2_HOOK: dep.hook, ROBINHOOD_V2_LOCKER: dep.locker, ROBINHOOD_V2_MARGIN: dep.leverage.margin, ROBINHOOD_FROM_BLOCK: String(dep.fromBlock), LQF_ONLY: 'robinhood', LOCAL_UPLOAD_DIR: SP + '/uploads', LOCAL_UPLOAD_BASE: '', CRON_SECRET: 'local', SWEEP_KEY: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' });
delete process.env.BLOB_READ_WRITE_TOKEN;
const { ethers } = require(path.join(__dirname, '../site/node_modules/ethers'));
const ROUTES = require('../site/routes.js');
const API = { state: require(ROOT + '/api/state.js'), upload: require(ROOT + '/api/upload.js'), keeper: require(ROOT + '/api/keeper.js') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
let WALLET = USER;
const srv = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  const api = p.match(/^\/api\/(\w+)$/); if (api && API[api[1]]) { req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); return API[api[1]](req, res); }
  if (p.startsWith('/logos/')) { const f = path.join(SP, 'uploads', p); if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] }); return fs.createReadStream(f).pipe(res); } }
  if (p.startsWith('/token/')) p = '/token.html'; if (p === '/') p = '/index.html'; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f); if (p === '/config.js') body = String(body).replace("rpc: 'https://rpc.mainnet.chain.robinhood.com'", `rpc: '${NODE}'`);
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});
const runKeeper = () => new Promise((ok) => { const res = { headers: {}, setHeader() {}, end(b) { ok(JSON.parse(b)); } }; API.keeper({ headers: { authorization: 'Bearer local' }, query: {} }, res); });

srv.listen(8796, async () => {
  let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  fs.mkdirSync(OUT, { recursive: true });
  const P = new ethers.JsonRpcProvider(NODE, undefined, { staticNetwork: true, cacheTimeout: -1 });
  const later = async (s) => { await P.send('evm_increaseTime', [s]); await P.send('evm_mine', []); };
  for (const a of [USER, OWNER]) await P.send('hardhat_setBalance', [a, '0x' + (100n * 10n ** 18n).toString(16)]);
  const keeperAddr = new ethers.Wallet(process.env.SWEEP_KEY).address; await P.send('hardhat_setBalance', [keeperAddr, '0x' + (10n ** 18n).toString(16)]);
  const own = new ethers.NonceManager(await P.getSigner(OWNER)), art = (n) => require('../artifacts/' + n + '.json').abi;
  for (const [n, a] of [['BuzzPadHook', dep.hook], ['BuzzPadFactory', dep.factory], ['ZappyLocker', dep.locker], ['ZappyMargin', dep.leverage.margin]]) await (await new ethers.Contract(a, art(n), own).acceptOwnership()).wait();
  await (await new ethers.Contract(dep.factory, art('BuzzPadFactory'), own).setLaunchEnabled(true)).wait();
  await (await new ethers.Contract(dep.leverage.margin, art('ZappyMargin'), own).setOpensEnabled(true)).wait();
  const M = new ethers.Contract(dep.leverage.margin, art('ZappyMargin'), P);
  const market = new ethers.NonceManager(new ethers.Wallet('0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', P)), mkt = await market.getAddress();
  await P.send('hardhat_setBalance', [mkt, '0x' + (1000n * 10n ** 18n).toString(16)]);
  const UR = '0x8876789976decbfcbbbe364623c63652db8c0904', dl = () => BigInt(Math.floor(Date.now() / 1000) + 86400 * 400);
  const mbuy = async (coin, eth) => (await market.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: ethers.ZeroAddress, hook: dep.hook, buy: true, amountIn: ethers.parseEther(String(eth)), minOut: 1n, deadline: dl(), hopLayout: true }), value: ethers.parseEther(String(eth)), gasLimit: 900_000n })).wait();
  const msell = async (coin, amt) => (await market.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: ethers.ZeroAddress, hook: dep.hook, buy: false, amountIn: amt, minOut: 1n, deadline: dl(), hopLayout: true }), gasLimit: 900_000n })).wait();
  const erc = (a) => new ethers.Contract(a, ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], market);

  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.exposeFunction('walletAddr', () => WALLET);
  await ctx.addInitScript(({ NODE }) => {
    let id = 0; const fw = async (method, params) => { const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [await window.walletAddr()]; if (method === 'eth_chainId') return '0x1237'; if (method === 'net_version') return '4663';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      return fw(method, params || []);
    } };
    window.__toasts = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }));
  }, { NODE });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  const toasts = async () => pg.evaluate(() => (window.__toasts || []).join(' | '));
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await pg.waitForTimeout(500); } return false; };
  const B = 'http://127.0.0.1:8796';
  const connect = async () => { await pg.evaluate(() => APP.W.connect()).catch(() => {}); await pg.waitForTimeout(500); await pg.click('[data-i="0"]').catch(() => {}); await pg.waitForTimeout(1200); };
  const launch = async (name, sym, pairKey) => {
    await pg.goto(B + '/launch'); await pg.waitForTimeout(1500); await connect();
    await pg.click('#acc-desc .ah').catch(() => {}); await pg.setInputFiles('#f-img', SP + '/test-token.png'); await pg.waitForTimeout(300);
    await pg.fill('#f-name', name); await pg.fill('#f-sym', sym); await pg.fill('#f-desc', 'A Zappy test coin on Robinhood Chain.');
    await pg.click('#next', { timeout: 1500 }).catch(() => {}); await pg.waitForTimeout(400);
    if (pairKey) { await pg.click('#f-pairbtn'); await pg.waitForTimeout(300); await pg.click('.ppo[data-pk="' + pairKey + '"]'); }
    await pg.waitForTimeout(300); await pg.click('#go');
    ok(await waitFor(async () => /\/token\/0x/.test(pg.url()), 120000), `launched ${sym} (${pairKey || 'eth'} pair): ${pg.url()}`);
    const coin = (pg.url().match(/0x[0-9a-f]{40}/i) || [''])[0].toLowerCase();
    await waitFor(() => pg.evaluate((a) => !!DATA.token(a), coin), 60000); return coin;
  };
  try {
    await pg.goto(B + '/'); await pg.waitForTimeout(3000);
    ok(await pg.evaluate(() => DATA.mode === 'live' && CFG.chain.key === 'robinhood'), 'board loads on Robinhood Chain');
    // an ETH-pair coin, bought up by a market until its pool can lend
    const coin = await launch('Lev Zap', 'LZAP', null);
    await later(20); for (let i = 0; i < 15; i++) await mbuy(coin, 1);
    await later(700);
    ok(Number(ethers.formatEther(await M.poolDepth(coin))) > 5, 'pool depth after 15 ETH of buys: ' + ethers.formatEther(await M.poolDepth(coin)));
    await pg.goto(B + '/token/' + coin); await pg.waitForTimeout(3000); await connect();
    await pg.click('[data-m="lev"]'); ok(await waitFor(() => pg.isVisible('[data-lev="2"]'), 30000), 'Leverage tab shows the 1.5x / 2x / 3x choice');
    await pg.click('[data-lev="2"]'); await pg.waitForTimeout(300);
    const max2 = await pg.evaluate((a) => DATA.lev.info(a).then((i) => i.max[2]), coin);
    await pg.fill('#t-amt', String(Math.floor(max2 * 0.5 * 1e6) / 1e6)); await pg.waitForTimeout(500);
    await pg.screenshot({ path: OUT + '/rh-lev.png', fullPage: true });
    await pg.click('#t-go');
    ok(await waitFor(async () => /Opened a 2x long/.test(await toasts()), 90000), 'opened a 2x long from the page: ' + (await toasts()).slice(-80));
    ok(await waitFor(async () => (await pg.$$('.levpos .lp')).length === 1, 30000), 'the position shows under the panel');
    const ids = await M.positionsOf(USER); ok(ids.length === 1, 'one position on chain');
    await pg.click('[data-close]');
    ok(await waitFor(async () => /Closed the 2x position/.test(await toasts()), 90000), 'closed it from the page');
    ok((await M.positions(ids[0])).owner === ethers.ZeroAddress, 'position gone on chain');
    // a 3x long, a dump, the keeper
    await pg.waitForTimeout(1500); await pg.click('[data-lev="3"]').catch(() => {}); await pg.waitForTimeout(300);
    const max3 = await pg.evaluate((a) => DATA.lev.info(a).then((i) => i.max[3]), coin);
    await pg.fill('#t-amt', String(Math.floor(max3 * 0.5 * 1e6) / 1e6)); await pg.waitForTimeout(500); await pg.click('#t-go');
    ok(await waitFor(async () => /Opened a 3x long/.test(await toasts()), 90000), 'opened a 3x long');
    const id3 = (await M.positionsOf(USER)).slice(-1)[0];
    await (await erc(coin).approve('0x000000000022D473030F116dDEE9F6B43aC78BA3', ethers.MaxUint256)).wait();
    await (await market.sendTransaction({ to: '0x000000000022D473030F116dDEE9F6B43aC78BA3', data: new ethers.Interface(['function approve(address,address,uint160,uint48)']).encodeFunctionData('approve', [coin, UR, (1n << 160n) - 1n, Number(dl())]) })).wait();
    const mk = await erc(coin).balanceOf(mkt); let n = 0; while (!(await M.health(id3))[2] && n++ < 150) await msell(coin, mk / 200n);
    ok((await M.health(id3))[2], `after ${n} market sells the 3x position is past maintenance`);
    const kr = await runKeeper();
    ok(kr.robinhood && kr.robinhood.liquidated && kr.robinhood.liquidated.includes(Number(id3)), 'keeper flagged, waited and liquidated it: ' + JSON.stringify(kr.robinhood));
    ok((await M.positions(id3)).owner === ethers.ZeroAddress, 'liquidated position gone on chain');
    await pg.screenshot({ path: OUT + '/rh-token.png', fullPage: true });
    // an NVDA-pair coin bought from ETH and sold back from the page
    const nv = await launch('Nvidia Zap', 'NZAP', 'nvda');
    const v = await pg.evaluate((a) => { const t = DATA.token(a); return t && { pairSym: t.pairSym, v: t.v }; }, nv);
    ok(v && v.pairSym === 'NVDA', 'coin paired with NVDA: ' + JSON.stringify(v));
    await later(20); await pg.reload(); await pg.waitForTimeout(4000);
    // the fork's clock jumped: wait until the page's state has caught up and the launch snipe tax is over
    ok(await waitFor(() => pg.evaluate((a) => DATA.feeState(a).kind !== 'snipe', nv), 30000), 'snipe window over on the page');
    const b0 = await erc(nv).balanceOf(USER), qb = await pg.evaluate((a) => DATA.quoteBuy(a, 'hyper', 0.05), nv);
    await pg.fill('#t-amt', '0.05'); await pg.waitForTimeout(600); await pg.click('#t-go');
    ok(await waitFor(async () => /Bought/.test(await toasts()), 90000), 'bought the NVDA-pair coin with ETH from the page');
    const got = Number(ethers.formatEther((await erc(nv).balanceOf(USER)) - b0));
    ok(got > 0 && Math.abs(got / qb.tokens - 1) < 0.03, `buy quote ${qb.tokens.toFixed(0)} vs received ${got.toFixed(0)} (${((got / qb.tokens - 1) * 100).toFixed(2)}%)`);
    await pg.click('[data-s="sell"]'); await pg.waitForTimeout(300);
    await pg.fill('#t-amt', String(Math.floor(got / 2))); await pg.waitForTimeout(300); await pg.click('#t-go');
    ok(await waitFor(async () => /Sold/.test(await toasts()), 120000), 'sold half back to ETH from the page: ' + (await toasts()).slice(-80));
    // leverage on the NVDA coin: a market buys it up with NVDA (taken from the PoolManager's balance on the fork), then a
    // 2x long paid in ETH from the Leverage tab (the margin is swapped to NVDA) and closed back to ETH
    const sp = dep.stockPairs.find((s) => s.sym === 'NVDA'), st = require('../brands/zappy/stocks.json'), perEth = st.ethUsd / st.stocks.find((s) => s.sym === 'NVDA').usd;
    const PM = '0x8366a39CC670B4001A1121B8F6A443A643e40951', AC = ethers.AbiCoder.defaultAbiCoder(), URI = new ethers.Interface(['function execute(bytes,bytes[],uint256) payable']);
    await P.send('hardhat_impersonateAccount', [PM]); await P.send('hardhat_setBalance', [PM, '0x' + (10n ** 18n).toString(16)]);
    await P.send('eth_sendTransaction', [{ from: PM, to: sp.addr, data: new ethers.Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [mkt, ethers.parseEther((perEth * 20).toFixed(6))]) }]);
    await P.send('hardhat_stopImpersonatingAccount', [PM]);
    await (await erc(sp.addr).approve('0x000000000022D473030F116dDEE9F6B43aC78BA3', ethers.MaxUint256)).wait();
    await (await market.sendTransaction({ to: '0x000000000022D473030F116dDEE9F6B43aC78BA3', data: new ethers.Interface(['function approve(address,address,uint160,uint48)']).encodeFunctionData('approve', [sp.addr, UR, (1n << 160n) - 1n, Number(dl())]) })).wait();
    const stockBuy = (amt) => URI.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], ['0x060c0f', [AC.encode(['((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'], [[[sp.addr, nv, 0, 200, dep.hook], true, amt, 1n, 0n, '0x']]), AC.encode(['address', 'uint256'], [sp.addr, amt]), AC.encode(['address', 'uint256'], [nv, 1n])]])], dl()]);
    for (let i = 0; i < 15; i++) await (await market.sendTransaction({ to: UR, data: stockBuy(ethers.parseEther(perEth.toFixed(6))), gasLimit: 1_500_000n })).wait();
    await later(700);
    ok((await M.poolDepth(nv)) >= (await M.minDepthOf(sp.addr)), `NVDA coin pool depth ${ethers.formatEther(await M.poolDepth(nv))} NVDA (min ${ethers.formatEther(await M.minDepthOf(sp.addr))})`);
    await pg.reload(); await pg.waitForTimeout(4000); await connect();
    await pg.click('[data-m="lev"]'); ok(await waitFor(() => pg.isVisible('[data-lev="2"]'), 30000), 'NVDA coin: Leverage tab shows');
    await pg.click('[data-lev="2"]'); await pg.waitForTimeout(300);
    const nvInfo = await pg.evaluate((a) => DATA.lev.info(a), nv);
    ok(nvInfo && nvInfo.ok && nvInfo.max[2] > 0, `NVDA coin terms in ETH: depth ${nvInfo && nvInfo.depth.toFixed(3)} ETH, largest 2x margin ${nvInfo && nvInfo.max[2].toFixed(4)} ETH ${nvInfo && nvInfo.why}`);
    const nvM = Math.floor(nvInfo.max[2] * 0.5 * 1e6) / 1e6;
    await pg.fill('#t-amt', String(nvM)); await pg.waitForTimeout(500); await pg.screenshot({ path: OUT + '/rh-lev-nvda.png', fullPage: true }); await pg.click('#t-go');
    ok(await waitFor(async () => /Opened a 2x long on NZAP/.test(await toasts()), 120000), `opened a 2x long on the NVDA coin with ${nvM} ETH: ` + (await toasts()).slice(-80));
    const nvId = (await M.positionsOf(USER)).slice(-1)[0], nvPos = await M.positions(nvId);
    ok(nvPos.pair.toLowerCase() === sp.addr.toLowerCase() && nvPos.token.toLowerCase() === nv, `position ${nvId} is in NVDA: margin ${ethers.formatEther(nvPos.margin)} NVDA, borrowed ${ethers.formatEther(nvPos.principal)} NVDA`);
    ok(await waitFor(async () => { const s = await pg.$eval('.levpos', (e) => e.textContent).catch(() => ''); return /2x long/.test(s); }, 30000), 'the NVDA position shows under the panel, in ETH');
    const pv = await pg.evaluate(() => DATA.lev.positions(APP.W.address, true)), pn = pv.find((x) => x.id === Number(nvId));
    ok(pn && Math.abs(pn.margin / nvM - 1) < 0.1, `page shows margin ${pn && pn.margin.toFixed(5)} ETH (paid ${nvM})`);
    const e0 = await P.getBalance(USER); await pg.click('[data-close]');
    ok(await waitFor(async () => /Closed the 2x position/.test(await toasts()), 120000), 'closed the NVDA position from the page');
    ok((await M.positions(nvId)).owner === ethers.ZeroAddress && (await P.getBalance(USER)) > e0, `position gone, ${ethers.formatEther((await P.getBalance(USER)) - e0)} ETH back (after gas)`);
    // admin: the leverage card
    WALLET = OWNER; await pg.goto(B + '/admin'); await pg.waitForTimeout(1500); await connect(); await pg.waitForTimeout(3000);
    ok(await waitFor(() => pg.isVisible('text=New positions are on'), 30000), 'admin leverage card shows opens on');
    await pg.click('[data-act="levToggle"]'); ok(await waitFor(async () => /Turn leverage off done/.test(await toasts()), 60000), 'admin turns leverage off');
    ok(!(await M.opensEnabled()), 'opens off on chain');
    await pg.screenshot({ path: OUT + '/rh-admin.png', fullPage: true });
  } catch (e) { ok(false, 'exception ' + e.message.slice(0, 300)); await pg.screenshot({ path: OUT + '/rh-fail.png', fullPage: true }); }
  ok(!errs.length, 'no console errors ' + errs.slice(0, 5).join(' || '));
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); await br.close(); srv.close(); process.exit(fails ? 1 : 0);
});
