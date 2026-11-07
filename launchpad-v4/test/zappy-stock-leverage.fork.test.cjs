// Leverage on stock-paired coins (Robinhood Chain fork at 127.0.0.1:8550, stack from deploy-v2.cjs with LEVERAGE=1 and
// STOCKS): an NVDA-paired coin (route WETH -> USDG -> NVDA on v3) and a META-paired coin (ETH -> USDG -> META on v4).
// A market buys each up with the stock itself (taken from the PoolManager's stock balance on the fork, so the thin
// stock pools the trader's ETH goes through are left as they are on mainnet); a trader opens a 3x long paying ETH (the swapper turns it into the stock, the coin's
// pool lends the rest in the stock), closes it for ETH, opens again and is liquidated after a dump; the keeper and the
// trader are paid in the stock.
//   node test/zappy-stock-leverage.fork.test.cjs
const { ethers } = require('ethers');
const ROUTES = require('../site/routes.js');
const dep = require('../deployments/zappytest-v2-robinhood-fork.json');
const S = require('../brands/zappy/stocks.json');
const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || 'http://127.0.0.1:8550', undefined, { staticNetwork: true, cacheTimeout: -1 });
const UR = '0x8876789976decbfcbbbe364623c63652db8c0904', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const KEYS = { owner: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', trader: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', market: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', keeper: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' };
const W = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, new ethers.NonceManager(new ethers.Wallet(v, P))]));
const art = (n) => require('../artifacts/' + n + '.json').abi;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
const E = (v) => ethers.parseEther(String(v)), f = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const later = async (s) => { await P.send('evm_increaseTime', [s]); await P.send('evm_mine', []); };
const ERC = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const dl = () => BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 400);

