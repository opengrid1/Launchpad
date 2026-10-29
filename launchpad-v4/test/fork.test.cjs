// Deploys the exact Pons v2 contracts (recompiled, bytecode-identical) plus the official Uniswap v4
// PositionManager on a Hardhat fork of HyperEVM, with HYPE launch economics, and runs the whole lifecycle:
// launch-and-buy, snipe tax, curve buys and sells, graduation into the PoolManager it deploys, pool swaps
// through the hook, fee sweep, escrow claims. Prints gas per step.
const { ethers } = require('ethers'); const fs = require('fs');
const path = require('path');
const A = new Proxy({}, { get: (_, n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts', n + '.json'), 'utf8')) });
const R = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/TestSwapRouter.json'), 'utf8'));
const POSM = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/position-manager.sourcify.json'), 'utf8'));
const P = new ethers.JsonRpcProvider('http://127.0.0.1:8547', undefined, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
// hardhat's default funded accounts
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'];
const [owner, creator, bob, sniper] = KEYS.map((k) => new ethers.NonceManager(new ethers.Wallet(k, P)));
for (const w of [owner, creator, bob, sniper]) w.address = w.signer.address;
// HyperEVM has Uniswap's official v4 PoolManager and PositionManager, Permit2, the CREATE2 proxy and WHYPE; the test
// uses them. On a fork of a chain without v4, FORK_POOL_MANAGER= and FORK_POSM= empty make the test deploy the official
// builds (build/*.sourcify.json) exactly as deploy.cjs does.
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3', WHYPE = process.env.FORK_WETH9 || '0x5555555555555555555555555555555555555555', C2 = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const PMJ = JSON.parse(fs.readFileSync(path.join(__dirname, '../build/pool-manager.sourcify.json'), 'utf8'));
const envAddr = (k, dflt) => (process.env[k] === undefined ? dflt : process.env[k] || null);
let PM = envAddr('FORK_POOL_MANAGER', '0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F'); if (PM) PM = PM.toLowerCase();
const POSM_ADDR = envAddr('FORK_POSM', '0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9');
const E18 = 10n ** 18n;
const CFG = { supply: 1_000_000_000n * E18, curveFeeBps: 100n, phantomQuote: 48n * E18, graduationThreshold: 120n * E18, poolFee: 0, tickSpacing: 200, enabled: true };
const LAUNCH_FEE = ethers.parseEther('0.005');
const gasLog = [];
const log = (s) => console.log(s);
async function deploy(name, args, signer = owner, overrides = {}) {
  const f = new ethers.ContractFactory(A[name].abi, A[name].bytecode, signer);
  const c = await f.deploy(...args, overrides); const rc = await c.deploymentTransaction().wait();
  gasLog.push([`deploy ${name}`, rc.gasUsed]); return c;
}
async function send(label, p) { const tx = await p; const rc = await tx.wait(); if (rc.status !== 1) throw new Error(label + ' failed'); gasLog.push([label, rc.gasUsed]); return rc; }
(async () => {
  log('fork block ' + (await P.getBlockNumber()) + ', WHYPE code ' + ((await P.getCode(WHYPE)).length - 2) / 2 + ' B, Permit2 code ' + ((await P.getCode(PERMIT2)).length - 2) / 2 + ' B');
  // ---- 0. official PoolManager (v4-core 0.8.26 build from Sourcify) when the chain has none
  if (!PM) {
    const pmInit = PMJ.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address'], [owner.address]).slice(2);
    const pmTx = await owner.sendTransaction({ data: pmInit }); const pmRc = await pmTx.wait(); gasLog.push(['deploy PoolManager', pmRc.gasUsed]);
    PM = pmRc.contractAddress.toLowerCase(); log('PoolManager ' + PM);
  }
  // ---- 1. the chain's PositionManager, or the official build (v4-periphery 0.8.26 from Sourcify, descriptor empty)
  let posmAddr = POSM_ADDR;
  if (!posmAddr) {
    const posmInit = POSM.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint256', 'address', 'address'], [PM, PERMIT2, 300000, ethers.ZeroAddress, WHYPE]).slice(2);
    const posmTx = await owner.sendTransaction({ data: posmInit }); const posmRc = await posmTx.wait(); gasLog.push(['deploy PositionManager', posmRc.gasUsed]);
    posmAddr = posmRc.contractAddress;
  }
  const posm = new ethers.Contract(posmAddr, POSM.abi, owner);
  if ((await posm.poolManager()).toLowerCase() !== PM) throw new Error('posm wiring');
  log('PoolManager ' + PM + ', PositionManager ' + posm.target + ' (code ' + ((await P.getCode(posm.target)).length - 2) / 2 + ' B)');
  // ---- 2. Pons core, same order as their deployment
  const escrow = await deploy('PonsV2FeeEscrow', []);
  // hook: address must carry exactly beforeInitialize | afterSwap | afterSwapReturnDelta
  const FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n), MASK = (1n << 14n) - 1n;
  const hookInit = A.PonsV2MemeHook.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'address', 'address'], [PM, escrow.target, owner.address, owner.address]).slice(2);
  const initHash = ethers.keccak256(hookInit); let salt, hookAddr; const t0 = Date.now();
  for (let i = 0; ; i++) { salt = ethers.zeroPadValue(ethers.toBeHex(i), 32); hookAddr = ethers.getCreate2Address(C2, salt, initHash); if ((BigInt(hookAddr) & MASK) === FLAGS) break; }
  log(`hook salt mined in ${(Date.now() - t0) / 1000}s: ${hookAddr}`);
  await send('deploy PonsV2MemeHook (CREATE2)', owner.sendTransaction({ to: C2, data: salt + hookInit.slice(2), gasLimit: 6_000_000n }));
  if ((await P.getCode(hookAddr)) === '0x') throw new Error('hook not deployed');
  const hook = new ethers.Contract(hookAddr, A.PonsV2MemeHook.abi, owner);
  const vault = await deploy('PonsV2BuybackVault', [owner.address, hookAddr, escrow.target]);
  const locker = await deploy('PonsV2LaunchLocker', [owner.address, posm.target]);
  const factory = await deploy('PonsV2LaunchFactory', [owner.address, PM, posm.target, PERMIT2, locker.target, hookAddr, escrow.target, vault.target, LAUNCH_FEE]);
  const executor = await deploy('PonsV2GraduationExecutor', [posm.target, PERMIT2, locker.target, factory.target]);
  const ldeployer = await deploy('PonsV2LaunchDeployer', [factory.target]);
  const lab = await deploy('PonsV2LaunchAndBuy', [factory.target, owner.address]);
  // ---- 3. wiring, HYPE economics
  await send('hook.setFactory', hook.setFactory(factory.target));
  await send('hook.setBuybackVault', hook.setBuybackVault(vault.target));
  await send('vault.setFactory', vault.setFactory(factory.target));
  await send('locker.setFactory', locker.setFactory(factory.target));
  await send('factory.setGraduationExecutor', factory.setGraduationExecutor(executor.target));
  await send('factory.setLaunchDeployer', factory.setLaunchDeployer(ldeployer.target));
  await send('factory.setLaunchForwarder', factory.setLaunchForwarder(lab.target));
  await send('factory.addLaunchConfig (48/120 HYPE)', factory.addLaunchConfig(CFG));
  await send('factory.setSnipeTaxSeconds(12)', factory.setSnipeTaxSeconds(12));
  await send('factory.setLaunchEnabled', factory.setLaunchEnabled(true));
  log('factory ' + factory.target + ' canLaunch(creator) ' + (await factory.canLaunch(creator.address)));
  const econ = await factory.previewLaunchEconomics(0, ethers.ZeroAddress);
  // ---- 4. launch and buy (creator), 2 HYPE opening buy
  const params = { name: 'Elysium Test', symbol: 'ELT', logo: 'ipfs://logo', description: 'fork test', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: creator.address, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)) };
  const labC = lab.connect(creator);
  const quoteIn = ethers.parseEther('2');
  const rcL = await send('launchAndBuy (2 HYPE)', labC.launchAndBuy(params, 0, ethers.ZeroAddress, quoteIn, 0, creator.address, [], { value: LAUNCH_FEE + quoteIn, gasLimit: 8_000_000n }));
  const ev = rcL.logs.map((l) => { try { return lab.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'Launched');
  const token = ev.args.token, curveAddr = ev.args.curve;
  const curve = new ethers.Contract(curveAddr, A.PonsV2BondingCurve.abi, P), coin = new ethers.Contract(token, A.PonsV2LauncherToken.abi, P);
  log(`launched ${await coin.name()} (${await coin.symbol()}) token ${token} curve ${curveAddr}; creator got ${ethers.formatEther(ev.args.tokensReceived)} for 2 HYPE`);
  const [qr, tr] = await curve.getReserves(); log(`curve reserves: quote ${ethers.formatEther(qr)} (48 phantom + real), tokens ${ethers.formatEther(tr)}; sellable ${ethers.formatEther(await curve.sellableTokens())}; reserved ${ethers.formatEther(await curve.reservedTokens())}`);
  // ---- 5. snipe tax: a sniper in the launch block window vs later
  const launchedAt = Number(await curve.launchedAt());
  const taxNow = await curve.currentSnipeTaxBps(sniper.address), taxCreator = await curve.currentSnipeTaxBps(creator.address);
  log(`snipe tax right after launch: sniper ${Number(taxNow) / 100}%, creator ${Number(taxCreator) / 100}% (exempt)`);
  const sn = await send('sniper buy 1 HYPE in the window', curve.connect(sniper).buy(ethers.parseEther('1'), 0, sniper.address, { value: ethers.parseEther('1') }));
  const snEv = sn.logs.map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'CurveBuy');
  log(`  sniper paid fee+tax ${ethers.formatEther(snEv.args.fee)} HYPE of 1, got ${ethers.formatEther(snEv.args.tokensOut)} ELT`);
  for (const dt of [4, 8, 12]) { // the fork's blocks may already be past the step (1 s per block on HyperEVM): never go backwards
    const t = Math.max(launchedAt + dt, Number((await P.getBlock('latest')).timestamp) + 1);
    await P.send('evm_setNextBlockTimestamp', [t]); await P.send('evm_mine', []); log(`  at +${t - launchedAt}s: snipe tax ${Number(await curve.currentSnipeTaxBps(sniper.address)) / 100}%`);
  }
  // ---- 6. normal buys and a sell on the curve
  const b1 = await send('bob buy 10 HYPE', curve.connect(bob).buy(ethers.parseEther('10'), 0, bob.address, { value: ethers.parseEther('10') }));
  const bobBal = await coin.balanceOf(bob.address); log(`  bob holds ${ethers.formatEther(bobBal)} ELT`);
  await send('bob approve', coin.connect(bob).approve(curveAddr, bobBal));
  const half = bobBal / 2n; const before = await P.getBalance(bob.address);
  const s1 = await send('bob sell half', curve.connect(bob).sell(half, 0, bob.address));
  log(`  bob sold ${ethers.formatEther(half)} ELT for ${ethers.formatEther((await P.getBalance(bob.address)) - before + s1.gasUsed * s1.gasPrice)} HYPE`);
  // ---- 7. buy out the curve: graduation should happen inside the crossing buy
  const [qr2] = await curve.getReserves(); const need = 120n * E18 - (qr2 - 48n * E18);
  log(`real quote so far ${ethers.formatEther(qr2 - 48n * E18)} HYPE; sending ${ethers.formatEther(need + 20n * E18)} to cross the 120 HYPE threshold`);
  const balB = await P.getBalance(bob.address);
  const cross = await send('crossing buy (auto-graduate)', curve.connect(bob).buy(need + 20n * E18, 0, bob.address, { value: need + 20n * E18, gasLimit: 6_000_000n }));
  const names = cross.logs.map((l) => { for (const i of [curve.interface, factory.interface, hook.interface, locker.interface]) { try { return i.parseLog(l).name; } catch {} } return null; }).filter(Boolean);
  log('  events: ' + names.join(', '));
  const refund = cross.logs.map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'CurveBuyRefunded');
  log(`  refund of the overshoot: ${refund ? ethers.formatEther(refund.args.refund) : 0} HYPE; bob spent ${ethers.formatEther(balB - (await P.getBalance(bob.address)) - cross.gasUsed * cross.gasPrice)} HYPE`);
  let L = await factory.getLaunchedToken(token);
  log(`  graduated: ${await curve.graduated()}, phase ${L.phase} (1 = Swept: the crossing buy sweeps the curve; phase 2 is its own permissionless tx, which Pons' keeper sends)`);
  const g2 = await send('createGraduatedPool (anyone)', factory.connect(bob).createGraduatedPool(token, { gasLimit: 6_000_000n }));
  L = await factory.getLaunchedToken(token); log(`  phase now ${L.phase} (2 = PoolCreated)`);
  const posId = await locker.lockedPositions(token); log(`  locker holds position #${posId}, owner ${await posm.ownerOf(posId)} == locker ${locker.target}; locked leftover supply ${ethers.formatEther(await locker.lockedTokenSupply(token))} ELT`);
  const pg = g2.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'PoolGraduated');
  log(`  pool seeded with ${ethers.formatEther(pg.args.tokenAmount)} ELT + ${ethers.formatEther(pg.args.pairTokenAmount)} HYPE`);
  // ---- 8. swaps on the graduated pool through our test router, fees taken by the hook
  const router = new ethers.ContractFactory(R.abi, R.bytecode, owner); const rt = await router.deploy(PM); await rt.deploymentTransaction().wait();
  const key = { currency0: ethers.ZeroAddress, currency1: token, fee: 0, tickSpacing: 200, hooks: hookAddr };
  const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address', 'address', 'uint24', 'int24', 'address'], [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  const sw1 = await send('pool buy 1 HYPE -> ELT', rt.connect(sniper).swap(key, true, ethers.parseEther('1'), { value: ethers.parseEther('1') }));
  const got = await coin.balanceOf(sniper.address);
  await send('approve router', coin.connect(sniper).approve(rt.target, got));
  const sw2 = await send('pool sell all ELT -> HYPE', rt.connect(sniper).swap(key, false, got));
  log(`  hook pending fees: ${ethers.formatEther(await hook.pendingFees(poolId, ethers.ZeroAddress))} HYPE + ${ethers.formatEther(await hook.pendingFees(poolId, token))} ELT`);
  // ---- 9. sweep (operator = owner) and claims
  await send('hook.sweepPoolFees', hook.sweepPoolFees(poolId, 1, 0));
  const cEsc = await escrow.balanceOf(creator.address), pEsc = await escrow.balanceOf(owner.address);
  log(`  escrow after sweep: creator ${ethers.formatEther(cEsc)} HYPE, protocol ${ethers.formatEther(pEsc)} HYPE (70/30 of the 1% on curve + pool)`);
  const cb = await P.getBalance(creator.address); const cl = await send('creator claim', escrow.connect(creator)['claim()']());
  log(`  creator claimed ${ethers.formatEther((await P.getBalance(creator.address)) - cb + cl.gasUsed * cl.gasPrice)} HYPE`);
  // ---- 10. the curve refuses trades after graduation
  try { await curve.connect(bob).buy(E18, 0, bob.address, { value: E18 }); log('FAIL curve still buyable'); } catch { log('  curve closed after graduation (buy reverts), as expected'); }
  log('\nGAS');
  for (const [l, g] of gasLog) log(`  ${l.padEnd(44)} ${g.toString().padStart(9)}  (${ethers.formatEther(g * 50000000000n)} HYPE at 50 gwei)`);
  log('\nALL OK');
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message, e.data || ''); process.exit(1); });
