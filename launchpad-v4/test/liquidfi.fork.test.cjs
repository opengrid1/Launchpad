// LiquidFi on a Hardhat fork of HyperEVM: deploys the stack against Uniswap's official v4 PoolManager and
// PositionManager there (Pons' fee escrow and buyback vault, byte-identical, plus the LiquidFi token, hook,
// locker and factory) and runs the lifecycle: launch with an opening buy (gas under HyperEVM's 3M small-block
// limit), the three locked positions, the snipe tax decay, the volatility surcharge, sells, a buyback launch,
// fee sweeps and claims, the owner-only collect, the creator fee recipient transfer and the timelocked override,
// and the launch guards. Prints gas per step.
//   (cd <hardhat dir> && npx hardhat node --port 8547)   # forking https://rpc.hyperliquid.xyz/evm, chainId 999
//   node build/compile.cjs && node build/compile-liquidfi.cjs && node build/router-compile.cjs
//   node test/liquidfi.fork.test.cjs
const { ethers } = require('ethers');
const fs = require('fs'), path = require('path');
const A = new Proxy({}, { get: (_, n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts', n + '.json'), 'utf8')) });
const POSM_J = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/position-manager.sourcify.json'), 'utf8')), POSM_ABI = POSM_J.abi;
const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || 'http://127.0.0.1:8547', undefined, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'];
const [owner, creator, bob, sniper, alice] = KEYS.map((k) => new ethers.NonceManager(new ethers.Wallet(k, P)));
for (const w of [owner, creator, bob, sniper, alice]) w.address = w.signer.address;
// FORK_NET=elysium: Uniswap's PoolManager on Elysium and no PositionManager there, so the test deploys the official build.
const NETS = { hyperevm: { pm: '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F', posm: '0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9', weth9: '0x5555555555555555555555555555555555555555' }, elysium: { pm: '0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1', posm: null, weth9: '0xba876237b0f021a6c6d852d6c26e107997cc5e81' } };
const NETC = NETS[process.env.FORK_NET || 'hyperevm']; const PM = NETC.pm; let POSM = NETC.posm;
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3', C2 = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const E18 = 10n ** 18n, Z = ethers.ZeroAddress, fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const LAUNCH_FEE = ethers.parseEther('0.005');
const gasLog = []; let failures = 0;
const log = (s) => console.log(s);
const ok = (cond, msg) => { if (!cond) failures++; log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); };
async function deploy(name, args) { const f = new ethers.ContractFactory(A[name].abi, A[name].bytecode, owner); const c = await f.deploy(...args); const rc = await c.deploymentTransaction().wait(); gasLog.push([`deploy ${name}`, rc.gasUsed]); return c; }
async function send(label, p) { const tx = await p; const rc = await tx.wait(); if (rc.status !== 1) throw new Error(label + ' failed'); gasLog.push([label, rc.gasUsed]); return rc; }
async function reverts(label, p, ifaces, name) {
  try { await (typeof p === 'function' ? p() : p); ok(false, `${label}: expected ${name}, it succeeded`); }
  catch (e) {
    const data = e.data || e.info?.error?.data || e.error?.data;
    let got = e.shortMessage || e.message;
    for (const i of ifaces) { try { const d = i.parseError(data); if (d) { got = d.name; break; } } catch {} }
    ok(got === name || (name && String(got).includes(name)), `${label}: reverts ${got}`);
  }
}
const at = async (t) => { await P.send('evm_setNextBlockTimestamp', [t]); };
const mine = async (t) => { await at(t); await P.send('evm_mine', []); };
const events = (rc, ifaces) => rc.logs.map((l) => { for (const i of ifaces) { try { const e = i.parseLog(l); if (e) return e; } catch {} } return null; }).filter(Boolean);
const pid = (k) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));
const mcapOf = (sqrt, supply) => { const p = (Number(sqrt) / 2 ** 96) ** 2; return Number(ethers.formatEther(supply)) / p; }; // tokens per HYPE -> HYPE market cap

