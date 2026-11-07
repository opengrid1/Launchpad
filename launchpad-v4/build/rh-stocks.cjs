// Checks the Robinhood stock tokens on Robinhood Chain against their USDG pools and writes brands/zappy/stocks.json:
// per stock its ETH route (v3: WETH -> USDG -> stock as a packed path; v4: ETH -> USDG -> stock as v4 hops), its USD
// price and its USDG pool's liquidity; and brands/zappy/api/_pairs.json, what the indexer reads to price each stock
// in ETH (the pools along its route, as v3 pool addresses or v4 pool ids) and the share its pools' fees take.
// Source list: ../contracts/config/rh-stock-routes.json (77 stocks).
//   node build/rh-stocks.cjs
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');
const P = new ethers.JsonRpcProvider(process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com', 4663, { staticNetwork: true });
const WETH = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', Z = ethers.ZeroAddress;
const V3F = '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA', SV = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
const ETH_USDG_V4 = { fee: 500, ts: 10, hooks: Z }; // the deepest hookless ETH/USDG v4 pool
const WETH_USDG_V3 = 100;
const MC = new ethers.Contract('0xcA11bde05977b3631167028862bE2a173976CA11', ['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[])'], P);
const fI = new ethers.Interface(['function getPool(address,address,uint24) view returns (address)']);
const pI = new ethers.Interface(['function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)', 'function liquidity() view returns (uint128)']);
const sI = new ethers.Interface(['function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)', 'function getLiquidity(bytes32) view returns (uint128)']);
const tI = new ethers.Interface(['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function paused() view returns (bool)']);
const mc = async (calls) => (await MC.aggregate3(calls.map(([t, i, f, a]) => [t, true, i.encodeFunctionData(f, a || [])]))).map(([ok, d], n) => { if (!ok) return null; try { const r = calls[n][1].decodeFunctionResult(calls[n][2], d); return r.length === 1 ? r[0] : r; } catch { return null; } });
const id = (a, b, fee, ts, hooks) => { const [c0, c1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a]; return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], [c0, c1, fee, ts, hooks])); };
// price of `b` in units of `a`, both by decimals, from a sqrtPriceX96 of the (c0, c1) pool
const priceOf = (sqrt, c0, d0, d1, a) => { const p1per0 = (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (d0 - d1); return BigInt(a) === BigInt(c0) ? 1 / p1per0 : p1per0; };

(async () => {
  const list = require('../../contracts/config/rh-stock-routes.json');
  const [ethPool] = await mc([[V3F, fI, 'getPool', [WETH, USDG, WETH_USDG_V3]]]);
  const [ethSlot, ethLiq, v4Eth] = await mc([[ethPool, pI, 'slot0'], [ethPool, pI, 'liquidity'], [SV, sI, 'getSlot0', [id(Z, USDG, ETH_USDG_V4.fee, ETH_USDG_V4.ts, Z)]]]);
  const ethUsd = priceOf(ethSlot[0], BigInt(WETH) < BigInt(USDG) ? WETH : USDG, BigInt(WETH) < BigInt(USDG) ? 18 : 6, BigInt(WETH) < BigInt(USDG) ? 6 : 18, USDG);
  const ethUsdV4 = priceOf(v4Eth[0], Z, 18, 6, USDG);
  console.log(`ETH: $${ethUsd.toFixed(2)} on the WETH/USDG v3 pool (liquidity ${ethLiq}), $${ethUsdV4.toFixed(2)} on the ETH/USDG v4 pool`);
  const meta = await mc(list.flatMap((s) => [[s.address, tI, 'symbol'], [s.address, tI, 'decimals'], [s.address, tI, 'paused']]));
  const pools = await mc(list.map((s) => (s.venue === 'v3' ? [V3F, fI, 'getPool', [USDG, s.address, s.fee]] : [SV, sI, 'getSlot0', [id(USDG, s.address, s.fee, s.tickSpacing, Z)]])));
  const st = await mc(list.flatMap((s, n) => (s.venue === 'v3' ? [[pools[n] || Z, pI, 'slot0'], [pools[n] || Z, pI, 'liquidity']] : [[SV, sI, 'getSlot0', [id(USDG, s.address, s.fee, s.tickSpacing, Z)]], [SV, sI, 'getLiquidity', [id(USDG, s.address, s.fee, s.tickSpacing, Z)]]])));
  const out = [], bad = [];
  for (const [n, s] of list.entries()) {
    const sym = meta[n * 3], dec = Number(meta[n * 3 + 1]), paused = meta[n * 3 + 2];
    let slot = st[n * 2], liq = st[n * 2 + 1], quote = USDG, route = s.venue === 'v3' ? { route: 'v3', path: [WETH, WETH_USDG_V3, USDG, s.fee, s.address] } : { route: 'v4', hops: [{ c: USDG, ...ETH_USDG_V4 }, { c: s.address, fee: s.fee, ts: s.tickSpacing, hooks: Z }] };
    if (sym && dec === 18 && paused !== true && (!slot || !liq || liq === 0n)) {
      // the listed pool is empty: the deepest v3 pool against USDG or WETH instead
      const tries = [USDG, WETH].flatMap((q) => [100, 500, 3000, 10000].map((fee) => [q, fee]));
      const pa = await mc(tries.map(([q, fee]) => [V3F, fI, 'getPool', [q, s.address, fee]]));
      const lq = await mc(tries.map((_, i) => [pa[i] || Z, pI, 'liquidity']));
      let best = -1; tries.forEach((_, i) => { if (pa[i] && pa[i] !== Z && lq[i] && lq[i] > 0n && (best < 0 || lq[i] > lq[best])) best = i; });
      if (best >= 0) {
        const [q, fee] = tries[best]; quote = q; liq = lq[best]; [slot] = await mc([[pa[best], pI, 'slot0']]);
        route = { route: 'v3', path: q === WETH ? [WETH, fee, s.address] : [WETH, WETH_USDG_V3, USDG, fee, s.address] };
      }
    }
    if (!sym || dec !== 18 || paused === true || !slot || !liq || liq === 0n || slot[0] === 0n) { bad.push(`${s.symbol} (${!sym ? 'no token' : dec !== 18 ? 'decimals ' + dec : paused ? 'paused' : 'no pool liquidity'})`); continue; }
    const qd = quote === USDG ? 6 : 18, c0 = BigInt(quote) < BigInt(s.address) ? quote : s.address;
    const usd = priceOf(slot[0], c0, c0 === quote ? qd : 18, c0 === quote ? 18 : qd, quote) * (quote === WETH ? ethUsd : 1);
    out.push({ key: s.symbol.toLowerCase(), sym: s.symbol, name: s.name, addr: s.address, usd: +usd.toFixed(4), liquidity: liq.toString(), info: route });
  }
  out.sort((a, b) => list.findIndex((x) => x.symbol === a.sym) - list.findIndex((x) => x.symbol === b.sym));
  // pricing legs from ETH outward: each gives (out per in) from one pool's sqrt price
  const v3pool = async (a, b, fee) => (await mc([[V3F, fI, 'getPool', [a, b, fee]]]))[0];
  const dec = (a) => (a === USDG ? 6 : 18);
  const leg3 = async (a, b, fee) => ({ kind: 'v3', pool: (await v3pool(a, b, fee)).toLowerCase(), a: a.toLowerCase(), b: b.toLowerCase(), da: dec(a), db: dec(b) });
  const leg4 = (a, b, fee, ts, hooks) => ({ kind: 'v4', id: id(a, b, fee, ts, hooks), a: a.toLowerCase(), b: b.toLowerCase(), da: dec(a), db: dec(b) });
  const pairs = {};
  for (const st of out) {
    const legs = [], I = st.info; let fees = 0;
    if (I.route === 'v3') for (let i = 0; i + 2 < I.path.length; i += 2) { legs.push(await leg3(I.path[i], I.path[i + 2], I.path[i + 1])); fees += I.path[i + 1]; }
    else { let from = Z; for (const h of I.hops) { legs.push(leg4(from, h.c, h.fee, h.ts, h.hooks)); fees += h.fee; from = h.c; } }
    pairs[st.addr.toLowerCase()] = { sym: st.sym, ...I, legs, feeCut: fees / 1e6 };
  }
  const apiDir = path.join(__dirname, '../brands/zappy/api'); fs.mkdirSync(apiDir, { recursive: true });
  fs.writeFileSync(path.join(apiDir, '_pairs.json'), JSON.stringify({ robinhood: pairs }));
  const file = path.join(__dirname, '../brands/zappy/stocks.json');
  fs.writeFileSync(file, JSON.stringify({ updated: new Date().toISOString(), ethUsd: +ethUsd.toFixed(2), weth: WETH, usdg: USDG, stocks: out }, null, 1));
  console.log(`${out.length} stocks ok, ${bad.length} left out${bad.length ? ': ' + bad.join(', ') : ''}`);
  console.log(out.slice(0, 8).map((s) => `${s.sym} $${s.usd} (${s.info.route})`).join(', '));
})().catch((e) => { console.error('FAILED', e.shortMessage || e.message); process.exit(1); });
