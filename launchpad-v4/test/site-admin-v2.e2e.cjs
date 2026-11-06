// The admin page's v2 sections (Zappy on Base, v2 contracts only) on a fresh Base mainnet fork (node at 127.0.0.1:8549)
// holding the live contracts, signed in as the admin wallet (impersonated): the v2 token list, a token's details, pay
// out its fees, collect 1% of its liquidity, whitelist a launcher, turn a launch config off and on, save a setting.
//   node build/brand-site.cjs zappy && node test/site-admin-v2.e2e.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../dist/zappy');
const NODE = 'http://127.0.0.1:8549', ADMIN = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b', ZAPPY = '0xa9dc0d6d667ddc546aa1aab6561aba6c543be486';
const dep = require('../deployments/zappy-v2-base.json');
Object.assign(process.env, { BASE_RPC: NODE, BASE_V2: '1', LQF_ONLY: 'base' });
delete process.env.BLOB_READ_WRITE_TOKEN;
const { ethers } = require(path.join(__dirname, '../site/node_modules/ethers'));
const API = { state: require(ROOT + '/api/state.js') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  const api = p.match(/^\/api\/(\w+)$/); if (api && API[api[1]]) { req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); return API[api[1]](req, res); }
  if (p === '/') p = '/index.html'; if (!path.extname(p)) p += '.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f); if (p === '/config.js') body = String(body).replace("rpc: 'https://mainnet.base.org'", `rpc: '${NODE}'`);
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});
srv.listen(8795, async () => {
  let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  const P = new ethers.JsonRpcProvider(NODE, undefined, { staticNetwork: true, cacheTimeout: -1 });
  await P.send('hardhat_impersonateAccount', [ADMIN]); await P.send('hardhat_setBalance', [ADMIN, '0x' + (10n ** 18n).toString(16)]);
  const F = new ethers.Contract(dep.factory, require('../artifacts/BuzzPadFactory.json').abi, P);
  const H = new ethers.Contract(dep.hook, require('../artifacts/BuzzPadHook.json').abi, P);
  const key = await F.poolKeyOf(ZAPPY), poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(({ NODE, ADMIN }) => {
    let id = 0; const fw = async (method, params) => { const r = await fetch(NODE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ADMIN]; if (method === 'eth_chainId') return '0x2105'; if (method === 'net_version') return '8453';
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      return fw(method, params || []);
    } };
    window.__toasts = []; document.addEventListener('DOMContentLoaded', () => new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }));
  }, { NODE, ADMIN });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  const toasts = async () => pg.evaluate(() => (window.__toasts || []).join(' | '));
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await pg.waitForTimeout(500); } return false; };
  const done = (label) => waitFor(async () => (await toasts()).includes(label + ' done'), 60000);
  const act = async (sel, label) => { await pg.click(sel); return done(label); };
  try {
    await pg.goto('http://127.0.0.1:8795/admin'); await pg.waitForTimeout(2000);
    await pg.evaluate(() => APP.W.connect()).catch(() => {}); await pg.waitForTimeout(500); await pg.click('[data-i="0"]').catch(() => {});
    ok(await waitFor(() => pg.isVisible('text=v2 token tools')), 'v2 token tools shown to the admin');
    ok(await pg.isVisible('text=v2 launch terms and fees') && await pg.isVisible('text=v2 launch configs'), 'v2 settings and configs shown');
    ok(await waitFor(async () => (await pg.locator(`#b-toklist [data-pick2="${ZAPPY}"]`).count()) === 1), 'ZAPPY is in the v2 token list');
    await pg.click(`#b-toklist [data-pick2="${ZAPPY}"]`);
    ok(await waitFor(() => pg.isVisible('text=Unpaid creator fees')), 'ZAPPY details load');
    const body = await pg.textContent('#pg-admin');
    ok(/Locked, 3 positions/.test(body) && /Pair\s*ETH/.test(body), 'liquidity locked, pair ETH');
    const pend0 = (await H.pendingCreator(poolId)) + (await H.pendingProtocol(poolId));
    if (pend0 > 0n) { ok(await act('[data-act="payout2"]', 'Pay out fees'), `pay out ${ethers.formatEther(pend0)} ETH of fees`); ok((await H.pendingCreator(poolId)) + (await H.pendingProtocol(poolId)) === 0n, 'nothing left pending'); }
    else console.log('  skip pay out: nothing pending on the fork');
    const pm = new ethers.Contract('0x7C5f5A4bBd8fD63184577525326123B519429bDc', ['function getPositionLiquidity(uint256) view returns (uint128)'], P);
    const ids = await new ethers.Contract(dep.locker, ['function positionsOf(address) view returns (uint256[3])'], P).positionsOf(ZAPPY), liq0 = await pm.getPositionLiquidity(ids[0]);
    await pg.fill('#b-cbps', '1'); await pg.click('[data-act="collect2"]'); await pg.waitForTimeout(400); await pg.click('#c-go');
    ok(await done('Collect liquidity'), 'collect 1% of the liquidity');
    const liq1 = await pm.getPositionLiquidity(ids[0]); ok(liq1 < liq0 && liq1 >= (liq0 * 98n) / 100n, `position 0 liquidity ${liq0} -> ${liq1}`);
    const wl = ethers.Wallet.createRandom().address;
    await pg.fill('#b-wl', wl); ok(await act('[data-act="wlOn2"]', 'v2 whitelist launcher'), 'whitelist a launcher'); ok(await F.whitelistedLaunchers(wl), 'launcher whitelisted on chain');
    ok(await act('[data-cfg2="0"]', 'Turn off v2 config #0'), 'turn config #0 off'); ok(!(await F.getLaunchConfig(0))[0].enabled, 'config #0 off on chain');
    await pg.waitForTimeout(800); ok(await act('[data-cfg2="0"]', 'Turn on v2 config #0'), 'turn config #0 back on'); ok((await F.getLaunchConfig(0))[0].enabled, 'config #0 on on chain');
    await pg.fill('#b-snipes', '12'); ok(await act('[data-act="snipeSec2"]', 'v2 snipe tax window'), 'save the snipe window'); ok(Number(await F.snipeTaxSeconds()) === 12, 'snipe window is 12 s on chain');
    await pg.screenshot({ path: '/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad/admin-v2.png', fullPage: true });
  } catch (e) { fails++; console.log('  FAIL ' + e.message.split('\n')[0]); }
  console.log('  toasts:', (await toasts()).slice(0, 600));
  ok(!errs.length, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); await br.close(); srv.close(); process.exit(fails ? 1 : 0);
});
