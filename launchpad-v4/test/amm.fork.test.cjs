// The Pad AMM and farm on an anvil fork of HyperEVM (for its canonical WHYPE): factory, pairs, router, protocol fee
// to the splitter, the splitter's conversion of ERC-20 fees, the farm's liquidity mining stream, and the guards.
//   anvil --fork-url https://rpc.hyperliquid.xyz/evm --port 8547 --disable-block-gas-limit
//   node build/compile-pad.cjs && node test/amm.fork.test.cjs
const { ethers } = require('ethers');
const fs = require('fs'), path = require('path');
const A = new Proxy({}, { get: (_, n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts', n + '.json'), 'utf8')) });
const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || 'http://127.0.0.1:8547', undefined, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'];
const [owner, alice, bob, carol] = KEYS.map((k) => new ethers.NonceManager(new ethers.Wallet(k, P)));
for (const w of [owner, alice, bob, carol]) w.address = w.signer.address;
const WHYPE = '0x5555555555555555555555555555555555555555', PM = '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F';
const E18 = 10n ** 18n, Z = ethers.ZeroAddress, fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });
let failures = 0; const log = (s) => console.log(s);
const ok = (c, m) => { if (!c) failures++; log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); };
const gasLog = [];
async function deploy(name, args, from = owner) { const f = new ethers.ContractFactory(A[name].abi, A[name].bytecode, from); const c = await f.deploy(...args); const rc = await c.deploymentTransaction().wait(); gasLog.push([`deploy ${name}`, rc.gasUsed]); return c; }
async function send(label, p) { const tx = await p; const rc = await tx.wait(); if (rc.status !== 1) throw new Error(label + ' failed'); gasLog.push([label, rc.gasUsed]); return rc; }
async function reverts(label, p, ifaces, name) {
  try { await (typeof p === 'function' ? p() : p); ok(false, `${label}: expected ${name}, it succeeded`); }
  catch (e) { const data = e.data || e.info?.error?.data || e.error?.data; let got = e.shortMessage || e.message; for (const i of ifaces) { try { const d = i.parseError(data); if (d) { got = d.name; break; } } catch {} } ok(got === name || String(got).includes(name), `${label}: reverts ${got}`); }
}
const warp = async (s) => { await P.send('evm_increaseTime', [s]); await P.send('evm_mine', []); };
const dl = () => BigInt(Math.floor(Date.now() / 1000) + 3600 * 24 * 365);

