// End-to-end run of private mode against the local mainnet fork: create a private
// wallet, shield ETH, buy and sell a coin privately from the coin page, then
// unshield to a fresh address. Proofs are made in the browser; the local relay
// (scripts/relay-dev.mjs) submits them.
//   COIN=0x... node scripts/e2e-private.mjs
import { chromium } from '/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/pw/node_modules/playwright-core/index.mjs';
import { injected } from './e2e-wallet.mjs';

const RPC = 'http://127.0.0.1:8546';
const SITE = 'http://localhost:4180';
const USER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const COIN = process.env.COIN;
const FRESH = '0x' + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');

const rpc = async (method, params = []) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()).result;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addInitScript(injected(USER, RPC));
// Record every toast so a failure shows its message.
await ctx.addInitScript(() => { window.__toasts = []; new MutationObserver(() => { const t = document.querySelector('.toast')?.textContent; if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t); }).observe(document, { subtree: true, childList: true, characterData: true }); });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error' && !/fonts|cdn|net::ERR|walletconnect|reown|Failed to load resource|coinbase|pulse|Analytics/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
const waitToast = async (re, t = 240000) => { const all = new RegExp(re.source + '|could not|wrong|invalid|not |no ', 'i'); return waitAny(all, t); };
const waitAny = async (re, t) => { await p.waitForFunction((s) => new RegExp(s, 'i').test(document.querySelector('.toast')?.textContent || ''), re.source, { timeout: t }); return p.locator('.toast').textContent(); };
const balance = async () => (await p.locator('.pv-hero .big').textContent());

try {
  // Connect the public wallet (for shielding).
  await p.goto(SITE + '/', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  await p.click('button.wallet');
  await p.locator('w3m-modal').waitFor({ timeout: 20000 }); await p.waitForTimeout(1500);
  await p.locator('w3m-modal wui-list-wallet, w3m-modal wui-list-item').filter({ hasText: /Estonks Test|Browser Wallet|Injected|MetaMask/i }).first().click({ timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('button.wallet .addr')?.textContent?.startsWith('0x'), null, { timeout: 30000 });
  log('connected');

  // 1. Create the private wallet.
  await p.goto(SITE + '/private', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  await p.fill('.pv-card input[autocomplete="new-password"] >> nth=0', 'correct horse battery');
  await p.fill('.pv-card input[autocomplete="new-password"] >> nth=1', 'correct horse battery');
  await p.click('.pv-card .btn.pri');
  await p.locator('.pv-words li').first().waitFor({ timeout: 60000 });
  log('recovery words:', await p.locator('.pv-words li').count());
  await p.check('.pv-check input'); await p.click('.pv-card .btn.pri');
  await p.locator('.pv-hero').waitFor({ timeout: 30000 });
  log('private address:', (await p.locator('.pv-addr').innerText()).replace(/\n/g, ' '));

  // 2. Shield 0.5 ETH.
  await p.fill('.pv-form input[inputmode="decimal"]', '0.5');
  await p.click('.pv-form .btn.pri');
  log('shield:', await waitToast(/Shield done|failed|reverted|error|Cancelled/i));
  await p.waitForTimeout(3000);
  await p.click('.pv-hero .btn:has-text("Refresh")'); await p.waitForTimeout(4000);
  log('private balance after shield:', await balance(), '|', (await p.locator('.list').first().innerText()).replace(/\n/g, ' | '));

  // 3. Private buy on the coin page.
  await p.goto(SITE + '/t/' + COIN, { waitUntil: 'load' }); await p.waitForTimeout(6000);
  await p.click('.tside .dock-private button');
  log('dock:', (await p.locator('.tside .dock-private').innerText()).replace(/\n/g, ' '));
  await p.fill('.tside .tcard .bi input', '0.2'); await p.waitForTimeout(1500);
  log('estimate:', await p.locator('.tside .tcard output').textContent(), '| button:', await p.locator('.tside .tcard .go').textContent());
  const t0 = Date.now();
  await p.click('.tside .tcard .go');
  log('private buy:', await waitToast(/Private buy .* done|failed|reverted|error|offline|rejected/i), `(${Math.round((Date.now() - t0) / 1000)}s)`);
  await p.waitForTimeout(3000);

  // 4. Private sell half.
  await p.click('.tside .seg button:has-text("Sell")'); await p.waitForTimeout(500);
  await p.click('.tside .q button:has-text("50%")'); await p.waitForTimeout(1500);
  log('sell amount:', await p.locator('.tside .tcard .bi input').inputValue(), '| estimate ETH:', await p.locator('.tside .tcard output').textContent());
  await p.click('.tside .tcard .go');
  log('private sell:', await waitToast(/Private sell .* done|failed|reverted|error|offline|rejected/i));

  // 5. Unshield 0.1 ETH to a fresh address.
  await p.goto(SITE + '/private', { waitUntil: 'load' }); await p.waitForTimeout(1500);
  if (await p.locator('.pv-hero').count() === 0) { await p.fill('.pv-card input[type="password"]', 'correct horse battery'); await p.click('.pv-card .btn.pri'); await p.locator('.pv-hero').waitFor({ timeout: 30000 }); }
  await p.waitForTimeout(4000);
  log('private balance before unshield:', await balance(), '|', (await p.locator('.list').first().innerText()).replace(/\n/g, ' | '));
  await p.click('.pv-seg button:has-text("Unshield")');
  await p.fill('.pv-form input[inputmode="decimal"]', '0.1');
  await p.fill('.pv-form input[placeholder^="0x"]', FRESH);
  await p.click('.pv-form .btn.pri');
  log('unshield:', await waitToast(/Unshield done|failed|reverted|error|offline|rejected/i));
  log('fresh address received ETH:', Number(BigInt(await rpc('eth_getBalance', [FRESH, 'latest']))) / 1e18);
  await p.waitForTimeout(3000);
  await p.screenshot({ path: '/tmp/claude-0/e2e-private.png', fullPage: true });
  log('private balance end:', await balance());
} catch (e) {
  log('FAILED:', e.message.split('\n')[0]);
  log('toasts:', JSON.stringify(await p.evaluate(() => window.__toasts).catch(() => [])));
  await p.screenshot({ path: '/tmp/claude-0/e2e-private-failure.png' });
} finally {
  log('page errors:', JSON.stringify(errs.slice(0, 10)));
  await b.close();
}
