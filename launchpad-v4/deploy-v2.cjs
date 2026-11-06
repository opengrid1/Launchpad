// Deploys the v2 launchpad stack (the BuzzPad v2 contracts: ETH-paired launches, fees paid out in the pair) on a
// chain that has Uniswap v4: the LiquidFi token implementation where the chain has none yet, a LiquidFiLocker, the
// BuzzPadHook at a CREATE2 address carrying its permission flags, and the BuzzPadFactory. Wires them, adds the ETH
// launch config (1.75 / 7 / 35 ETH, 20% / 30% / 50% of the supply), offers ownership of all of them to the owner
// (Ownable2Step: the owner accepts, for example from the site's admin page). Launches stay off until turned on.
// Resumable: steps done are kept in deployments/<brand>-v2-<network>.progress.json.
//   KEYFILE=../contracts/.env.deployer.zappy OWNER=0x... BRAND=zappy node deploy-v2.cjs --network base [--send]
// RPC override: RPC=http://127.0.0.1:8549 (a fork). LEVERAGE=1 also deploys the ZappyVault and ZappyMargin (leverage),
// wires the vault to the margin contract for good, and offers their ownership too; leverage opens stay off.
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');
const NETS = {
  robinhood: { chainId: 4663, rpc: process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com', pm: '0x8366a39CC670B4001A1121B8F6A443A643e40951', posm: '0x58daec3116aae6D93017bAAea7749052E8a04fA7', permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3', create2: '0x4e59b44847b379578588920cA78FbF26c0B4956C', tokenImpl: null },
  base: { chainId: 8453, rpc: process.env.BASE_RPC || 'https://mainnet.base.org', pm: '0x498581fF718922c3f8e6A244956aF099B2652b2b', posm: '0x7C5f5A4bBd8fD63184577525326123B519429bDc', permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3', create2: '0x4e59b44847b379578588920cA78FbF26c0B4956C', tokenImpl: null },
};
const SEND = process.argv.includes('--send');
const netName = (process.argv[process.argv.indexOf('--network') + 1] || 'base');
const N = NETS[netName]; if (!N) throw new Error('unknown network ' + netName);
const OWNER = process.env.OWNER; if (!OWNER || !ethers.isAddress(OWNER)) throw new Error('set OWNER to the owner wallet');
const BRAND = process.env.BRAND || 'zappy';
const RPC = process.env.RPC || N.rpc;
const AC = ethers.AbiCoder.defaultAbiCoder();
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'artifacts', n + '.json'), 'utf8'));
const PROG = path.join(__dirname, 'deployments', `${BRAND}-v2-${netName}${process.env.RPC ? '-fork' : ''}.progress.json`);
const OUT = path.join(__dirname, 'deployments', `${BRAND}-v2-${netName}${process.env.RPC ? '-fork' : ''}.json`);
const prog = fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG, 'utf8')) : { steps: {} };
const save = () => fs.writeFileSync(PROG, JSON.stringify(prog, null, 1));