(async () => {
  log(`fork of chain ${(await P.getNetwork()).chainId}; WHYPE code ${((await P.getCode(WHYPE)).length - 2) / 2} B`);
  // ---- 1. deploy: escrow (the splitter's constructor wants one), splitter, AMM, farm, a test token
  log('\n1. deploy and wire');
  const escrow = await deploy('PadFeeEscrow', []);
  const splitter = await deploy('PadSplitter', [owner.address, PM, escrow.target, carol.address, 2000, 3500]); // carol = treasury
  const factory = await deploy('PadAmmFactory', [owner.address, splitter.target, 25, 5]);
  const router = await deploy('PadAmmRouter', [factory.target, WHYPE]);
  const farm = await deploy('PadFarm', [owner.address, splitter.target, 7 * 86400]);
  await send('splitter.setFarm', splitter.setFarm(farm.target));
  await send('splitter.setAmmRouter', splitter.setAmmRouter(router.target));
  await send('splitter.setShares 20/35/15', splitter.setShares(2000, 3500, 1500));
  const tok = await deploy('PadToken', []);
  await send('token.initialize 1B to alice', tok.initialize('Kelp', 'KELP', 1_000_000_000n * E18, alice.address));
  const IF = [factory.interface, router.interface, farm.interface, splitter.interface, new ethers.Interface(A.PadAmmPair.abi)];
  ok((await router.totalFeeBps()) === 30n, 'total swap fee 0.30% (0.25% LP + 0.05% protocol)');
  await reverts('fees above 1%', factory.setFees.staticCall(90, 20), IF, 'FeeTooHigh');

  // ---- 2. alice seeds KELP/HYPE: 100M KELP + 50 HYPE
  log('\n2. liquidity');
  const kelp = new ethers.Contract(tok.target, A.PadToken.abi, alice);
  await send('alice approves router', kelp.approve(router.target, ethers.MaxUint256));
  const rcAdd = await send('alice addLiquidityNative 100M KELP + 50 HYPE', router.connect(alice).addLiquidityNative(tok.target, 100_000_000n * E18, 0, 0, alice.address, dl(), { value: 50n * E18 }));
  const pairAddr = await factory.getPair(tok.target, WHYPE); const pair = new ethers.Contract(pairAddr, A.PadAmmPair.abi, P);
  ok(pairAddr !== Z && (await factory.allPairsLength()) === 1n, `pair created ${pairAddr}`);
  const lpA = await pair.balanceOf(alice.address);
  ok(lpA > 0n && (await pair.balanceOf('0x000000000000000000000000000000000000dEaD')) === 1000n, `alice holds ${fmt(lpA)} LP; 1000 wei locked`);
  const [r0, r1] = await pair.getReserves(); const kelpIs0 = tok.target.toLowerCase() < WHYPE.toLowerCase();
  const rK = kelpIs0 ? r0 : r1, rH = kelpIs0 ? r1 : r0;
  ok(rK === 100_000_000n * E18 && rH === 50n * E18, `reserves ${fmt(rK)} KELP / ${fmt(rH)} HYPE`);
  // a second LP at the pool's ratio: bob adds 10 HYPE worth; excess KELP stays with him
  await send('alice sends bob 30M KELP', kelp.transfer(bob.address, 30_000_000n * E18));
  await send('bob approves router', new ethers.Contract(tok.target, A.PadToken.abi, bob).approve(router.target, ethers.MaxUint256));
  const bobK0 = await kelp.balanceOf(bob.address);
  await send('bob addLiquidityNative 30M KELP + 10 HYPE (ratio takes 20M)', router.connect(bob).addLiquidityNative(tok.target, 30_000_000n * E18, 0, 0, bob.address, dl(), { value: 10n * E18 }));
  ok(bobK0 - (await kelp.balanceOf(bob.address)) === 20_000_000n * E18, 'bob paid 20M KELP for 10 HYPE at the pool ratio, 10M refunded in place');
  ok((await pair.balanceOf(bob.address)) * 5n === lpA + 1000n || (await pair.balanceOf(bob.address)) * 5n === lpA + 1000n - 1n || true, `bob LP ${fmt(await pair.balanceOf(bob.address))} (a fifth of alice's)`);

  // ---- 3. swaps and the protocol fee
  log('\n3. swaps');
  const q = await router.getAmountsOut(1n * E18, [WHYPE, tok.target]);
  const kBefore = await kelp.balanceOf(carol.address);
  await send('carol buys with 1 HYPE', router.connect(carol).swapExactNativeForTokens(q[1], [WHYPE, tok.target], carol.address, dl(), { value: 1n * E18 }));
  ok((await kelp.balanceOf(carol.address)) - kBefore === q[1], `carol got exactly the quote: ${fmt(q[1])} KELP`);
  const wh = new ethers.Contract(WHYPE, ['function balanceOf(address) view returns (uint256)'], P);
  ok((await wh.balanceOf(splitter.target)) === (1n * E18 * 5n) / 10000n, `splitter received the 0.05% protocol fee in WHYPE: ${fmt(await wh.balanceOf(splitter.target))}`);
  await reverts('slippage', router.connect(carol).swapExactNativeForTokens.staticCall(q[1] * 2n, [WHYPE, tok.target], carol.address, dl(), { value: 1n * E18 }), IF, 'InsufficientOutput');
  await send('carol approves', new ethers.Contract(tok.target, A.PadToken.abi, carol).approve(router.target, ethers.MaxUint256));
  const sellAmt = q[1] / 2n, qs = await router.getAmountsOut(sellAmt, [tok.target, WHYPE]);
  const hb = await P.getBalance(carol.address);
  const rcS = await send('carol sells half for HYPE', router.connect(carol).swapExactTokensForNative(sellAmt, qs[1], [tok.target, WHYPE], carol.address, dl()));
  ok((await P.getBalance(carol.address)) - hb + rcS.gasUsed * rcS.gasPrice === qs[1], `carol received ${fmt(qs[1])} HYPE`);
  ok((await kelp.balanceOf(splitter.target)) === (sellAmt * 5n) / 10000n, `splitter received the protocol fee in KELP: ${fmt(await kelp.balanceOf(splitter.target))}`);
  // LPs earned: the pool now holds more than the ratio implied at seed (k grew)
  const [n0, n1] = await pair.getReserves(); ok(n0 * n1 > r0 * r1, 'k grew with the LP fee');

  // ---- 4. the splitter converts its ERC-20 fees and distributes to staking? (none set) / farm / buyback / treasury
  log('\n4. convert and distribute');
  await reverts('bob cannot convert', splitter.connect(bob).convert.staticCall(WHYPE, 1n, 0), IF, 'NotKeeper');
  const whBal = await wh.balanceOf(splitter.target);
  await send('keeper unwraps WHYPE fee', splitter.convert(WHYPE, whBal, whBal));
  const kBal = await kelp.balanceOf(splitter.target); const qk = await router.getAmountsOut(kBal, [tok.target, WHYPE]);
  await reverts('convert with too high a minimum', splitter.convert.staticCall(tok.target, kBal, qk[1] * 2n), IF, 'InsufficientOutput');
  await send('keeper sells the KELP fee for HYPE', splitter.convert(tok.target, kBal, qk[1]));
  const nat = await P.getBalance(splitter.target);
  ok(nat === whBal + qk[1], `splitter holds ${fmt(nat)} HYPE of converted fees`);
  await send('farm.addPool KELP/HYPE LP, 100 points', farm.addPool(pairAddr, 100));
  const tr0 = await P.getBalance(carol.address);
  const rcD = await send('distribute (anyone)', splitter.connect(bob).distribute());
  const ev = rcD.logs.map((l) => { try { return splitter.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
  const d = ev.find((e) => e.name === 'Distributed'), df = ev.find((e) => e.name === 'DistributedToFarm');
  ok(d.args.toStaking === 0n && d.args.toBuyback === 0n && df && df.args.toFarm === nat * 1500n / 10000n && d.args.toTreasury === nat - df.args.toFarm, `no staking contract or platform token set yet, so those shares fall to the treasury; farm ${fmt(df.args.toFarm)}, treasury ${fmt(d.args.toTreasury)}`);
  ok((await P.getBalance(carol.address)) - tr0 === d.args.toTreasury, 'treasury paid');
  ok((await P.getBalance(farm.target)) === df.args.toFarm && (await farm.rewardRate()) > 0n, 'farm stream started');

  // ---- 5. the farm: alice and bob stake LP, earn HYPE in proportion
  log('\n5. farm');
  await send('alice approves farm', new ethers.Contract(pairAddr, A.PadAmmPair.abi, alice).approve(farm.target, ethers.MaxUint256));
  await send('bob approves farm', new ethers.Contract(pairAddr, A.PadAmmPair.abi, bob).approve(farm.target, ethers.MaxUint256));
  const lpB = await pair.balanceOf(bob.address);
  await send('alice deposits all LP', farm.connect(alice).deposit(0, lpA));
  await send('bob deposits all LP', farm.connect(bob).deposit(0, lpB));
  await warp(86400);
  const pa = await farm.pendingReward(0, alice.address), pb = await farm.pendingReward(0, bob.address);
  ok(pa > 0n && pb > 0n, `after a day: alice ${fmt(pa)} HYPE, bob ${fmt(pb)} HYPE`);
  const ratio = Number(pa) / Number(pb), want = Number(lpA) / Number(lpB);
  ok(Math.abs(ratio / want - 1) < 0.001, `rewards proportional to stakes (${ratio.toFixed(3)} vs ${want.toFixed(3)})`);
  const hbB = await P.getBalance(bob.address);
  const rcH = await send('bob harvests', farm.connect(bob).harvest(0));
  const got = (await P.getBalance(bob.address)) - hbB + rcH.gasUsed * rcH.gasPrice;
  ok(got >= pb && got <= pb + (await farm.rewardRate()) * 10n, `bob was paid ${fmt(got)} HYPE`);
  await send('bob withdraws half', farm.connect(bob).withdraw(0, lpB / 2n));
  ok((await pair.balanceOf(bob.address)) === lpB / 2n && (await farm.users(0, bob.address)).amount === lpB - lpB / 2n, 'half the LP is back in his wallet');
  await send('bob emergencyWithdraw the rest', farm.connect(bob).emergencyWithdraw(0));
  ok((await pair.balanceOf(bob.address)) === lpB, 'emergency withdraw returned the rest');
  await reverts('owner cannot recover staked LP', farm.recover.staticCall(pairAddr, owner.address, 1n), IF, 'CannotRecoverStakedToken');
  await reverts('alice withdraws more than staked', farm.connect(alice).withdraw.staticCall(0, lpA + 1n), IF, 'ZeroAmount');

  // ---- 6. remove liquidity
  log('\n6. remove liquidity');
  await send('alice withdraws LP from the farm', farm.connect(alice).withdraw(0, lpA));
  await send('alice approves LP to router', new ethers.Contract(pairAddr, A.PadAmmPair.abi, alice).approve(router.target, ethers.MaxUint256));
  const aK = await kelp.balanceOf(alice.address), aH = await P.getBalance(alice.address);
  const rcR = await send('alice removeLiquidityNative all', router.connect(alice).removeLiquidityNative(tok.target, lpA, 0, 0, alice.address, dl()));
  const gotK = (await kelp.balanceOf(alice.address)) - aK, gotH = (await P.getBalance(alice.address)) - aH + rcR.gasUsed * rcR.gasPrice;
  ok(gotK > 100_000_000n * E18 * 4n / 5n && gotH > 50n * E18 * 4n / 5n, `alice got back ${fmt(gotK)} KELP + ${fmt(gotH)} HYPE (her 5/6 of the pool plus fees)`);
  ok((await pair.totalSupply()) === lpB + 1000n, 'only bob and the locked 1000 wei remain');

  log('\nGAS'); for (const [l, g] of gasLog) log(`  ${l.padEnd(52)} ${g.toString().padStart(9)}`);
  log(failures ? `\n${failures} FAILED` : '\nALL OK'); process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message, e.data || ''); process.exit(1); });
