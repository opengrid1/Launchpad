// Stock pairs on Zappy (Robinhood Chain fork at 127.0.0.1:8550, stack from deploy-v2.cjs with LEVERAGE=1 and
// STOCKS=brands/zappy/stocks.json): launches a coin on a stock reached through USDG on v3 (NVDA), one through a direct
// WETH v3 pool (TTWO) and one through USDG on v4 (META), then buys each from ETH and sells half back to ETH through
// Robinhood Chain's UniversalRouter with the calldata site/routes.js builds. Checks the fees are booked in the stock
// and nothing is left in the router. Also: leverage refuses a stock-pair coin.
//   node test/zappy-stocks.fork.test.cjs
const { ethers } = require('ethers');
const ROUTES = require('../site/routes.js');
const dep = require('../deployments/zappytest-v2-robinhood-fork.json');
const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || 'http://127.0.0.1:8550', undefined, { staticNetwork: true, cacheTimeout: -1 });
const UR = '0x8876789976decbfcbbbe364623c63652db8c0904', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const W = new ethers.NonceManager(new ethers.Wallet('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', P));
const OWNER = new ethers.NonceManager(new ethers.Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', P));
const ERC = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
const fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });

(async () => {
  const me = await W.getAddress();
  await P.send('hardhat_setBalance', [me, '0x' + (100n * 10n ** 18n).toString(16)]);
  await P.send('hardhat_setBalance', [await OWNER.getAddress(), '0x' + (100n * 10n ** 18n).toString(16)]);
  const F = new ethers.Contract(dep.factory, require('../artifacts/BuzzPadFactory.json').abi, W);
  if (!(await F.launchEnabled())) {
    for (const [n, a] of [['BuzzPadHook', dep.hook], ['BuzzPadFactory', dep.factory], ['ZappyLocker', dep.locker], ['ZappyMargin', dep.leverage.margin]]) {
      const c = new ethers.Contract(a, require('../artifacts/' + n + '.json').abi, OWNER); if ((await c.pendingOwner()) === (await OWNER.getAddress())) await (await c.acceptOwnership()).wait();
    }
    await (await F.connect(OWNER).setLaunchEnabled(true)).wait();
  }
  const hook = new ethers.Contract(dep.hook, ['function pendingCreator(bytes32) view returns (uint256)', 'function pendingProtocol(bytes32) view returns (uint256)'], P);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 400);
  const coins = {};
  for (const sym of ['NVDA', 'TTWO', 'META']) {
    const sp = dep.stockPairs.find((s) => s.sym === sym);
    const params = { name: 'On ' + sym, symbol: 'O' + sym, logo: 'https://x.test/l.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: ethers.ZeroAddress, creatorTaxBps: 0, expectedEconomics: ethers.ZeroHash, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
    const r = await (await F.launch(params, sp.cfg, { value: await F.launchFee(), gasLimit: 3_000_000n })).wait();
    coins[sym] = { sp, coin: r.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched').args.token };
  }
  await P.send('evm_increaseTime', [20]); await P.send('evm_mine', []);
  for (const [sym, { sp, coin }] of Object.entries(coins)) {
    console.log(`-- ${sym} pair (${sp.info.route}${sp.info.path ? ' ' + (sp.info.path.length === 3 ? 'WETH direct' : 'via USDG') : ' via USDG'}), coin ${coin}`);
    const T = new ethers.Contract(coin, ERC, W), S = new ethers.Contract(sp.addr, ERC, P);
    const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['(address,address,uint24,int24,address)'], [[sp.addr, coin, 0, 200, dep.hook]]));
    const fee0 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    const ethIn = ethers.parseEther('0.05'), b0 = await T.balanceOf(me);
    let r = await (await W.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: sp.addr, hook: dep.hook, pairInfo: sp.info, buy: true, amountIn: ethIn, minOut: 1n, deadline: deadline(), hopLayout: true }), value: ethIn, gasLimit: 1_500_000n })).wait();
    const got = (await T.balanceOf(me)) - b0;
    ok(r.status === 1 && got > 0n, `buy 0.05 ETH -> ${fmt(got)} coins, gas ${r.gasUsed}`);
    await (await T.approve(PERMIT2, ethers.MaxUint256)).wait();
    await (await W.sendTransaction({ to: PERMIT2, data: new ethers.Interface(['function approve(address,address,uint160,uint48)']).encodeFunctionData('approve', [coin, UR, (1n << 160n) - 1n, Number(deadline())]) })).wait();
    const e0 = await P.getBalance(me);
    r = await (await W.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: sp.addr, hook: dep.hook, pairInfo: sp.info, buy: false, amountIn: got / 2n, minOut: 1n, deadline: deadline(), hopLayout: true }), gasLimit: 1_500_000n })).wait();
    const back = (await P.getBalance(me)) - e0 + r.gasUsed * r.gasPrice;
    ok(r.status === 1 && back > 0n, `sell half -> ${fmt(back)} ETH back (${(Number(back) / Number(ethIn) * 100).toFixed(1)}% of the buy), gas ${r.gasUsed}`);
    const fee1 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    ok(fee1 > fee0, `fees booked in ${sym}: +${fmt(fee1 - fee0)} ${sym}`);
    ok((await S.balanceOf(UR)) === 0n && (await P.getBalance(UR)) === 0n, `no ${sym} or ETH left in the router`);
  }
  const M = new ethers.Contract(dep.leverage.margin, require('../artifacts/ZappyMargin.json').abi, W);
  await P.send('evm_increaseTime', [700]); await P.send('evm_mine', []);
  let refused = false; try { await M.open.staticCall(coins.NVDA.coin, 20000, 0, { value: ethers.parseEther('0.01') }); } catch (e) { refused = true; }
  ok(refused, 'leverage refuses a stock-pair coin (ETH pairs only for now)');
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message); process.exit(1); });
