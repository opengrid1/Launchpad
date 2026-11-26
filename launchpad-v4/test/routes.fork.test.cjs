// site/routes.js against the live BuzzPad v2 contracts on a fresh Ethereum mainnet fork (node at FORK_RPC): launches an
// ETH-pair and an AZTEC-pair coin on the v2 factory, then for those and for PBEE (XMR pair, launched on mainnet) buys
// from ETH and sells back to ETH through the UniversalRouter with the calldata routes.js builds.
//   node test/routes.fork.test.cjs
const { ethers } = require('ethers');
const ROUTES = require('../site/routes.js');
const dep = require('../deployments/buzzpad-v2-ethereum.json');
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8548';
const P = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1 });
const UR = '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PAIRS = {
  ETH: { addr: ethers.ZeroAddress, cfg: 0 },
  AZTEC: { addr: '0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2', cfg: 1, info: { route: 'v4', key: [ethers.ZeroAddress, '0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2', 500, 10, '0xd53006d1e3110fD319a79AEEc4c527a0d265E080'] } },
  XMR: { addr: '0x465e07d6028830124BE2E4aA551fBe12805dB0f5', cfg: 2, info: { route: 'v2', weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' } },
};
const ERC = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
const F_ABI = require('../artifacts/BuzzPadFactory.json').abi;
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
const fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });

(async () => {
  const w = new ethers.NonceManager(new ethers.Wallet('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', P)), me = await w.getAddress();
  await P.send('hardhat_setBalance', [me, '0x' + (100n * 10n ** 18n).toString(16)]);
  const F = new ethers.Contract(dep.factory, F_ABI, w);
  const hook = new ethers.Contract(dep.hook, ['function pendingCreator(bytes32) view returns (uint256)', 'function pendingProtocol(bytes32) view returns (uint256)'], P);
  const coins = { XMR: '0x4e290806d8e085c29490e5BD168C3330Ff5c438B' };
  for (const n of ['ETH', 'AZTEC']) {
    const params = { name: 'Route ' + n, symbol: 'R' + n.slice(0, 3), logo: 'https://x.test/l.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: ethers.ZeroAddress, creatorTaxBps: 0, expectedEconomics: ethers.ZeroHash, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
    const r = await (await F.launch(params, PAIRS[n].cfg, { value: await F.launchFee(), gasLimit: 2_500_000n })).wait();
    coins[n] = r.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched').args.token;
  }
  await P.send('evm_increaseTime', [20]); await P.send('evm_mine', []);
  const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 3600 * 24);
  for (const [n, coin] of Object.entries(coins)) {
    console.log(`-- ${n} pair, coin ${coin}`);
    const pr = PAIRS[n], T = new ethers.Contract(coin, ERC, w);
    const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['(address,address,uint24,int24,address)'], [[pr.addr, coin, 0, 200, dep.hook]]));
    const fee0 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    const ethIn = ethers.parseEther('0.02'), b0 = await T.balanceOf(me);
    let r = await (await w.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: pr.addr, hook: dep.hook, pairInfo: pr.info, buy: true, amountIn: ethIn, minOut: 1n, deadline: deadline() }), value: ethIn, gasLimit: 900_000n })).wait();
    const got = (await T.balanceOf(me)) - b0;
    ok(r.status === 1 && got > 0n, `buy 0.02 ETH -> ${fmt(got)} coins, gas ${r.gasUsed}`);
    ok((await P.getBalance(UR)) === 0n, 'no ETH left in the router');
    await (await T.approve(PERMIT2, ethers.MaxUint256)).wait();
    await (await w.sendTransaction({ to: PERMIT2, data: new ethers.Interface(['function approve(address,address,uint160,uint48)']).encodeFunctionData('approve', [coin, UR, (1n << 160n) - 1n, Number(deadline())]) })).wait();
    const e0 = await P.getBalance(me), sell = got / 2n;
    r = await (await w.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: pr.addr, hook: dep.hook, pairInfo: pr.info, buy: false, amountIn: sell, minOut: 1n, deadline: deadline() }), gasLimit: 900_000n })).wait();
    const back = (await P.getBalance(me)) - e0 + r.gasUsed * r.gasPrice;
    ok(r.status === 1 && back > 0n, `sell half -> ${fmt(back)} ETH back to the wallet, gas ${r.gasUsed}`);
    const fee1 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    ok(fee1 > fee0, `fees booked in ${n}: +${fmt(fee1 - fee0)}`);
    if (pr.addr !== ethers.ZeroAddress) ok((await new ethers.Contract(pr.addr, ERC, P).balanceOf(UR)) === 0n, `no ${n} left in the router`);
  }
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message); process.exit(1); });