(async () => {
  const blk = await P.getBlock('latest');
  log(`fork of chain ${(await P.getNetwork()).chainId} (${process.env.FORK_NET || 'hyperevm'}) at block ${blk.number}; PoolManager ${PM} code ${((await P.getCode(PM)).length - 2) / 2} B`);
  if (!POSM) { const init = POSM_J.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256', 'address', 'address'], [PM, PERMIT2, 300000, Z, NETC.weth9]).slice(2); const tx = await owner.sendTransaction({ data: init }); const rc = await tx.wait(); POSM = rc.contractAddress; gasLog.push(['deploy PositionManager (official build)', rc.gasUsed]); log(`  deployed the official PositionManager build at ${POSM}`); }
  const posm = new ethers.Contract(POSM, POSM_ABI, owner);

  // ---- 1. deploy and wire
  log('\n1. deploy and wire');
  const escrow = await deploy('PonsV2FeeEscrow', []);
  const FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n), MASK = (1n << 14n) - 1n; // beforeInitialize | afterSwap | afterSwapReturnDelta
  const hookInit = A.LiquidFiHook.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'address', 'address'], [PM, escrow.target, owner.address, owner.address]).slice(2);
  const initHash = ethers.keccak256(hookInit); let salt, hookAddr;
  for (let i = 0; ; i++) { salt = ethers.zeroPadValue(ethers.toBeHex(i), 32); hookAddr = ethers.getCreate2Address(C2, salt, initHash); if ((BigInt(hookAddr) & MASK) === FLAGS) break; }
  await send('deploy LiquidFiHook (CREATE2)', owner.sendTransaction({ to: C2, data: salt + hookInit.slice(2), gasLimit: 8_000_000n }));
  const hook = new ethers.Contract(hookAddr, A.LiquidFiHook.abi, owner);
  const vault = await deploy('PonsV2BuybackVault', [owner.address, hookAddr, escrow.target]);
  const locker = await deploy('LiquidFiLocker', [owner.address, POSM]);
  const impl = await deploy('LiquidFiToken', []);
  const factory = await deploy('LiquidFiFactory', [owner.address, PM, POSM, PERMIT2, locker.target, hookAddr, escrow.target, vault.target, impl.target, LAUNCH_FEE]);
  await send('hook.setFactory', hook.setFactory(factory.target));
  await send('hook.setBuybackVault', hook.setBuybackVault(vault.target));
  await send('vault.setFactory', vault.setFactory(factory.target));
  await send('locker.setFactory', locker.setFactory(factory.target));
  const CFG = { supply: 1_000_000_000n * E18, startMcap: 50n * E18, band1Mcap: 200n * E18, band2Mcap: 1000n * E18, band0Bps: 2000, band1Bps: 3000, tickSpacing: 200, enabled: true };
  await send('factory.addLaunchConfig (50 / 200 / 1,000 HYPE)', factory.addLaunchConfig(CFG));
  const [, ticks] = await factory.getLaunchConfig(0);
  log(`  hook ${hookAddr}, factory ${factory.target}; config ticks start ${ticks.start}, band1 ${ticks.band1}, band2 ${ticks.band2}, floor ${ticks.floor}`);
  const IF = [factory.interface, hook.interface, locker.interface];
  await reverts('launch while disabled and not whitelisted', factory.connect(creator).launch.staticCall({ name: 'X', symbol: 'X', logo: '', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: Z, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: ethers.ZeroHash, salt: ethers.ZeroHash, openingBuy: 0, minTokensOut: 0 }, 0, { value: LAUNCH_FEE }), IF, 'NotWhitelisted');
  await send('factory.setLaunchEnabled', factory.setLaunchEnabled(true));
  const router = await deploy('TestSwapRouter', [PM]); const rt = router.connect(sniper);

  // ---- 2. launch with a 2 HYPE opening buy
  log('\n2. launch, 2 HYPE opening buy');
  const socials = { twitter: 'https://x.com/liquidfi', telegram: '', discord: '', website: 'https://liquidfi.fun', farcaster: '' };
  const base = { name: 'Liquid Test', symbol: 'LQT', logo: 'ipfs://bafy-logo', description: 'fork test of the LiquidFi launch', socials, creatorFeeRecipient: Z, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: await factory.previewLaunchEconomics(0), salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: ethers.parseEther('2'), minTokensOut: 1n };
  const predicted = await factory.predictTokenAddress(creator.address, base.salt);
  const rcL = await send('launch + 2 HYPE opening buy', factory.connect(creator).launch(base, 0, { value: LAUNCH_FEE + base.openingBuy, gasLimit: 3_000_000n }));
  ok(rcL.gasUsed < 3_000_000n, `launch gas ${rcL.gasUsed} fits a 3M small block`);
  const evL = events(rcL, IF);
  const launched = evL.find((e) => e.name === 'TokenLaunched'), opening = evL.find((e) => e.name === 'OpeningBuy');
  const token = launched.args.token, coin = new ethers.Contract(token, A.LiquidFiToken.abi, P);
  ok(token === predicted, `token at the predicted address ${token}`);
  ok((await coin.totalSupply()) === CFG.supply && (await coin.name()) === 'Liquid Test', `token ${await coin.symbol()} supply ${fmt(await coin.totalSupply())}`);
  const key = await factory.poolKeyOf(token); const keyObj = { currency0: key.currency0, currency1: key.currency1, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks };
  const poolId = pid(keyObj); ok(poolId === launched.args.poolId, 'pool id matches the event');
  const ids = await locker.positionsOf(token);
  const owners = await Promise.all(ids.map((i) => posm.ownerOf(i)));
  ok(owners.every((o) => o === locker.target), `positions #${ids.join(', #')} owned by the locker`);
  const liq = await Promise.all(ids.map((i) => posm.getPositionLiquidity(i)));
  ok(liq.every((l) => l > 0n), `liquidity ${liq.map(String).join(' / ')}`);
  ok((await coin.balanceOf(factory.target)) === 0n, `factory keeps no tokens; dust to the locker ${await coin.balanceOf(locker.target)} wei`);
  const creatorTokens = await coin.balanceOf(creator.address);
  ok(creatorTokens === opening.args.tokensOut && creatorTokens * 10000n / CFG.supply <= 500n, `creator got ${fmt(creatorTokens)} (${Number(creatorTokens * 10000n / CFG.supply) / 100}% of supply) for 2 HYPE, no snipe tax`);
  const opSur = evL.find((e) => e.name === 'SurchargeApplied'); ok(!opSur, 'opening buy paid no snipe tax');
  log(`  market cap after the opening buy ${mcapOf((await hook.volState(poolId)).lastSqrtPriceX96, CFG.supply).toFixed(2)} HYPE`);
  ok((await escrow.balanceOf(owner.address)) === LAUNCH_FEE, `launch fee ${fmt(LAUNCH_FEE)} HYPE credited to the protocol`);
  const t0 = Number((await P.getBlock(rcL.blockNumber)).timestamp);

  // ---- 3. snipe tax
  log('\n3. snipe tax (99% halving fourteen times over 10 s)');
  await at(t0 + 1);
  const rcS = await send('sniper buy 1 HYPE at +1 s', rt.swap(keyObj, true, E18, { value: E18 }));
  const sur = events(rcS, IF).find((e) => e.name === 'SurchargeApplied');
  ok(sur && sur.args.snipeBps === 4950n, `sniper paid snipe tax ${sur ? Number(sur.args.snipeBps) / 100 : 0}% (9900 >> 1) on top of the 1% fee; got ${fmt(await coin.balanceOf(sniper.address))} LQT`);
  for (const [dt, want] of [[5, 77n], [9, 2n], [10, 0n]]) {
    await mine(t0 + dt); const f = await hook.feeNow(poolId);
    ok(f.snipeBuyBps === want, `at +${dt} s a buy would pay snipe tax ${f.snipeBuyBps} bps (expected ${want}), base ${f.baseBps} bps`);
  }

  // ---- 4. volatility fee
  log('\n4. volatility surcharge (10% move in 60 s -> +2 points, decaying over 2 min)');
  await at(t0 + 12);
  const rcC = await send('bob buy 0.05 HYPE (quiet)', router.connect(bob).swap(keyObj, true, ethers.parseEther('0.05'), { value: ethers.parseEther('0.05') }));
  ok(!events(rcC, IF).some((e) => e.name === 'SurchargeApplied'), 'a small buy pays the base 1% only');
  await at(t0 + 14);
  const rcV = await send('bob buy 20 HYPE (moves the price)', router.connect(bob).swap(keyObj, true, ethers.parseEther('20'), { value: ethers.parseEther('20') }));
  const evV = events(rcV, IF);
  ok(evV.some((e) => e.name === 'VolatilitySpike'), 'the 20 HYPE buy trips the spike');
  const surV = evV.find((e) => e.name === 'SurchargeApplied');
  ok(surV && surV.args.volatilityBps === 200n, `and pays ${surV ? Number(surV.args.volatilityBps) / 100 : 0} points on top itself`);
  log(`  market cap now ${mcapOf((await hook.volState(poolId)).lastSqrtPriceX96, CFG.supply).toFixed(2)} HYPE`);
  for (const [dt, want] of [[60, 100n], [104, 26n], [134, 0n]]) {
    await mine(t0 + 14 + dt); const f = await hook.feeNow(poolId);
    ok(f.volatilityBps === want, `${dt} s after the spike the surcharge is ${f.volatilityBps} bps (expected ${want})`);
  }

  // ---- 5. sells
  log('\n5. sells');
  const bobBal = await coin.balanceOf(bob.address);
  await send('bob approve router', coin.connect(bob).approve(router.target, bobBal));
  const hb = await P.getBalance(bob.address);
  const rcSell = await send('bob sell half', router.connect(bob).swap(keyObj, false, bobBal / 2n));
  log(`  bob sold ${fmt(bobBal / 2n)} LQT for ${fmt((await P.getBalance(bob.address)) - hb + rcSell.gasUsed * rcSell.fee / rcSell.gasUsed)} HYPE`);
  const spBal = await coin.balanceOf(sniper.address);
  await send('sniper approve router', coin.connect(sniper).approve(router.target, spBal));
  await send('sniper sells all', rt.swap(keyObj, false, spBal));
  log(`  hook pending: ${fmt(await hook.pendingFees(poolId, Z))} HYPE + ${fmt(await hook.pendingFees(poolId, token))} LQT`);

  // ---- 6. sweep and claims
  log('\n6. sweep and claims');
  await reverts('a stranger cannot sweep', hook.connect(bob).sweepPoolFees.staticCall(poolId, 1, 0), IF, 'NotFeeSweepOperator');
  await send('hook.sweepPoolFees (operator)', hook.sweepPoolFees(poolId, 1, 0));
  const cEsc = await escrow.balanceOf(creator.address), pEsc = (await escrow.balanceOf(owner.address)) - LAUNCH_FEE;
  ok(cEsc > 0n && pEsc > 0n, `escrow: creator ${fmt(cEsc)} HYPE, protocol ${fmt(pEsc)} HYPE (creator share ${(Number(cEsc) / Number(cEsc + pEsc) * 100).toFixed(1)}%)`);
  const cb = await P.getBalance(creator.address);
  const rcClaim = await send('creator claim', escrow.connect(creator)['claim()']());
  ok((await P.getBalance(creator.address)) - cb + rcClaim.fee === cEsc, `creator claimed ${fmt(cEsc)} HYPE`);

  // ---- 7. a launch with buyback and a 2% creator fee
  log('\n7. launch with buyback & vest and a 2% creator fee');
  const p2 = { ...base, name: 'Buyback Test', symbol: 'BBT', salt: ethers.hexlify(ethers.randomBytes(32)), creatorTaxBps: 200, buybackEnabled: true, openingBuy: 0n, minTokensOut: 0n };
  const rc2 = await send('launch (no opening buy)', factory.connect(alice).launch(p2, 0, { value: LAUNCH_FEE, gasLimit: 3_000_000n }));
  const tok2 = events(rc2, IF).find((e) => e.name === 'TokenLaunched').args.token;
  const k2 = await factory.poolKeyOf(tok2); const key2 = { currency0: k2.currency0, currency1: k2.currency1, fee: k2.fee, tickSpacing: k2.tickSpacing, hooks: k2.hooks }; const pid2 = pid(key2);
  const t2 = Number((await P.getBlock(rc2.blockNumber)).timestamp);
  await at(t2 + 11);
  await send('bob buy 10 HYPE', router.connect(bob).swap(key2, true, ethers.parseEther('10'), { value: ethers.parseEther('10') }));
  const coin2 = new ethers.Contract(tok2, A.LiquidFiToken.abi, P); const b2 = await coin2.balanceOf(bob.address);
  await send('bob approve', coin2.connect(bob).approve(router.target, b2));
  await at(t2 + 200);
  await send('bob sell half', router.connect(bob).swap(key2, false, b2 / 2n));
  const tax2 = (await hook.pendingCreatorTax(pid2, Z)) + (await hook.pendingCreatorTax(pid2, tok2));
  ok(tax2 > 0n, `creator fee accrued separately: ${fmt(await hook.pendingCreatorTax(pid2, Z))} HYPE + ${fmt(await hook.pendingCreatorTax(pid2, tok2))} BBT`);
  const aEscBefore = await escrow.balanceOf(alice.address);
  await send('sweep with buyback', hook.sweepPoolFees(pid2, 1, 1));
  ok((await vault.totalLocked(tok2)) > 0n, `buyback locked ${fmt(await vault.totalLocked(tok2))} BBT in the 5-year vest; alice's escrow +${fmt((await escrow.balanceOf(alice.address)) - aEscBefore)} HYPE`);

  // ---- 8. collect (owner only)
  log('\n8. collect: owner only, proportional across the three positions');
  await reverts('bob calls collect', locker.connect(bob).collect.staticCall(token, 5000, bob.address), IF, 'OwnableUnauthorizedAccount');
  await reverts('collect 0 bps', locker.collect.staticCall(token, 0, owner.address), IF, 'InvalidParams');
  const before = await Promise.all(ids.map((i) => posm.getPositionLiquidity(i)));
  const rcCol = await send('owner collect 50%', locker.collect(token, 5000, alice.address));
  const col = events(rcCol, IF).find((e) => e.name === 'Collected');
  const after = await Promise.all(ids.map((i) => posm.getPositionLiquidity(i)));
  ok(after.every((l, i) => l === before[i] - before[i] * 5000n / 10000n), `each position lost exactly half: ${after.map(String).join(' / ')}`);
  ok(col.args.pairAmount > 0n && col.args.tokenAmount > 0n, `alice received ${fmt(col.args.pairAmount)} HYPE + ${fmt(col.args.tokenAmount)} LQT`);
  await send('owner collect 100% of the rest', locker.collect(token, 10000, alice.address));
  const after2 = await Promise.all(ids.map((i) => posm.getPositionLiquidity(i)));
  ok(after2.every((l) => l === 0n), 'all three positions now empty');

  // ---- 9. creator fee recipient
  log('\n9. creator fee recipient: self-service transfer and the 3-day override');
  await reverts('a stranger transfers the role', factory.connect(bob).transferCreatorFeeRecipient.staticCall(tok2, bob.address), IF, 'NotCreatorFeeRecipient');
  await send('alice hands the role to creator', factory.connect(alice).transferCreatorFeeRecipient(tok2, creator.address));
  ok((await hook.launches(pid2)).creator === creator.address, 'hook pays the new recipient');
  await send('owner proposes bob', factory.setCreatorFeeRecipient(tok2, bob.address));
  await reverts('execute before 3 days', factory.connect(bob).executeCreatorFeeRecipientChange.staticCall(tok2), IF, 'TimelockNotElapsed');
  const now = Number((await P.getBlock('latest')).timestamp);
  await mine(now + 3 * 86400 + 5);
  await send('anyone executes after 3 days', factory.connect(sniper).executeCreatorFeeRecipientChange(tok2));
  ok((await factory.getLaunchedToken(tok2)).creatorFeeRecipient === bob.address && (await hook.launches(pid2)).creator === bob.address, 'creator fee recipient is now bob on the factory and the hook');

  // ---- 10. launch guards
  log('\n10. launch guards');
  const fresh = () => ({ ...base, salt: ethers.hexlify(ethers.randomBytes(32)), expectedEconomics: ethers.ZeroHash });
  await reverts('link in the description', factory.connect(creator).launch.staticCall({ ...fresh(), description: 'see www.scam.xyz' }, 0, { value: LAUNCH_FEE + base.openingBuy }), IF, 'LinkInDescription');
  await reverts('opening buy above 5% of supply', factory.connect(creator).launch.staticCall({ ...fresh(), openingBuy: ethers.parseEther('5') }, 0, { value: LAUNCH_FEE + ethers.parseEther('5') }), IF, 'OpeningBuyTooLarge');
  await reverts('creator fee above 10%', factory.connect(creator).launch.staticCall({ ...fresh(), creatorTaxBps: 1100 }, 0, { value: LAUNCH_FEE + base.openingBuy }), IF, 'CreatorTaxTooHigh');
  await reverts('stale economics digest', factory.connect(creator).launch.staticCall({ ...fresh(), expectedEconomics: ethers.id('old') }, 0, { value: LAUNCH_FEE + base.openingBuy }), IF, 'LaunchEconomicsMismatch');
  await reverts('launch without a logo', factory.connect(creator).launch.staticCall({ ...fresh(), logo: '' }, 0, { value: LAUNCH_FEE + base.openingBuy }), IF, 'LogoRequired');
  await reverts('wrong value', factory.connect(creator).launch.staticCall(fresh(), 0, { value: LAUNCH_FEE }), IF, 'LaunchFeeNotPaid');
  const pmI = new ethers.Interface(['error WrappedError(address target, bytes4 selector, bytes reason, bytes details)']);
  try { await new ethers.Contract(PM, ['function initialize((address,address,uint24,int24,address),uint160) returns (int24)'], bob).initialize.staticCall([Z, tok2, 0, 60, hookAddr], 2n ** 96n); ok(false, 'someone else initialized a pool on the hook'); }
  catch (e) { const w = pmI.parseError(e.data || e.info?.error?.data); ok(w && w.args.target === hookAddr && w.args.reason === hook.interface.getError('NotFactory').selector, 'nobody but the factory can initialize a pool on the hook (hook reverts NotFactory)'); }

  log('\nGAS');
  for (const [l, g] of gasLog) log(`  ${l.padEnd(48)} ${g.toString().padStart(9)}  (${ethers.formatEther(g * 50_000_000_000n)} HYPE at 50 gwei)`);
  log(failures ? `\n${failures} FAILED` : '\nALL OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message, e.data || ''); process.exit(1); });
