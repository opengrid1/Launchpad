// End-to-end run of the Estonks site against the local mainnet fork, with a
// scripted EIP-1193 wallet injected into the page (signing is done by the
// Hardhat node for its unlocked / impersonated accounts).
import { chromium } from '/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/pw/node_modules/playwright-core/index.mjs';

const RPC = 'http://127.0.0.1:8546';
const SITE = 'http://localhost:4180';
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const ADMIN = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const who = process.argv[2] === 'admin' ? ADMIN : USER;

const injected = (account, rpc) => `
(() => {
  const listeners = {};
  let id = 1;
  const call = async (method, params) => {
    const r = await fetch(${JSON.stringify(rpc)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params: params ?? [] }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  const provider = {
    isMetaMask: true, isEstonksTest: true, selectedAddress: ${JSON.stringify(account)}, chainId: '0x1', networkVersion: '1',
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [${JSON.stringify(account)}];
        case 'eth_chainId': return '0x1';
        case 'net_version': return '1';
        case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': return null;
        case 'wallet_getPermissions': case 'wallet_requestPermissions': return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_getCapabilities': return {};
        case 'eth_sendTransaction': { const tx = { ...params[0], from: ${JSON.stringify(account)} }; delete tx.gas; delete tx.type; delete tx.maxFeePerGas; delete tx.maxPriorityFeePerGas; return call('eth_sendTransaction', [tx]); }
        case 'personal_sign': case 'eth_signTypedData_v4': throw Object.assign(new Error('unsupported in test'), { code: 4200 });
        default: return call(method, params);
      }
    },
    on: (ev, fn) => { (listeners[ev] ||= []).push(fn); return provider; },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
    emit: (ev, ...a) => (listeners[ev] || []).forEach((f) => f(...a)),
  };
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: false, writable: false });
  window.dispatchEvent(new Event('ethereum#initialized'));
  // EIP-6963 so wagmi's injected discovery finds it too.
  const info = { uuid: '5f3d1a2e-0000-4000-8000-estonkstest01', name: 'Estonks Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'fun.estonks.test' };
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
  window.addEventListener('eip6963:requestProvider', announce); announce();
})();`;

const rpc = async (method, params = []) => { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); return (await r.json()).result; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (p, n) => p.screenshot({ path: `/tmp/claude-0/e2e-${n}.png`, fullPage: false });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(injected(who, RPC));
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/fonts|cdn|net::ERR|walletconnect|reown|Failed to load resource|coinbase|pulse/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });

