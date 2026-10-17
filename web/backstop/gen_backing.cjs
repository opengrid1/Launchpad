/* Builds site/backing.json: every Ondo tokenized stock on Ethereum and how the Etherhook
   oracle prices it, for the launch picker and the admin page.

     pool   registered on the oracle from its Uniswap pool (30-minute average); anyone can do this
     feed   the admin lists it with its Chainlink feed (updates itself)
     price  the admin lists it at a fixed price: the underlying's last price (Yahoo Finance)
            times Ondo's share multiplier (sValue), the same formula Chainlink's feeds use

   node gen_backing.cjs   (from web/backstop; reads ../../contracts/deployments) */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC = process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const DEP = path.join(__dirname, '..', '..', 'contracts', 'deployments');
const OUT = path.join(__dirname, 'site', 'backing.json');
const SVALUE_ORACLE = '0x9BC39DB6fbB44B91a48b8D5A6C208B82B1741bE6';
const USDT = { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', feed: '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D' };
// Chainlink Ondo feeds on Ethereum (data.chain.link); "Calculated" = underlying x sValue
const FEEDS = {
  SPYon: ['0xd16cC387E87d37350f57421DaDF811968441C1a5', '0x6EcC1b902dB35eAFE95332443802774Fd1D72576'],
  QQQon: ['0x2098C245Fe4C80cdA93cF85Cff0718328D4eEa85', '0xE5DF423251c67D85B2D70787Af76069d96BC4D4C'],
  TSLAon: ['0x89904B6fcF8dAD1e5DA47dFdF69fC38Ad6be0bd5', '0x737401E0D1299D8A85b653Fd52823501f4FE0be0'],
  SGOVon: ['0xfE45662E9fA552464289B0568D4A846c6F284Db9', '0x03A624CB084536eA9cB51AbEeecBF47b325130C1'],
  IAUon: ['0x1f09475Fe4D212fC24611bAE180201869956c238', '0x8B3b1f59D7A813d512C1144AC45E58E6e5224160'],
  BILon: ['0x254599afD7f9F3f18775fC24693Ba0d1cE8A4Ac6', '0x3CB6d31DAB574111dE818507083024d4C3c717e0'],
  USFRon: ['0xC5D98E16Bcb6Cf753BA27A24Df2A04c2F0267E57', '0x09d6EbF4662b5534BD5feD4159A113Ca9d471098'],
  FLHYon: ['0x1f82248AB79b2D699Fc447F6B357cd15D529cbE8', '0x917da15AD7C4801eB63540D1db34A4174931e132'],
  STRCon: ['0xC353ac4b425f818Ad87E228bf816E15c2173AC07', '0x67d4Ae9f265270aE123c08D2657536771D19cD91'],
};
const FEED_FRESH = 3 * 86400; // the oracle accepts 7 days; pick feeds well inside that

const p = new ethers.JsonRpcProvider(RPC);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const yahoo = s => s.replace(/\./g, '-'); // BRK.B -> BRK-B

async function quote(ticker) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo(ticker))}?range=1d&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.status === 404) return null;
      const j = await r.json(); const m = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
      return m && m.regularMarketPrice > 0 && m.currency === 'USD' ? m.regularMarketPrice : null;
    } catch { await sleep(800); }
  }
  return null;
}

async function feedState(addr) {
  const f = new ethers.Contract(addr, ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)', 'function decimals() view returns (uint8)'], p);
  const [[, answer, , updatedAt], dec] = await Promise.all([f.latestRoundData(), f.decimals()]);
  return { answer: Number(answer) / 10 ** Number(dec), age: Math.floor(Date.now() / 1000) - Number(updatedAt), dec: Number(dec) };
}