(async () => {
  const P = new ethers.JsonRpcProvider(RPC, N.chainId, { staticNetwork: true });
  const key = fs.readFileSync(process.env.KEYFILE || path.join(__dirname, `../contracts/.env.deployer.${BRAND}`), 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/)[2];
  const w = new ethers.Wallet('0x' + key, P), me = w.address;
  const fee = await P.getFeeData();
  console.log(`${netName}: deployer ${me}, ${ethers.formatEther(await P.getBalance(me))} ETH; owner-to-be ${OWNER}; gas ${ethers.formatUnits(fee.gasPrice, 'gwei')} gwei`);
  const Token = art('LiquidFiToken'), Locker = art('LiquidFiLocker'), Hook = art('BuzzPadHook'), Factory = art('BuzzPadFactory');
  const lockerInputs = Locker.abi.find((x) => x.type === 'constructor').inputs;
  const lockerInit = Locker.bytecode + AC.encode(lockerInputs.map((i) => i.type), lockerInputs.map((i) => (/owner/i.test(i.name) ? me : N.posm))).slice(2);
  const hookInit = Hook.bytecode + AC.encode(['address', 'address', 'address'], [N.pm, OWNER, me]).slice(2);
  const FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
  if (!prog.hookSalt) {
    const h = ethers.keccak256(hookInit);
    for (let i = 0n; ; i++) { const s = ethers.zeroPadValue(ethers.toBeHex(i), 32), a = ethers.getCreate2Address(N.create2, s, h); if ((BigInt(a) & 0x3fffn) === FLAGS && (await P.getCode(a)) === '0x') { prog.hookSalt = s; prog.hook = a; break; } }
    save();
  }
  console.log('hook will be', prog.hook);
  const ethCfg = { pairToken: ethers.ZeroAddress, supply: 10n ** 27n, startMcap: ethers.parseEther('1.75'), band1Mcap: ethers.parseEther('7'), band2Mcap: ethers.parseEther('35'), band0Bps: 2000, band1Bps: 3000, tickSpacing: 200, enabled: true };

  let nonce = await P.getTransactionCount(me, 'pending'), dry = 0n;
  const step = async (name, tx) => {
    if (prog.steps[name]) { console.log(`  ${name.padEnd(26)} done ${prog.steps[name].hash}`); return prog.steps[name]; }
    const est = await P.estimateGas({ from: me, ...tx }).catch((e) => { throw new Error(name + ': ' + (e.shortMessage || e.message)); });
    if (!SEND) { console.log(`  ${name.padEnd(26)} ~${est} gas`); dry += est; return null; }
    const f = await P.getFeeData();
    const sent = await w.sendTransaction({ ...tx, nonce: nonce++, gasLimit: (est * 13n) / 10n + 50000n, maxFeePerGas: f.maxFeePerGas * 2n, maxPriorityFeePerGas: f.maxPriorityFeePerGas || 1000n });
    const r = await sent.wait();
    if (r.status !== 1) throw new Error(name + ' reverted ' + sent.hash);
    prog.steps[name] = { hash: sent.hash, block: r.blockNumber, gas: Number(r.gasUsed), address: r.contractAddress || undefined }; save();
    console.log(`  ${name.padEnd(26)} ok ${sent.hash} ${r.gasUsed} gas`); return prog.steps[name];
  };

  const tk = N.tokenImpl ? { address: N.tokenImpl } : await step('LiquidFiToken', { data: Token.bytecode });
  const lk = await step('LiquidFiLocker', { data: lockerInit });
  await step('BuzzPadHook', { to: N.create2, data: prog.hookSalt + hookInit.slice(2) });
  if (!SEND) { console.log(`dry run: about ${dry} gas for the first steps; add --send`); return; }
  const F = (await step('BuzzPadFactory', { data: Factory.bytecode + AC.encode(['address', 'address', 'address', 'address', 'address', 'address', 'address', 'uint256'], [me, N.pm, N.posm, N.permit2, lk.address, prog.hook, tk.address, ethers.parseEther('0.0002')]).slice(2) })).address;
  const H = new ethers.Interface(Hook.abi), LI = new ethers.Interface(Locker.abi), FI = new ethers.Interface(Factory.abi);
  await step('hook.setFactory', { to: prog.hook, data: H.encodeFunctionData('setFactory', [F]) });
  await step('locker.setFactory', { to: lk.address, data: LI.encodeFunctionData('setFactory', [F]) });
  await step('config ETH', { to: F, data: FI.encodeFunctionData('addLaunchConfig', [ethCfg]) });
  const owned = [['hook', prog.hook, H], ['factory', F, FI], ['locker', lk.address, LI]];
  let lev = null;
  if (process.env.LEVERAGE) {
    const Vault = art('ZappyVault'), Margin = art('ZappyMargin'), VI = new ethers.Interface(Vault.abi), MI = new ethers.Interface(Margin.abi);
    const V = (await step('ZappyVault', { data: Vault.bytecode + AC.encode(['address'], [me]).slice(2) })).address;
    const M = (await step('ZappyMargin', { data: Margin.bytecode + AC.encode(['address', 'address', 'address'], [me, F, V]).slice(2) })).address;
    await step('vault.setMargin', { to: V, data: VI.encodeFunctionData('setMargin', [M]) });
    owned.push(['vault', V, VI], ['margin', M, MI]); lev = { vault: V, margin: M };
  }
  for (const [n, a, I] of owned) await step(n + '.transferOwnership', { to: a, data: I.encodeFunctionData('transferOwnership', [OWNER]) });
  const out = { network: netName, chainId: N.chainId, brand: BRAND, deployer: me, owner: OWNER, ownershipPending: true, poolManager: N.pm, positionManager: N.posm, permit2: N.permit2, hook: prog.hook, hookSalt: prog.hookSalt, locker: lk.address, tokenImplementation: tk.address, factory: F, ...(lev ? { leverage: { ...lev, opensEnabled: false } } : {}), launchConfigs: [Object.fromEntries(Object.entries(ethCfg).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]))], launchFee: ethers.parseEther('0.0002').toString(), launchEnabled: false, fromBlock: (prog.steps.LiquidFiToken || prog.steps.LiquidFiLocker).block, transactions: Object.fromEntries(Object.entries(prog.steps).map(([k, v]) => [k, v.hash])), deployedAt: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('written', path.relative(__dirname, OUT));
  console.log(`next: ${OWNER} accepts ownership of the ${owned.map((o) => o[0]).join(', ')}, then factory.setLaunchEnabled(true)${lev ? ' and margin.setOpensEnabled(true)' : ''}`);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
