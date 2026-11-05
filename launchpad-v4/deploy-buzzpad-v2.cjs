// Deploys BuzzPad v2 on Ethereum mainnet (or a fork with ETH_RPC): a new LiquidFiLocker, the BuzzPadHook at a CREATE2
// address carrying its permission flags, and the BuzzPadFactory on the live LiquidFi token implementation. Wires
// them, approves AZTEC and WXMR as pairs, adds one launch config per pair (ETH 1.75 / 7 / 35, the others converted
// at the live pool prices), and offers ownership of all three to the admin wallet (Ownable2Step: it accepts).
// Launches stay off until the admin turns them on. Resumable: steps done are kept in
// deployments/buzzpad-v2.progress.json.
//   KEYFILE=../contracts/.env.deployer.buzzpad node deploy-buzzpad-v2.cjs [--send]
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');
const RPC = process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com';
const OWNER = process.env.BUZZPAD_OWNER || '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const SEND = process.argv.includes('--send');
const A = {
  pm: '0x000000000004444c5dc75cB358380D2e3dE08A90', posm: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e', permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203', create2: '0x4e59b44847b379578588920cA78FbF26c0B4956C', tokenImpl: '0x032dAfedf86aFC3699b3B305F484A3F9752b8012',
  aztec: '0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2', aztecHook: '0xd53006d1e3110fD319a79AEEc4c527a0d265E080', wxmr: '0x465e07d6028830124BE2E4aA551fBe12805dB0f5', wxmrV2: '0x14C10b4BDcCD9d3F8940Fb79E0eE00121391D6dE',
};
const E18 = 10n ** 18n, AC = ethers.AbiCoder.defaultAbiCoder();
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'artifacts', n + '.json'), 'utf8'));
const PROG = path.join(__dirname, 'deployments', 'buzzpad-v2.progress.json'), OUT = path.join(__dirname, 'deployments', 'buzzpad-v2-ethereum.json');
const prog = fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG, 'utf8')) : { steps: {} };
const save = () => fs.writeFileSync(PROG, JSON.stringify(prog, null, 1));

