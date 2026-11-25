/* Lootbag preview data: sample coins on Robinhood Chain, built from a fixed seed so every visit shows the same
   board. The live build replaces window.LB_DATA with the indexer (same shape). Real stock list and prices from
   stocks.json (the Robinhood Chain stock tokens). */
(function () {
  let seed = 20261125;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const now = () => Math.floor(Date.now() / 1000);
  const T0 = Math.floor(Date.now() / 1000 / 60) * 60;
  const ETH_USD = 1821.4;
  const hex = (n) => { let s = '0x'; for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(rnd() * 16)]; return s; };
  const addr = () => hex(40);

  const STOCKS = [];
  const LB = (window.LB_DATA = { ethUsd: ETH_USD, stocks: STOCKS, coins: [], ready: null });

  const NAMES = [
    ['Loot', 'LOOT'], ['Golden Goose', 'GOOSE'], ['Stonks Cat', 'STONKS'], ['Dividend Dog', 'DIVDOG'], ['Treasure Toad', 'TOAD'],
    ['Paycheck Pepe', 'PAYPEPE'], ['Robo Raccoon', 'RACC'], ['Moon Bag', 'MBAG'], ['Coin Purse', 'PURSE'], ['Nvidia Neko', 'NEKO'],
    ['Silver Spoon', 'SPOON'], ['Piggy Bank', 'PIGGY'], ['Yield Yeti', 'YETI'], ['Tesla Turtle', 'TURT'], ['Apple Pie', 'PIE'],
    ['Bag Holder', 'HODLR'], ['Sack of Gold', 'SACK'], ['Pocket Money', 'POCKET'], ['Allowance', 'ALLOW'], ['Jackpot Jim', 'JIM'],
    ['Lucky Lynx', 'LYNX'], ['Index Iguana', 'IGGY'], ['Gold Goblin', 'GOBLIN'], ['Cash Cow', 'MOO'], ['Rich Rabbit', 'RICH'],
    ['Loot Goblin', 'LGOB'], ['Paid Panda', 'PANDA'], ['Spy Sloth', 'SLOTH'], ['Coupon Crab', 'CRAB'], ['Mega Moose', 'MOOSE'],
    ['Bull Bag', 'BULLBAG'], ['Grill Money', 'GRILL'], ['Gains Gecko', 'GECKO'], ['Paper Hands', 'PAPER'], ['Diamond Duck', 'DUCK'],
    ['Copper Coin', 'COPPER'], ['Treasury Tiger', 'TIGER'], ['Pay Day', 'PAYDAY'], ['Bread Bag', 'BREAD'], ['Loaded Llama', 'LLAMA'],
  ];
  const DESCS = ['Holders get paid every five minutes.', 'A bag that fills itself.', 'Hold it, get stocks.', 'Every trade drops loot to holders.', 'No claim, just rewards.', '', 'Community coin. The pool pays the bag.', 'Stocks for holders, memes for everyone.'];
  const HUES = [42, 160, 200, 280, 330, 12, 90, 220, 260, 190];

  function series(start, end, n) {
    // a random walk that ends at `end`, from about `start`
    const out = []; let p = start;
    for (let i = 0; i < n; i++) { const drift = (end - p) / (n - i); p = Math.max(start * 0.3, p + drift + (rnd() - 0.5) * p * 0.08); out.push(p); }
    out[n - 1] = end; return out;
  }

  function build(stocks) {
    for (const [sym, name, usd] of stocks) STOCKS.push({ sym, name, usd });
    const top = ['NVDA', 'TSLA', 'AAPL', 'SPY', 'QQQ', 'MSFT', 'GOOGL', 'META', 'AMZN', 'COIN', 'PLTR', 'AMD'].map((s) => STOCKS.find((x) => x.sym === s)).filter(Boolean);
    NAMES.forEach(([name, ticker], i) => {
      const official = i === 0;
      const pairKind = official ? 'ETH' : pick(['ETH', 'ETH', 'ETH', 'USDG', 'STOCK']);
      const pair = pairKind === 'STOCK' ? pick(top).sym : pairKind;
      const nRewards = official ? 4 : pick([1, 1, 1, 2, 3, 5]);
      const rewards = official ? ['NVDA', 'TSLA', 'SPY', 'LOOT'] : Array.from(new Set(Array.from({ length: nRewards }, () => (rnd() < 0.25 ? 'ETH' : pick(top).sym))));
      const ageMin = official ? 60 * 24 * 9 : Math.floor(rnd() ** 2 * 60 * 24 * 6) + 3;
      const mcap = official ? 1_240_000 : Math.round(6500 * Math.exp(rnd() ** 1.6 * 4.2));
      const vol24 = Math.round(mcap * (0.15 + rnd() * 1.6));
      const holders = Math.max(3, Math.round(mcap / (300 + rnd() * 900)));
      const fees24 = vol24 * 0.02, paid24 = vol24 * 0.005;
      const n = 120, start = 5200;
      const closes = series(start, mcap, n);
      const candles = closes.map((c, k) => { const o = k ? closes[k - 1] : start; return { t: T0 - (n - k) * 300, o, c, h: Math.max(o, c) * (1 + rnd() * 0.04), l: Math.min(o, c) * (1 - rnd() * 0.04), v: Math.round(vol24 / n * (0.3 + rnd() * 1.7)) }; });
      const ch24 = (mcap / closes[Math.max(0, n - 48)] - 1) * 100;
      const c = {
        addr: official ? '0x10070000000000000000000000000000000b4c' : addr(), name, ticker, official,
        desc: official ? 'The Lootbag platform token. Its pool pays its holders in stocks, and every coin on Lootbag buys some back.' : pick(DESCS),
        hue: HUES[i % HUES.length], creator: addr(), createdAt: now() - ageMin * 60, pair, rewards, rewardIx: Math.floor(rnd() * rewards.length),
        mcap, priceUsd: mcap / 1e9, ch24, vol24, holders, trades24: Math.round(vol24 / (40 + rnd() * 160)), fees24, paid24, paidAll: paid24 * (1 + rnd() * 6),
        pot: rnd() * 6.4, nextPayout: 60 + Math.floor(rnd() * 240), candles,
        x: rnd() < 0.6 ? 'https://x.com/' + ticker.toLowerCase() : '', tg: rnd() < 0.3 ? 'https://t.me/' + ticker.toLowerCase() : '', web: '',
      };
      c.trades = Array.from({ length: 30 }, (_, k) => { const buy = rnd() < 0.62, usd = Math.round(20 + rnd() ** 2 * 1800); return { ts: now() - k * Math.floor(20 + rnd() * 240), wallet: addr(), buy, usd, tokens: usd / c.priceUsd }; });
      c.holderList = Array.from({ length: Math.min(20, holders) }, (_, k) => ({ wallet: addr(), pct: (k === 0 ? 4.2 : 3.4 * Math.exp(-k / 5)) * (0.6 + rnd() * 0.8) })).sort((a, b) => b.pct - a.pct);
      c.payouts = Array.from({ length: 8 }, (_, k) => ({ ts: now() - (k + 1) * 300 * (1 + Math.floor(rnd() * 3)), usd: 5 + rnd() * 40, token: rewards[(c.rewardIx + rewards.length - 1 - (k % rewards.length)) % rewards.length], wallets: Math.round(holders * (0.5 + rnd() * 0.4)) }));
      LB.coins.push(c);
    });
    // the trader airdrop round and the Lootbag NFTs
    const roundEnd = T0 + 3 * 3600 + 1240;
    LB.airdrop = { pot: 34.82, potUsd: 34.82 * ETH_USD, endsAt: roundEnd, traders: 742, volume: 412_830, board: Array.from({ length: 50 }, (_, k) => ({ wallet: addr(), vol: Math.round(14000 * Math.exp(-k / 9) + 60 + rnd() * 400) })).sort((a, b) => b.vol - a.vol) };
    LB.bags = { total: 1000, minted: 244, perMintLoot: 100_000, perMintEth: 0.05, pot: 61.3, paidUsd: 18_240, nextHour: 3600 - (now() % 3600), rotation: ['SPY', 'NVDA', 'TSLA', 'QQQ', 'LOOT'], today: 'NVDA',
      list: Array.from({ length: 24 }, (_, k) => ({ id: k + 1, earned: Math.round(140 - k * 2.1 + rnd() * 20), hue: Math.floor(rnd() * 360) })) };
    LB.platform = { volumeAll: 6_820_000, paidHolders: 142_300, coins: LB.coins.length, traders: 6_910, burnedLoot: 24_400_000 };
  }

  LB.ready = fetch('stocks.json').then((r) => r.json()).then(build);
})();