(async () => {
  const toks = JSON.parse(fs.readFileSync(path.join(DEP, 'ondo-tokens-eth.json'))).tokens;
  const pools = JSON.parse(fs.readFileSync(path.join(DEP, 'ondo-sources.json'))).sources;
  const dep = JSON.parse(fs.readFileSync(path.join(DEP, 'eth-backstop.json')));
  const oracle = new ethers.Contract(dep.contracts.oracle, ['function sources(address) view returns (uint8 dex,address,address,int24,uint64,bytes32,uint256,uint32,uint256,uint32)'], p);
  // getSValueBatch reverts if any token in it is unknown to Ondo's oracle, so read them one by one through Multicall3
  const svi = new ethers.Interface(['function getSValue(address) view returns (uint128,bool)']);
  const mc = new ethers.Contract('0xcA11bde05977b3631167028862bE2a173976CA11', ['function aggregate3((address target,bool allowFailure,bytes callData)[]) view returns ((bool success,bytes returnData)[])'], p);
  const sval = {};
  for (let i = 0; i < toks.length; i += 150) {
    const part = toks.slice(i, i + 150).map(t => ethers.getAddress(t.address));
    const res = await mc.aggregate3(part.map(a => ({ target: SVALUE_ORACLE, allowFailure: true, callData: svi.encodeFunctionData('getSValue', [a]) })));
    part.forEach((a, k) => {
      if (!res[k].success) { sval[a] = { s: 0, paused: false, missing: true }; return; }
      const [v, paused] = svi.decodeFunctionResult('getSValue', res[k].returnData);
      sval[a] = { s: Number(v) / 1e18, paused };
    });
  }

  const out = []; let n = 0;
  for (const t of toks) {
    const address = ethers.getAddress(t.address); const ticker = t.symbol.replace(/on$/, '');
    const row = { symbol: t.symbol, name: t.name, address, ticker, sValue: +sval[address].s.toFixed(6) };
    const src = await oracle.sources(address);
    if (Number(src.dex) !== 0) row.kind = 'pool';
    const pool = pools.find(x => x.symbol === t.symbol);
    if (pool) { row.pool = { dex: pool.dex, label: pool.label }; if (pool.dex === 3 && pool.key) { row.v4Id = pool.v4Id; row.v4Key = pool.key; } }
    if (FEEDS[t.symbol]) {
      for (const f of FEEDS[t.symbol]) {
        try { const st = await feedState(f); if (st.dec === 8 && st.answer > 0 && st.age < FEED_FRESH) { row.feed = f; row.feedUsd = +st.answer.toFixed(4); break; } } catch {}
      }
    }
    // most tokens aren't in Ondo's multiplier oracle: use 1 (the gap is the dividends reinvested since launch, a few percent at most)
    if (sval[address].missing || !(sval[address].s > 0)) { sval[address] = { s: 1, paused: false }; row.sValue = 1; row.approx = true; }
    if (sval[address].paused) { row.skip = 'paused by Ondo'; out.push(row); continue; }
    const px = await quote(ticker); n++;
    if (px) row.usd = +(px * sval[address].s).toFixed(4);
    if (!row.kind) row.kind = row.feed ? 'feed' : row.usd ? 'price' : null;
    if (!row.kind) row.skip = 'no price for ' + ticker;
    out.push(row);
    if (n % 25 === 0) process.stdout.write(`  ${out.length}/${toks.length}\r`);
    await sleep(120);
  }
  const usdt = await feedState(USDT.feed);
  const doc = {
    note: 'How the Etherhook oracle prices each Ondo tokenized stock. kind: pool (registered from its Uniswap pool), feed (admin lists it with its Chainlink feed), price (admin lists it at usd, which is the underlying price x Ondo sValue). Generated by gen_backing.cjs.',
    generatedAt: new Date().toISOString(), oracle: dep.contracts.oracle,
    usdt: { ...USDT, usd: usdt.answer },
    tokens: out.sort((a, b) => a.symbol.localeCompare(b.symbol)),
  };
  fs.writeFileSync(OUT, JSON.stringify(doc));
  const by = k => out.filter(x => x.kind === k).length;
  console.log(`\n${out.length} tokens: ${by('pool')} pool, ${by('feed')} feed, ${by('price')} price, ${out.filter(x => x.skip).length} skipped`);
  for (const x of out.filter(x => x.kind === 'pool' || x.feed)) console.log(' ', x.symbol.padEnd(8), x.kind.padEnd(5), 'yahoo x sValue', x.usd, x.feed ? 'feed ' + x.feedUsd : '');
  for (const x of out.filter(x => x.skip).slice(0, 20)) console.log('  skip', x.symbol, x.skip);
})();