(async () => {
  const P = new ethers.JsonRpcProvider(RPC, 1, { staticNetwork: true });
  const keyFile = process.env.KEYFILE || path.join(__dirname, '../contracts/.env.deployer.buzzpad');
  const key = fs.readFileSync(keyFile, 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/)[2];
  const w = new ethers.Wallet('0x' + key, P), me = w.address;
  const gp = (await P.getFeeData()).gasPrice;
  console.log(`deployer ${me}, ${ethers.formatEther(await P.getBalance(me))} ETH; owner-to-be ${OWNER}; gas ${ethers.formatUnits(gp, 'gwei')} gwei`);

  const Locker = art('LiquidFiLocker'), Hook = art('BuzzPadHook'), Factory = art('BuzzPadFactory');
  const lockerCtor = Locker.abi.find((x) => x.type === 'constructor').inputs.map((i) => (/owner/i.test(i.name) ? me : A.posm));
  const lockerInit = Locker.bytecode + AC.encode(Locker.abi.find((x) => x.type === 'constructor').inputs.map((i) => i.type), lockerCtor).slice(2);
  const hookInit = Hook.bytecode + AC.encode(['address', 'address', 'address'], [A.pm, OWNER, me]).slice(2);
  const FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
  if (!prog.hookSalt) {
    const h = ethers.keccak256(hookInit);
    for (let i = 0n; ; i++) { const s = ethers.zeroPadValue(ethers.toBeHex(i), 32), a = ethers.getCreate2Address(A.create2, s, h); if ((BigInt(a) & 0x3fffn) === FLAGS && (await P.getCode(a)) === '0x') { prog.hookSalt = s; prog.hook = a; break; } }
    save();
  }
  console.log('hook will be', prog.hook);

  // live pair prices -> launch configs
  const QI = new ethers.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) returns (uint256 amountOut, uint256 gasEstimate)']);
  const [aztecPerEth] = QI.decodeFunctionResult('quoteExactInputSingle', await P.call({ to: A.quoter, data: QI.encodeFunctionData('quoteExactInputSingle', [[[ethers.ZeroAddress, A.aztec, 500, 10, A.aztecHook], true, E18 / 10n, '0x']]) })).map((x) => x * 10n);
  const v2 = new ethers.Contract(A.wxmrV2, ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'], P);
  const [r0, r1] = await v2.getReserves(); const x0 = (await v2.token0()).toLowerCase() === A.wxmr.toLowerCase();
  const wxmrPerEth = (x0 ? r0 : r1) * E18 / (x0 ? r1 : r0);
  const round = (v) => { const s = v.toString(); const keep = 3n, z = BigInt(s.length) - keep; return z > 0n ? (v / 10n ** z) * 10n ** z : v; }; // 3 significant digits
  const ethCfg = { pairToken: ethers.ZeroAddress, supply: 10n ** 27n, startMcap: ethers.parseEther('1.75'), band1Mcap: ethers.parseEther('7'), band2Mcap: ethers.parseEther('35'), band0Bps: 2000, band1Bps: 3000, tickSpacing: 200, enabled: true };
  const conv = (pair, per) => ({ ...ethCfg, pairToken: pair, startMcap: round(ethCfg.startMcap * per / E18), band1Mcap: round(ethCfg.band1Mcap * per / E18), band2Mcap: round(ethCfg.band2Mcap * per / E18) });
  prog.configs = prog.configs || [ethCfg, conv(A.aztec, aztecPerEth), conv(A.wxmr, wxmrPerEth)].map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])));
  save();
  for (const [n, c] of [['ETH', prog.configs[0]], ['AZTEC', prog.configs[1]], ['WXMR', prog.configs[2]]]) console.log(`config ${n}: opens at ${ethers.formatEther(c.startMcap)}, bands from ${ethers.formatEther(c.band1Mcap)} and ${ethers.formatEther(c.band2Mcap)}`);

  // steps
  let nonce = await P.getTransactionCount(me, 'pending');
  const step = async (name, tx, gasLimit) => {
    if (prog.steps[name]) { console.log(`  ${name.padEnd(28)} done ${prog.steps[name].hash}`); return prog.steps[name]; }
    const est = await P.estimateGas({ from: me, ...tx }).catch((e) => { throw new Error(name + ': ' + (e.shortMessage || e.message)); });
    if (!SEND) { console.log(`  ${name.padEnd(28)} ~${est} gas`); prog.dryGas = (prog.dryGas || 0n) + est; return null; }
    const fee = await P.getFeeData();
    const sent = await w.sendTransaction({ ...tx, nonce: nonce++, gasLimit: gasLimit || (est * 12n) / 10n + 50000n, maxFeePerGas: fee.maxFeePerGas * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas || 1000000n });
    const r = await sent.wait();
    if (r.status !== 1) throw new Error(name + ' reverted ' + sent.hash);
    prog.steps[name] = { hash: sent.hash, block: r.blockNumber, gas: Number(r.gasUsed), address: r.contractAddress || undefined }; save();
    console.log(`  ${name.padEnd(28)} ok ${sent.hash} ${r.gasUsed} gas`); return prog.steps[name];
  };

  const lk = await step('LiquidFiLocker', { data: lockerInit });
  await step('BuzzPadHook', { to: A.create2, data: prog.hookSalt + hookInit.slice(2) });
  if (!SEND) { console.log(`dry run: about ${prog.dryGas} gas for the first two; add --send`); delete prog.dryGas; save(); return; }
  const lockerAddr = lk.address;
  const fInit = Factory.bytecode + AC.encode(['address', 'address', 'address', 'address', 'address', 'address', 'address', 'uint256'], [me, A.pm, A.posm, A.permit2, lockerAddr, prog.hook, A.tokenImpl, ethers.parseEther('0.0002')]).slice(2);
  const fac = await step('BuzzPadFactory', { data: fInit });
  const F = fac.address;
  const H = new ethers.Interface(Hook.abi), LI = new ethers.Interface(Locker.abi), FI = new ethers.Interface(Factory.abi);
  await step('hook.setFactory', { to: prog.hook, data: H.encodeFunctionData('setFactory', [F]) });
  await step('locker.setFactory', { to: lockerAddr, data: LI.encodeFunctionData('setFactory', [F]) });
  await step('approve AZTEC', { to: F, data: FI.encodeFunctionData('setPairTokenApproved', [A.aztec, true]) });
  await step('approve WXMR', { to: F, data: FI.encodeFunctionData('setPairTokenApproved', [A.wxmr, true]) });
  for (const [i, n] of [[0, 'ETH'], [1, 'AZTEC'], [2, 'WXMR']]) await step('config ' + n, { to: F, data: FI.encodeFunctionData('addLaunchConfig', [prog.configs[i]]) });
  for (const [n, a, I] of [['hook', prog.hook, H], ['factory', F, FI], ['locker', lockerAddr, LI]]) await step(n + '.transferOwnership', { to: a, data: I.encodeFunctionData('transferOwnership', [OWNER]) });

  const out = { network: 'ethereum', chainId: 1, deployer: me, owner: OWNER, ownershipPending: true, feeSweepOperator: null, poolManager: A.pm, positionManager: A.posm, permit2: A.permit2, hook: prog.hook, hookSalt: prog.hookSalt, locker: lockerAddr, tokenImplementation: A.tokenImpl, factory: F, pairs: { ETH: ethers.ZeroAddress, AZTEC: A.aztec, WXMR: A.wxmr }, launchConfigs: prog.configs, launchFee: ethers.parseEther('0.0002').toString(), launchEnabled: false, fromBlock: prog.steps['LiquidFiLocker'].block, transactions: Object.fromEntries(Object.entries(prog.steps).map(([k, v]) => [k, v.hash])), deployedAt: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('written', path.relative(__dirname, OUT));
  console.log(`next: ${OWNER} calls acceptOwnership() on the hook, factory and locker, then factory.setLaunchEnabled(true)`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
