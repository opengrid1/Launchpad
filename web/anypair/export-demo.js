// Snapshot the fork's coins, trades and holders for the preview site's sample mode.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => { const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--proxy-bypass-list=127.0.0.1;localhost', '--ignore-certificate-errors'] });
  const p = await b.newPage(); await p.goto('http://127.0.0.1:8790/', { waitUntil: 'networkidle' }); await p.waitForFunction(() => AP.tokens().length > 0 && !AP.stale, null, { timeout: 60000 });
  const d = await p.evaluate(async () => { const tokens = AP.tokens().filter(x => !x.hidden); const all = await AP.trades(null, 5000); const holders = {}; for (const x of tokens) holders[x.addr] = await AP.holders(x.addr, 40);
    return { head: AP.nowTs(), tokens, trades: all.map(t => ({ token: t.token, buy: t.buy, pair: t.pair, coin: t.coin, sqrt: t.sqrt, block: t.block, ts: t.ts, tx: t.tx, i: t.i, wallet: t.wallet })).reverse(), holders }; });
  fs.writeFileSync(process.argv[2], JSON.stringify(d)); console.log('coins', d.tokens.length, 'trades', d.trades.length, 'bytes', JSON.stringify(d).length); await b.close(); })();
