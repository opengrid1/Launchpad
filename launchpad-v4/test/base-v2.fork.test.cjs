// The v2 stack deployed by deploy-v2.cjs on a Base fork (node at FORK_RPC, default 127.0.0.1:8549): turn launches on,
// launch a coin, buy from ETH and sell back to ETH through Base's UniversalRouter with site/routes.js, pay out.
//   DEP=deployments/zappy-v2-base-fork.json node test/base-v2.fork.test.cjs
const path = require('path'), { ethers } = require('ethers'), ROUTES = require('../site/routes.js');
const dep = require(path.resolve(process.env.DEP || 'deployments/zappy-v2-base-fork.json'));
const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || 'http://127.0.0.1:8549', undefined, { staticNetwork: true, cacheTimeout: -1 });
const UR = '0x6fF5693b99212Da76ad316178A184AB56D299b43', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
(async () => {
  const owner = new ethers.NonceManager(new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', P));
  const w = new ethers.NonceManager(new ethers.Wallet('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', P)), me = await w.getAddress();
  await P.send('hardhat_setBalance', [me, '0x' + (10n ** 19n).toString(16)]);
  const F = new ethers.Contract(dep.factory, require('../artifacts/BuzzPadFactory.json').abi, owner);
  await (await F.setLaunchEnabled(true)).wait();
  const Fw = F.connect(w), params = { name: 'Zap Test', symbol: 'ZAPT', logo: 'https://x.test/l.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: ethers.ZeroAddress, creatorTaxBps: 0, expectedEconomics: ethers.ZeroHash, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: ethers.parseEther('0.01'), minTokensOut: 1n };
  const r0 = await (await Fw.launch(params, 0, { value: (await F.launchFee()) + params.openingBuy, gasLimit: 3_000_000n })).wait();
  const coin = r0.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched').args.token;
  ok(!!coin, `launched ${coin} with a 0.01 ETH opening buy, gas ${r0.gasUsed}`);
  await P.send('evm_increaseTime', [20]); await P.send('evm_mine', []);
  const T = new ethers.Contract(coin, ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], w);
  const dl = BigInt(Math.floor(Date.now() / 1000) + 86400), b0 = await T.balanceOf(me);
  let r = await (await w.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: ethers.ZeroAddress, hook: dep.hook, buy: true, amountIn: ethers.parseEther('0.05'), minOut: 1n, deadline: dl }), value: ethers.parseEther('0.05'), gasLimit: 900_000n })).wait();
  const got = (await T.balanceOf(me)) - b0; ok(r.status === 1 && got > 0n, `buy 0.05 ETH -> ${ethers.formatEther(got)} coins, gas ${r.gasUsed}`);
  await (await T.approve(PERMIT2, ethers.MaxUint256)).wait();
  await (await w.sendTransaction({ to: PERMIT2, data: new ethers.Interface(['function approve(address,address,uint160,uint48)']).encodeFunctionData('approve', [coin, UR, (1n << 160n) - 1n, Number(dl)]) })).wait();
  const e0 = await P.getBalance(me);
  r = await (await w.sendTransaction({ to: UR, data: ROUTES.encode({ coin, pair: ethers.ZeroAddress, hook: dep.hook, buy: false, amountIn: got / 2n, minOut: 1n, deadline: dl }), gasLimit: 900_000n })).wait();
  ok(r.status === 1 && (await P.getBalance(me)) + r.gasUsed * r.gasPrice > e0, `sell half back to ETH, gas ${r.gasUsed}`);
  const H = new ethers.Contract(dep.hook, ['function pendingCreator(bytes32) view returns (uint256)', 'function pendingProtocol(bytes32) view returns (uint256)', 'function payout(bytes32)'], w);
  const pid = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['(address,address,uint24,int24,address)'], [[ethers.ZeroAddress, coin, 0, 200, dep.hook]]));
  const pc = await H.pendingCreator(pid), pp = await H.pendingProtocol(pid), c0 = await P.getBalance(me), a0 = await P.getBalance(dep.owner);
  r = await (await H.payout(pid)).wait();
  ok((await P.getBalance(me)) + r.gasUsed * r.gasPrice - c0 === pc && (await P.getBalance(dep.owner)) - a0 === pp, `payout: creator ${ethers.formatEther(pc)} ETH, protocol ${ethers.formatEther(pp)} ETH`);
  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message); process.exit(1); });
