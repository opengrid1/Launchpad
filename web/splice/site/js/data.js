/* Splice data layer. In preview there are no contracts, so the coins here are deterministic
   examples generated from a seed. When contracts go live this module is swapped for one that
   reads the chain; every page only ever talks to window.UD, so nothing else changes.

   A coin is spliced from "genes" — composable on-chain mechanics. One immutable hook enforces a
   constitution (anti-sandwich, fee ceiling, can't block a sell, locked LP) that no gene can break;
   each launch then picks the genes it wants. GENES describes every optional gene; CONSTITUTION is
   the always-on core. */
(function () {
  const CFG = window.SPLICE || {};

  // ---- the optional genes a launch can splice in -------------------------------------------
  const GENES = {
    fee:     { key: 'fee',     name: 'Fee engine',     cls: 'g-fee',     short: 'flat / dynamic / MEV-tax',
               desc: 'Sets the swap fee. Flat (a fixed %), dynamic (widens with volatility, tightens when calm), or an MEV-tax that scales the fee with the transaction’s priority fee so snipers and sandwichers pay the pool, not the block builder. Clamped to the constitutional ceiling.' },
    snipe:   { key: 'snipe',   name: 'Anti-snipe',     cls: 'g-snipe',   short: 'decaying launch tax',
               desc: 'An extra tax on the first minutes of trading that decays block by block back to the base fee. Bots that pile into block zero pay it to every holder; by the time real buyers arrive it is gone.' },
    buyback: { key: 'buyback', name: 'Reflexive buyback', cls: 'g-buyback', short: 'fee-funded buy & burn',
               desc: 'A slice of every fee accumulates and, past a threshold, market-buys the coin from its own pool and burns it. Volume tightens supply with no team discretion — the hook does it in the swap path.' },
    div:     { key: 'div',     name: 'Dividends',      cls: 'g-div',     short: 'fees paid to holders',
               desc: 'Routes a share of fees back to holders pro-rata, claimable in ETH. No rebase, no transfer tax games — the pool collects, the hook splits, holders claim.' },
    maxw:    { key: 'maxw',    name: 'Max-wallet',     cls: 'g-maxw',    short: 'anti-whale cap',
               desc: 'Caps how much any one wallet can hold for an opening window, then lifts. Keeps a single buyer from owning the launch before a community forms. A rule the hook can only loosen, never tighten — holders know the worst case at launch.' },
    agent:   { key: 'agent',   name: 'AI agent',       cls: 'g-agent',   short: 'post-quantum signed',
               desc: 'An optional off-chain agent proposes fee and buyback parameters within the constitution; the hook reads them read-only and clamps them. Agent instructions are authorised by a hash-based, post-quantum signature scheme, so the coin keeps running even against a quantum adversary.' },
  };
  const GENE_ORDER = ['fee', 'snipe', 'buyback', 'div', 'maxw', 'agent'];

  // ---- the immutable core every coin inherits (not pickable — always on) ---------------------
  const CONSTITUTION = [
    { name: 'Anti-sandwich', desc: 'One swap per address per block, enforced by the core. Sandwich attacks are prevented at the base, not taxed after the fact.' },
    { name: 'Fee ceiling',   desc: 'No gene can push the total fee past the hard cap. Every fee result is clamped at the source.' },
    { name: 'Sells never block', desc: 'The hook can read a sell but can never revert one. No honeypots, no pausing, no blacklist.' },
    { name: 'Locked liquidity', desc: 'Launch liquidity is minted to a locker and can never be pulled. Only fees are ever collected.' },
    { name: 'No owner, no mint', desc: 'The token is fixed-supply, ownerless, with no mint, no pause and no transfer tax. Mechanics live in the pool, not the coin.' },
  ];

  // ---- deterministic example coins (preview only) ------------------------------------------
  let seed = (0x5c01ce ^ 0x9e3779b9) >>> 0;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1e6) / 1e6; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const addr = () => '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

  function spark(up, n = 48) {
    const pts = []; let v = 50 + rnd() * 20;
    for (let i = 0; i < n; i++) { v += (rnd() - 0.5 + up * 0.14) * 6; v = Math.max(8, Math.min(92, v)); pts.push(v); }
    return pts;
  }

  const SAMPLES = [
    ['Helix', 'HELIX', 2, ['fee', 'buyback', 'snipe'], '#27e39a'],
    ['Splicer', 'SPLCR', 1, ['fee', 'div', 'maxw'], '#5aa9ff'],
    ['Codon', 'CODON', -1, ['fee', 'snipe'], '#f5b74b'],
    ['Allele', 'ALLE', 3, ['fee', 'buyback', 'agent'], '#b07cff'],
    ['Plasmid', 'PLSMD', -2, ['fee', 'maxw'], '#ff8bbf'],
    ['Ribo', 'RIBO', 1, ['fee', 'div', 'buyback'], '#27e39a'],
    ['Enzyme', 'ENZ', 2, ['fee', 'snipe', 'maxw', 'buyback'], '#4ad7c6'],
    ['Vector', 'VECT', -1, ['fee', 'agent', 'buyback'], '#5aa9ff'],
    ['Mitosis', 'MITO', 4, ['fee', 'snipe', 'div'], '#f5b74b'],
    ['Strand', 'STRND', 1, ['fee', 'maxw'], '#b07cff'],
    ['Primer', 'PRIM', -3, ['fee', 'snipe'], '#ff5d6c'],
    ['Nucleo', 'NUCL', 2, ['fee', 'buyback', 'div', 'maxw'], '#27e39a'],
  ];

  const now = Math.floor(Date.now() / 1000);
  const COINS = SAMPLES.map((s, i) => {
    const [name, symbol, dir, genes, color] = s;
    const mc = Math.round((8 + rnd() * 240) * 1000) * (dir > 2 ? 4 : 1);
    const price = (mc / 1e9);
    const c24 = (dir * (4 + rnd() * 22)) * (rnd() > 0.5 ? 1 : 0.6);
    const sp = spark(dir);
    return {
      addr: addr(), name, symbol, color,
      pair: { symbol: 'ETH', logo: '/img/eth.svg' },
      price, mc, fdv: mc, c24,
      vol24: Math.round((mc * (0.15 + rnd() * 1.4))),
      liq: Math.round(mc * (0.12 + rnd() * 0.2)),
      holders: Math.round(30 + rnd() * 1800),
      createdTs: now - Math.round(rnd() * 86400 * 9) - 600,
      genes, spark: sp,
      creator: addr(),
      feeBps: genes.includes('agent') ? 'dynamic' : 100,
    };
  }).sort((a, b) => b.vol24 - a.vol24);

  const byAddr = {}; COINS.forEach(c => byAddr[c.addr.toLowerCase()] = c);

  // trade tape (recent swaps across coins)
  function recentTrades(n = 14) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = pick(COINS); const buy = rnd() > 0.42;
      out.push({ coin: c, buy, eth: +(0.02 + rnd() * 3.2).toFixed(3), ts: now - Math.round(rnd() * 5400), maker: addr() });
    }
    return out.sort((a, b) => b.ts - a.ts);
  }

  window.UD = {
    cfg: CFG,
    GENES, GENE_ORDER, CONSTITUTION,
    tokens: () => COINS,
    coin: a => byAddr[(a || '').toLowerCase()] || null,
    newest: () => [...COINS].sort((a, b) => b.createdTs - a.createdTs),
    recentTrades,
    gene: k => GENES[k],
  };
})();
