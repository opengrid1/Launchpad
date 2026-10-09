// End-to-end on the local Base fork with an injected test wallet (hardhat's unlocked account).
const { chromium } = require('playwright');
const ACCT = process.env.ACCT || '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const RPC = 'http://127.0.0.1:8545', SITE = 'http://127.0.0.1:8790', OUT = process.argv[2] || '..';
const rpc = (method, params = []) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(r => r.json());
const shim = ({ acct, rpcUrl }) => {
  let n = 1; const listeners = {};
  const call = (method, params) => fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: n++, method, params: params || [] }) }).then(r => r.json()).then(j => { if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result; });
  window.ethereum = { isMetaMask: true, request: async ({ method, params }) => { if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [acct]; if (method === 'eth_chainId') return '0x2105'; if (method === 'wallet_switchEthereumChain') return null; if (method === 'eth_sendTransaction') { const tx = { ...params[0], from: acct }; delete tx.gasPrice; return call('eth_sendTransaction', [tx]); } return call(method, params); }, on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); }, removeListener() {} };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-bypass-list=127.0.0.1;localhost', '--ignore-certificate-errors'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(shim, { acct: ACCT, rpcUrl: RPC });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const step = async (name, fn) => { const t = Date.now(); try { await fn(); console.log('ok  ', name, ((Date.now() - t) / 1000).toFixed(1) + 's'); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await p.screenshot({ path: `${OUT}/e2e-fail.png`, fullPage: true }); throw e; } };
  const toast = async re => { const t = await p.waitForSelector('.toast', { timeout: 90000 }); const txt = await t.innerText(); if (/err/.test(await t.getAttribute('class'))) throw new Error('toast error: ' + txt); if (re && !re.test(txt)) throw new Error('unexpected toast: ' + txt); await t.evaluate(n => n.remove()); return txt; };

  await step('launch page connects', async () => { await p.goto(SITE + '/launch', { waitUntil: 'networkidle' }); await p.click('[data-wallet-btn]'); await p.waitForSelector('.wallet-btn .dot'); });
  await step('fill coin', async () => { await p.setInputFiles('#logo', process.env.LOGO); await p.fill('#name', 'Toshi Pup'); await p.fill('#sym', 'PUP'); await p.fill('#desc', 'Paired with TOSHI, pays holders in DEGEN and WELL.'); await p.fill('#lx', 'https://x.com/toshipup'); });
  await step('pick TOSHI pair (Uniswap V3, not yet priced)', async () => { await p.click('#pairBtn'); await p.fill('#pq', 'toshi'); await p.click('.opt[data-a]'); await p.waitForSelector('#pairStatus .status.ok', { timeout: 60000 }); console.log('     ', await p.innerText('#pairStatus')); });
  await step('add DEGEN and WELL rewards', async () => { for (const s of ['degen', 'well']) { await p.click('#addB'); await p.fill('#pq', s); await p.click('.opt[data-a]'); await p.waitForFunction(() => !document.querySelector('#basket').innerText.includes('checking'), null, { timeout: 60000 }); } const bad = await p.$('#basketBox .status.bad'); if (bad) throw new Error(await bad.innerText()); });
  await step('first buy + launch', async () => { await p.fill('#dev', '0.005'); await p.screenshot({ path: `${OUT}/e2e-launch-form.png`, fullPage: true }); await p.click('#launchBtn'); await toast(/live/); await p.waitForURL(/\/coin\/0x/, { timeout: 30000 }); });
  const coinUrl = p.url(); console.log('      coin', coinUrl);
  await rpc('evm_increaseTime', [40]); await rpc('evm_mine'); await rpc('evm_mine'); await rpc('evm_mine'); await rpc('evm_mine');
  await step('coin page loads', async () => { await p.reload({ waitUntil: 'networkidle' }); await p.waitForSelector('#trade #amt'); });
  await step('buy 0.02 ETH', async () => { await p.fill('#amt', '0.02'); await p.waitForFunction(() => /PUP/.test(document.querySelector('#out').textContent), null, { timeout: 30000 }); console.log('      quote', await p.innerText('#out')); await p.click('#go'); await toast(/Bought/); });
  await step('sell half', async () => { await p.click('[data-mode="sell"]'); await p.click('[data-p="50"]'); await p.waitForFunction(() => /ETH/.test(document.querySelector('#out').textContent), null, { timeout: 30000 }); console.log('      quote', await p.innerText('#out')); await p.click('#go'); await toast(/Sold/); });
  await step('claim rewards as basket', async () => { await p.waitForSelector('[data-claim="basket"]:not([disabled])', { timeout: 30000 }); await p.click('[data-claim="basket"]'); await toast(/claimed/); });
  await step('creator fees', async () => { await p.waitForSelector('#payc:not([disabled])', { timeout: 30000 }); await p.click('#payc'); await toast(/Creator fees/); });
  await p.screenshot({ path: `${OUT}/e2e-coin.png`, fullPage: true });
  await step('portfolio', async () => { await p.goto(SITE + '/portfolio', { waitUntil: 'networkidle' }); await p.waitForSelector('.pf-tiles .tile b:not(.skel)', { timeout: 30000 }); await p.screenshot({ path: `${OUT}/e2e-portfolio.png`, fullPage: true }); });
  await step('admin: push platform fees + hide', async () => { await p.goto(SITE + '/admin', { waitUntil: 'networkidle' }); await p.waitForSelector('#pf', { timeout: 30000 }); await p.screenshot({ path: `${OUT}/e2e-admin.png`, fullPage: true }); await p.click('#pf'); await toast(/Platform fees/); const addr = coinUrl.split('/coin/')[1]; await p.waitForSelector(`[data-hide="${addr}"]`); await p.click(`[data-hide="${addr}"]`); await toast(/hidden/); });
  console.log(errs.length ? 'page errors:\n' + errs.slice(0, 10).join('\n') : 'no page errors');
  await b.close();
})().catch(e => { console.error(e.message); process.exit(1); });