async function connect() {
  await p.goto(SITE + '/', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.click('button.wallet');
  // AppKit modal: pick the injected wallet.
  const modal = p.locator('w3m-modal');
  await modal.waitFor({ timeout: 20000 });
  await p.waitForTimeout(1500);
  const item = p.locator('w3m-modal wui-list-wallet, w3m-modal wui-list-item').filter({ hasText: /Estonks Test|Browser Wallet|Injected|MetaMask/i }).first();
  await item.click({ timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('button.wallet .addr')?.textContent?.startsWith('0x'), null, { timeout: 30000 });
  log('connected as', await p.locator('button.wallet .addr').textContent());
}

const waitToast = async (re, t = 120000) => { await p.waitForFunction((s) => new RegExp(s, 'i').test(document.querySelector('.toast')?.textContent || ''), re.source, { timeout: t }); return p.locator('.toast').textContent(); };

try {
  await connect();

  if (who === USER) {
    // 1. Launch a coin paired with ETH with a first buy.
    await p.goto(SITE + '/launch', { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.fill('.lf-f input[placeholder="Pepe on Nvidia"]', 'Test Pepe');
    await p.fill('.lf-f input.mono', 'TPEPE');
    await p.fill('.lf-f input[placeholder="One line about the coin"]', 'End to end test coin on the fork.');
    await p.fill('.lf-f input[placeholder="@handle"]', 'estonks');
    await p.click('.lf-quick button:has-text("0.05")');
    await shot(p, 'launch-filled');
    await p.click('.lf-side .btn.pri');
    log('launch:', await waitToast(/Launch TPEPE done|Cancelled|failed|Not enough|reverted|error/i, 180000));
    await p.waitForURL(/\/t\/0x/, { timeout: 60000 });
    const coinUrl = p.url(); log('coin page', coinUrl);
    await rpc('hardhat_mine', ['0x5']); log('mined 5 blocks, launch window over');
    await p.waitForTimeout(6000); await shot(p, 'coin');

    // 2. Buy 0.1 ETH.
    await p.fill('.tside .tcard .bi input', '0.1'); await p.waitForTimeout(3000);
    log('quote receive:', await p.locator('.tside .tcard output').textContent(), 'rate:', await p.locator('.tside .det > div:nth-child(1) b').textContent(), 'impact:', await p.locator('.tside .det > div:nth-child(2) b').textContent());
    await p.click('.tside .tcard .go');
    log('buy:', await waitToast(/Buy TPEPE done|Cancelled|failed|Not enough|reverted|error/i));
    await p.waitForTimeout(4000);

    // 3. Sell 50%.
    await p.click('.tside .seg button:has-text("Sell")'); await p.waitForTimeout(500);
    await p.click('.tside .q button:has-text("50%")'); await p.waitForTimeout(3000);
    log('sell quote:', await p.locator('.tside .tcard output').textContent());
    await p.click('.tside .tcard .go');
    log('sell:', await waitToast(/Sell TPEPE done|Cancelled|failed|Not enough|reverted|error/i));
    await p.waitForTimeout(5000);
    await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(8000);
    await shot(p, 'coin-after');
    log('position:', (await p.locator('.pos .pg').first().innerText()).replace(/\n/g, ' | '));
    log('trades rows:', await p.locator('.list .item').count(), 'pager:', await p.locator('.pager span').first().textContent().catch(() => 'none'));

    // 4. Claim holder rewards.
    const claimBtn = p.locator('.pos .btn.claim').first();
    log('claim enabled:', await claimBtn.isEnabled());
    if (await claimBtn.isEnabled()) { await claimBtn.click(); log('claim:', await waitToast(/Claim rewards done|Cancelled|failed|reverted|error|Nothing/i)); }
    // 5. Creator fees.
    const cbtn = p.locator('.pos .creator .btn.claim').first();
    if (await cbtn.count()) { log('creator claim enabled:', await cbtn.isEnabled()); if (await cbtn.isEnabled()) { await cbtn.click(); log('creator claim:', await waitToast(/Claim creator fees done|Cancelled|failed|reverted|error/i)); } }

    // 6. Launch a stock-paired coin (NVDAon) with an ETH first buy, then buy it.
    await p.goto(SITE + '/launch', { waitUntil: 'load' }); await p.waitForTimeout(2500);
    await p.fill('.lf-f input[placeholder="Pepe on Nvidia"]', 'Jensen Test');
    await p.fill('.lf-f input.mono', 'TJEN');
    await p.fill('.lf-search input', 'NVDA'); await p.waitForTimeout(500);
    await p.click('.lf-pairs .pair:has-text("NVDAon")');
    await p.click('.lf-quick button:has-text("0.05")');
    await shot(p, 'launch-nvda');
    await p.click('.lf-side .btn.pri');
    log('launch NVDA:', await waitToast(/Launch TJEN done|Cancelled|failed|Not enough|reverted|error/i, 180000));
    await p.waitForURL(/\/t\/0x/, { timeout: 60000 }); await rpc('hardhat_mine', ['0x5']); await p.waitForTimeout(6000);
    await p.fill('.tside .tcard .bi input', '0.05'); await p.waitForTimeout(4000);
    log('NVDA coin quote:', await p.locator('.tside .tcard output').textContent(), 'route:', await p.locator('.tside .det > div:nth-child(5) b').textContent());
    await p.click('.tside .tcard .go');
    log('buy NVDA coin:', await waitToast(/Buy TJEN done|Cancelled|failed|Not enough|reverted|error/i));
    await p.waitForTimeout(5000); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(8000);
    await shot(p, 'coin-nvda');
    log('NVDA position:', (await p.locator('.pos .pg').first().innerText()).replace(/\n/g, ' | '));

    // 7. Home, portfolio, stats.
    await p.goto(SITE + '/', { waitUntil: 'load' }); await p.waitForTimeout(8000); await shot(p, 'home');
    log('home rows:', await p.locator('.row').count(), (await p.locator('.row').allInnerTexts()).map((s) => s.replace(/\n/g, ' | ')));
    await p.goto(SITE + '/me', { waitUntil: 'load' }); await p.waitForTimeout(9000); await shot(p, 'me');
    log('portfolio figs:', (await p.locator('.figs').first().innerText()).replace(/\n/g, ' | '));
    log('ready to claim:', (await p.locator('.hero').innerText()).replace(/\n/g, ' | '));
    const claimAll = p.locator('.hero .btn');
    if (await claimAll.isEnabled()) { await claimAll.click(); log('claim all:', await waitToast(/Claim all done|Cancelled|failed|reverted|error/i)); }
    await p.goto(SITE + '/stats', { waitUntil: 'load' }); await p.waitForTimeout(8000); await shot(p, 'stats');
    log('stats:', (await p.locator('.hero').innerText()).replace(/\n/g, ' | '), '|', (await p.locator('.figs').first().innerText()).replace(/\n/g, ' | '));
    // 8. Mobile sheet.
    const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(coinUrl, { waitUntil: 'load' }); await m.waitForTimeout(7000);
    await m.click('.tbar .btn.buy'); await m.waitForTimeout(600); await m.screenshot({ path: '/tmp/claude-0/e2e-mobile-sheet.png' });
    log('mobile sheet open:', await m.locator('.tsheet.open').count());
    await m.close();
  } else {
    // Admin flow: pause/resume, hide/unhide first coin, set tax, set metadata, push fees, set fee recipient back.
    await p.goto(SITE + '/admin', { waitUntil: 'load' }); await p.waitForTimeout(9000); await shot(p, 'admin');
    log('status:', (await p.locator('.adm-status').innerText()).replace(/\n/g, ' | '));
    await p.click('.adm-actions .btn:has-text("Pause launches")'); log('pause:', await waitToast(/Pause launches done|failed|reverted|error|Admin only/i));
    await p.waitForTimeout(3000);
    await p.click('.adm-actions .btn:has-text("Resume launches")'); log('resume:', await waitToast(/Resume launches done|failed|reverted|error/i));
    await p.waitForTimeout(3000);
    const coin = p.locator('.adm-coin').first();
    if (await coin.count()) {
      await coin.locator('.btn:has-text("Hide")').first().click(); log('hide:', await waitToast(/Hide .* done|failed|reverted|error/i));
      await p.waitForTimeout(4000);
      log('hidden badge:', await p.locator('.adm-coin').first().locator('.badge.down').count());
      await p.locator('.adm-coin').first().locator('.btn:has-text("Unhide")').first().click(); log('unhide:', await waitToast(/Unhide .* done|failed|reverted|error/i));
      await p.waitForTimeout(3000);
      await p.locator('.adm-coin').first().locator('input[placeholder="tax %"]').fill('3');
      await p.locator('.adm-coin').first().locator('.btn:has-text("Set tax")').click(); log('set tax:', await waitToast(/tax done|failed|reverted|error/i));
      await p.waitForTimeout(3000);
      await p.locator('.adm-coin').first().locator('input[placeholder="metadata JSON or URI"]').fill(JSON.stringify({ description: 'Edited by admin', twitter: 'https://x.com/estonks' }));
      await p.locator('.adm-coin').first().locator('.btn:has-text("Set metadata")').click(); log('set metadata:', await waitToast(/metadata done|failed|reverted|error/i));
      await p.waitForTimeout(3000);
      const push = p.locator('.adm-coin').first().locator('.btn:has-text("Push fees")');
      log('push fees enabled:', await push.isEnabled());
      if (await push.isEnabled()) { await push.click(); log('push:', await waitToast(/fees done|failed|reverted|error/i)); }
    }
    await p.locator('.card:has(h3:has-text("Fee recipient")) input').fill(ADMIN);
    await p.locator('.card:has(h3:has-text("Fee recipient")) .btn.pri').click(); log('fee recipient:', await waitToast(/Set fee recipient done|failed|reverted|error/i));
    await p.waitForTimeout(3000); await shot(p, 'admin-after');
  }
} catch (e) {
  log('FAILED:', e.message.split('\n')[0]);
  await shot(p, 'failure');
} finally {
  log('page errors:', JSON.stringify(errs.slice(0, 10)));
  await b.close();
}
