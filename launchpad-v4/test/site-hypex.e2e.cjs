// Hypex site E2E on local forks of both its chains (test/site-hypex.setup.sh first: Elysium on 8601, HyperEVM on 8602,
// the stack deployed on each). Serves dist/hypex and its /api functions like Vercel, drives the pages with a wallet
// that forwards to the node of the chain it is on, and checks the chains: a launch on Elysium, the launch service's leg
// on HyperEVM at the same address, buys and sells on both, the trader airdrop owed and claimed.
//   bash test/site-hypex.setup.sh && node build/hypex-site.cjs && node test/site-hypex.e2e.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'dist', 'hypex'), DEP = path.join(__dirname, '..', 'hypex-eth', 'deployments');
const SP = '/tmp/claude-0/-home-user-Launchpad/2c15f8d4-9629-5fde-b76e-4ea97bf2ebee/scratchpad', OUT = SP + '/hypex';
const NODES = { elysium: 'http://127.0.0.1:8601', hyperevm: 'http://127.0.0.1:8602' }, HEX = { elysium: '0x1863d', hyperevm: '0x3e7' };
const D = { elysium: require(DEP + '/elysium-local.json'), hyperevm: require(DEP + '/hyperevm-local.json') };
const USER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // anvil account 3
const pick = (d) => JSON.stringify({ factory: d.factory, hook: d.hook, revenue: d.revenue, bridge: d.bridge, burner: d.burner, vesting: d.vesting, hypex: d.hypex, fromBlock: d.fromBlock });
fs.mkdirSync(SP + '/uploads', { recursive: true });
Object.assign(process.env, {
  ELYSIUM_RPC: NODES.elysium, HYPEX_RPC_ONLY: '1', HYPEREVM_RPC: NODES.hyperevm, HYPEX_CONTRACTS_ELYSIUM: pick(D.elysium), HYPEX_CONTRACTS_HYPEREVM: pick(D.hyperevm),
  HYPEX_START_SIGNER_KEY: '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356', // anvil 7
  HYPEX_KEEPER_KEY: '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97', // anvil 8
  LOCAL_UPLOAD_DIR: SP + '/uploads', LOCAL_UPLOAD_BASE: 'http://127.0.0.1:8795',
});
const { ethers } = require('ethers');
const API = { state: require(ROOT + '/api/state.js'), sign: require(ROOT + '/api/sign.js'), leg: require(ROOT + '/api/leg.js'), upload: require(ROOT + '/api/upload.js'), meta: require(ROOT + '/api/meta.js') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json', '.ico': 'image/x-icon' };
const cfgPatch = (src) => {
  for (const net of ['elysium', 'hyperevm']) {
    const d = D[net], at = src.indexOf(`key: '${net}'`), end = src.indexOf('} },', src.indexOf('contracts: {', at)) + 4;
    const block = src.slice(at, end).replace(/rpc: '[^']*'/, `rpc: '${NODES[net]}'`).replace(/rpcs: \[[^\]]*\]/, `rpcs: ['${NODES[net]}']`)
      .replace("factory: ''", `factory: '${d.factory}'`).replace("hook: ''", `hook: '${d.hook}'`).replace("revenue: ''", `revenue: '${d.revenue}'`).replace("bridge: ''", `bridge: '${d.bridge}'`);
    src = src.slice(0, at) + block + src.slice(end);
  }
  return src.replace('demo: true,', 'demo: false,');
};
const srv = http.createServer(async (req, res) => {
  let p = req.url.split('?')[0];
  const api = p.match(/^\/api\/(\w+)$/); if (api && API[api[1]]) { req.query = Object.fromEntries(new URL(req.url, 'http://x').searchParams); return API[api[1]](req, res); }
  if (p.startsWith('/logos/') || p.startsWith('/hypex/meta/')) { const f = path.join(SP, 'uploads', p); if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'image/png', 'access-control-allow-origin': '*' }); return fs.createReadStream(f).pipe(res); } }
  if (!path.extname(p)) p = '/index.html';
  const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f); if (p === '/config.js') body = cfgPatch(String(body));
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(body);
});
srv.listen(8795, async () => {
  let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
  const P = { elysium: new ethers.JsonRpcProvider(NODES.elysium, 99901, { staticNetwork: true }), hyperevm: new ethers.JsonRpcProvider(NODES.hyperevm, 999, { staticNetwork: true }) };
  const { chromium } = require('playwright'); const br = await chromium.launch(); const errs = [];
  const ctx = await br.newContext({ viewport: { width: 1360, height: 900 } });
  await ctx.addInitScript(({ NODES, HEX, USER }) => {
    try { localStorage.setItem('wallet-ui', 'basic'); } catch {} // the plain wallet picker instead of the Reown modal
    let id = 0, cur = 'elysium'; const ls = {};
    const fw = async (method, params) => { const r = await fetch(NODES[cur], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; };
    window.ethereum = { isMetaMask: true, on(ev, f) { (ls[ev] || (ls[ev] = [])).push(f); }, removeListener() {}, request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [USER]; if (method === 'eth_chainId') return HEX[cur]; if (method === 'net_version') return String(parseInt(HEX[cur], 16));
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { const want = String(params[0].chainId).toLowerCase(); cur = want === HEX.hyperevm ? 'hyperevm' : 'elysium'; (ls.chainChanged || []).forEach((f) => f(HEX[cur])); return null; }
      if (method === 'eth_sendTransaction') { const tx = { ...params[0], from: USER }; return fw('eth_sendTransaction', [tx]); }
      return fw(method, params || []);
    } };
  }, { NODES, HEX, USER });
  // anvil signs for the test user
  for (const n of Object.keys(NODES)) await P[n].send('anvil_impersonateAccount', [USER]);
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); }); pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message.slice(0, 200)));
  const waitFor = async (fn, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await pg.waitForTimeout(800); } return false; };
  const ev = (fn, arg) => pg.evaluate(async ([f, a]) => { try { return await (0, eval)(f)(a); } catch (e) { return { err: e.message }; } }, [String(fn), arg]);
  const B = 'http://127.0.0.1:8795';
  try {
    await pg.goto(B + '/'); await pg.waitForTimeout(4000);
    ok(await pg.evaluate(() => DATA.mode === 'live' && !DATA.demo), 'live data layer on both chains');
    ok(await waitFor(() => pg.evaluate(() => DATA.tokens().some((t) => t.symbol === 'HYPEX' && t.chains.length === 2)), 30000), '$HYPEX on both chains, one coin');
    await pg.evaluate(() => APP.W.connect()); await pg.waitForTimeout(800); await pg.click('[data-i="0"]').catch(() => {}); await pg.waitForTimeout(1500);
    ok(await pg.evaluate(() => APP.W.connected), 'wallet connected');
    // a launch on Elysium through the data layer (logo uploaded, start signed, the service's leg on HyperEVM)
    const img = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'brands', 'hypex', 'img', 'icon-192.png')).toString('base64');
    const r = await ev(async (img) => DATA.launch({ name: 'Twin Peak', symbol: 'TWIN', image: img, description: 'Two chains, one coin.', x: '', telegram: '', website: '' }), img);
    ok(r && r.addr, 'launched on Elysium ' + JSON.stringify(r));
    const addr = r && r.addr;
    ok(await waitFor(async () => (await P.hyperevm.getCode(addr)) !== '0x', 90000), 'the launch service put it on HyperEVM at the same address');
    ok(await waitFor(() => pg.evaluate((a) => { const t = DATA.token(a); return t && t.chains.length === 2; }, addr), 60000), 'the site shows one coin on both chains');
    // past the snipe window (its first minute pays no airdrop, by design) on both chains
    for (const n of Object.keys(NODES)) { await P[n].send('evm_increaseTime', [120]); await P[n].send('evm_mine', []); }
    // buys and sells
    const b1 = await ev(async (a) => DATA.buy(a, 'elysium', 2, 0), addr); ok(b1 && b1.tokens > 0, 'bought on Elysium ' + JSON.stringify(b1));
    const erc = (n) => new ethers.Contract(addr, ['function balanceOf(address) view returns (uint256)'], P[n]);
    const balE = Number(ethers.formatEther(await erc('elysium').balanceOf(USER))); ok(balE > 0, 'holds ' + balE.toFixed(0) + ' on Elysium');
    const s1 = await ev(async ([a, k]) => DATA.sell(a, 'elysium', k, 0), [addr, balE / 2]); ok(s1 && s1.hype > 0, 'sold half on Elysium ' + JSON.stringify(s1));
    const b2 = await ev(async (a) => DATA.buy(a, 'hyperevm', 1, 0), addr); ok(b2 && b2.tokens > 0, 'bought on HyperEVM ' + JSON.stringify(b2));
    // the trader airdrop: owed on both chains, claimed on HyperEVM (the current chain)
    await pg.waitForTimeout(4000);
    const air = await pg.evaluate((w) => DATA.airdrop(w), USER); ok(air.byChain.elysium.owed > 0 && air.byChain.hyperevm.owed > 0, 'airdrop owed on both chains ' + JSON.stringify(air.byChain));
    const h0 = await P.hyperevm.getBalance(USER);
    const got = await ev(async () => DATA.claim()); ok(typeof got === 'number' && got > 0, 'claimed the HyperEVM airdrop ' + JSON.stringify(got));
    ok((await P.hyperevm.getBalance(USER)) > h0 - ethers.parseEther('0.01'), 'paid in HYPE');
    await pg.goto(B + '/token/' + addr); await pg.waitForTimeout(3500); await pg.screenshot({ path: OUT + '/e2e-token.png' });
    await pg.goto(B + '/'); await pg.waitForTimeout(3000); await pg.screenshot({ path: OUT + '/e2e-home.png' });
  } catch (e) { fails++; console.log('  FAIL threw ' + e.message); }
  console.log(errs.length ? 'console errors:\n  ' + [...new Set(errs)].slice(0, 12).join('\n  ') : 'no console errors');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await br.close(); srv.close(); process.exit(fails ? 1 : 0);
});