(async () => {
  const addr = {}; for (const k in W) { addr[k] = await W[k].getAddress(); await P.send('hardhat_setBalance', [addr[k], '0x' + (1000n * 10n ** 18n).toString(16)]); }
  const as = (n, a, w) => new ethers.Contract(a, art(n), w);
  for (const [n, a] of [['BuzzPadHook', dep.hook], ['BuzzPadFactory', dep.factory], ['ZappyLocker', dep.locker], ['ZappySwapper', dep.leverage.swapper], ['ZappyMargin', dep.leverage.margin]]) {
    const c = as(n, a, W.owner); if ((await c.pendingOwner()) === addr.owner) await (await c.acceptOwnership()).wait();
  }
  const F = as('BuzzPadFactory', dep.factory, W.owner), M = as('ZappyMargin', dep.leverage.margin, W.owner), SW = as('ZappySwapper', dep.leverage.swapper, W.owner);
  if (!(await F.launchEnabled())) await (await F.setLaunchEnabled(true)).wait();
  if (!(await M.opensEnabled())) await (await M.setOpensEnabled(true)).wait();
  const Mt = as('ZappyMargin', dep.leverage.margin, W.trader), Mk = as('ZappyMargin', dep.leverage.margin, W.keeper);

  for (const sym of ['NVDA', 'META']) {
    const sp = dep.stockPairs.find((s) => s.sym === sym), st = S.stocks.find((s) => s.sym === sym), perEth = S.ethUsd / st.usd;
    console.log(`-- ${sym}-paired coin (${sp.info.route})`);
    ok(await SW.hasRoute(sp.addr), `swapper has a route for ${sym}; min depth ${f(await SW.minDepth(sp.addr))} ${sym} (~5 ETH)`);
    const params = { name: 'Lev ' + sym, symbol: 'L' + sym, logo: 'https://x.test/l.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: ethers.ZeroAddress, creatorTaxBps: 0, expectedEconomics: ethers.ZeroHash, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
    const r = await (await as('BuzzPadFactory', dep.factory, W.trader).launch(params, sp.cfg, { value: await F.launchFee(), gasLimit: 3_000_000n })).wait();
    const coin = r.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched').args.token;
    const T = new ethers.Contract(coin, ERC, P), STK = new ethers.Contract(sp.addr, ERC, P);
    await later(20);
    // the market trades the coin against the stock directly on the coin's pool (one v4 swap through the router)
    const AC = ethers.AbiCoder.defaultAbiCoder(), URI = new ethers.Interface(['function execute(bytes,bytes[],uint256) payable']);
    const v4 = (zfo, inC, outC, amt) => URI.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], ['0x060c0f', [AC.encode(['((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'], [[[sp.addr, coin, 0, 200, dep.hook], zfo, amt, 1n, 0n, '0x']]), AC.encode(['address', 'uint256'], [inC, amt]), AC.encode(['address', 'uint256'], [outC, 1n])]])], dl()]);
    const buyPair = async (amt) => (await W.market.sendTransaction({ to: UR, data: v4(true, sp.addr, coin, amt), gasLimit: 1_500_000n })).wait();
    const sell = async (amt) => (await W.market.sendTransaction({ to: UR, data: v4(false, coin, sp.addr, amt), gasLimit: 1_500_000n })).wait();
    const PM = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
    await P.send('hardhat_impersonateAccount', [PM]); await P.send('hardhat_setBalance', [PM, '0x' + (10n ** 18n).toString(16)]);
    const seed = E((perEth * 20).toFixed(6));
    await P.send('eth_sendTransaction', [{ from: PM, to: sp.addr, data: new ethers.Interface(['function transfer(address,uint256)']).encodeFunctionData('transfer', [addr.market, seed]) }]);
    await P.send('hardhat_stopImpersonatingAccount', [PM]);
    const p2 = new ethers.Interface(['function approve(address,address,uint160,uint48)']);
    for (const tkn of [coin, sp.addr]) { await (await new ethers.Contract(tkn, ERC, W.market).approve(PERMIT2, ethers.MaxUint256)).wait(); await (await W.market.sendTransaction({ to: PERMIT2, data: p2.encodeFunctionData('approve', [tkn, UR, (1n << 160n) - 1n, Number(dl())]) })).wait(); }
    for (let i = 0; i < 15; i++) await buyPair(E((perEth).toFixed(6)));
    await later(700);
    const depth = await M.poolDepth(coin), maxM = await M.maxMargin(coin, 30000);
    ok(depth >= (await SW.minDepth(sp.addr)) && maxM > 0n, `after 15 ETH's worth of ${sym} buys: pool depth ${f(depth)} ${sym}, max margin at 3x ${f(maxM)} ${sym}`);
    // the margin in ETH: 60% of the largest, at the listed price, so the swap's fees keep it under the cap
    const mEth = E((Number(ethers.formatEther(maxM)) * 0.6 / perEth).toFixed(6));
    const openPos = async () => { const rc = await (await Mt.open(coin, 30000, 0, 1n, { value: mEth, gasLimit: 3_000_000n })).wait(); return rc.logs.map((l) => { try { return M.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'PositionOpened').args; };
    let p = await openPos(); const pos = await M.positions(p.id);
    ok(pos.pair === sp.addr && p.borrowed === p.margin * 2n, `3x long paid with ${f(mEth)} ETH: margin ${f(p.margin)} ${sym}, borrowed ${f(p.borrowed)} ${sym} from the coin's pool`);
    // close in profit: ETH back to the trader
    await buyPair(E((perEth * 2).toFixed(6)));
    const e0 = await P.getBalance(addr.trader);
    let rc = await (await Mt.close(p.id, 0, { gasLimit: 3_000_000n })).wait();
    const back = (await P.getBalance(addr.trader)) - e0 + rc.gasUsed * rc.gasPrice;
    ok(rc.status === 1 && back > 0n, `closed: ${f(back)} ETH back on ${f(mEth)} ETH margin (${((Number(back) / Number(mEth) - 1) * 100).toFixed(1)}%)`);
    ok((await new ethers.Contract(dep.locker, art('ZappyLocker'), P).lent(coin)) === 0n, 'loan repaid to the pool');
    if (sym === 'META') continue;
    // liquidation, paid in the stock
    p = await openPos();
    const mk = await T.balanceOf(addr.market); let n = 0; while (!(await M.health(p.id))[2] && n++ < 150) await sell(mk / 200n);
    ok((await M.health(p.id))[2], `after ${n} market sells the position is past maintenance`);
    await (await Mk.flag(p.id)).wait(); await later(16);
    const k0 = await STK.balanceOf(addr.keeper), t0 = await STK.balanceOf(addr.trader);
    rc = await (await Mk.liquidate(p.id, { gasLimit: 3_000_000n })).wait();
    const ev = rc.logs.map((l) => { try { return M.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'PositionLiquidated').args;
    ok((await STK.balanceOf(addr.keeper)) - k0 === ev.reward && ev.reward > 0n, `keeper paid ${f(ev.reward)} ${sym}`);
    ok((await STK.balanceOf(addr.trader)) - t0 === ev.toOwner && ev.shortfall === 0n, `pool repaid (debt ${f(ev.debt)} ${sym}, penalty ${f(ev.penalty)}), trader gets ${f(ev.toOwner)} ${sym}`);
  }
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message, e.revert || ''); process.exit(1); });
