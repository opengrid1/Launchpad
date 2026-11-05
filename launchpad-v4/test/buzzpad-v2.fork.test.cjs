// BuzzPad v2 on an Ethereum mainnet fork (node at FORK_RPC, default 127.0.0.1:8548): deploys the v2 stack (new locker,
// BuzzPadHook at a mined address, BuzzPadFactory, the live LiquidFi token implementation), approves AZTEC and WXMR,
// adds one launch config per pair (ETH, AZTEC, WXMR) sized to the same USD opening market cap, then for each pair:
// launch with an opening buy, buy from ETH in one UniversalRouter call (ETH direct; ETH -> AZTEC -> coin through the
// AZTEC/ETH v4 pool; ETH -> WETH -> WXMR on Uniswap v2 -> coin), sell, check that every fee landed in the pair
// currency, pay out to creator and protocol, and check that an exact-output sell is refused.
//   node test/buzzpad-v2.fork.test.cjs
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');
const RPC = process.env.FORK_RPC || 'http://127.0.0.1:8548';
const P = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: true, cacheTimeout: -1 });
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts', n + '.json'), 'utf8'));
const A = {
  pm: '0x000000000004444c5dc75cB358380D2e3dE08A90', posm: '0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e', permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  ur: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', quoter: '0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203', create2: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
  weth: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', tokenImpl: '0x032dAfedf86aFC3699b3B305F484A3F9752b8012',
  aztec: '0xA27EC0006e59f245217Ff08CD52A7E8b169E62D2', aztecHook: '0xd53006d1e3110fD319a79AEEc4c527a0d265E080', wxmr: '0x465e07d6028830124BE2E4aA551fBe12805dB0f5', wxmrV2: '0x14C10b4BDcCD9d3F8940Fb79E0eE00121391D6dE',
};
const KEYS = ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'];
const [owner, creator, trader, protocol] = KEYS.map((k) => new ethers.NonceManager(new ethers.Wallet(k, P)));
const AC = ethers.AbiCoder.defaultAbiCoder(), E18 = 10n ** 18n;
const ERC = ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)'];
const UR = new ethers.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const PERMIT2 = new ethers.Interface(['function approve(address token, address spender, uint160 amount, uint48 expiration)']);
const QUOTER = new ethers.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData)) returns (uint256 amountOut, uint256 gasEstimate)']);
const KEY_T = '(address,address,uint24,int24,address)';
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log((c ? '  ok   ' : '  FAIL ') + m); };
const send = async (w, tx) => { const r = await (await w.sendTransaction({ gasLimit: 3_000_000n, ...tx })).wait(); if (r.status !== 1) throw new Error('reverted'); return r; };
const bal = (t, a) => (t === ethers.ZeroAddress ? P.getBalance(a) : new ethers.Contract(t, ERC, P).balanceOf(a));
const fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });
const now = async () => (await P.getBlock('latest')).timestamp;
const mine = async (s) => { await P.send('evm_increaseTime', [s]); await P.send('evm_mine', []); };

// V4 router actions
const ACT = { SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_IN: 0x07, SWAP_EXACT_OUT_SINGLE: 0x08, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE_ALL: 0x0f };
const CONTRACT_BALANCE = 1n << 255n;
const single = (key, zeroForOne, amountIn, minOut) => AC.encode([`(${KEY_T},bool,uint128,uint128,bytes)`], [[key, zeroForOne, amountIn, minOut, '0x']]);
const v4swap = (actions, params) => AC.encode(['bytes', 'bytes[]'], [ethers.solidityPacked(actions.map(() => 'uint8'), actions), params]);
const exec = async (w, commands, inputs, value = 0n) => send(w, { to: A.ur, data: UR.encodeFunctionData('execute', [commands, inputs, (await now()) + 900]), value });

(async () => {
  for (const w of [owner, creator, trader, protocol]) await P.send('hardhat_setBalance', [await w.getAddress(), '0x' + (1000n * E18).toString(16)]);
  const me = await owner.getAddress(), protocolAddr = await protocol.getAddress();

  // ---- deploy
  const Locker = art('LiquidFiLocker'), Hook = art('BuzzPadHook'), Factory = art('BuzzPadFactory');
  const locker = await new ethers.ContractFactory(Locker.abi, Locker.bytecode, owner).deploy(...lockerArgs(Locker.abi, me)); await locker.waitForDeployment();
  const hookInit = Hook.bytecode + AC.encode(['address', 'address', 'address'], [A.pm, protocolAddr, me]).slice(2);
  const FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
  const initHash = ethers.keccak256(hookInit); let salt, hookAddr;
  for (let i = BigInt(Date.now()) << 20n; ; i++) { salt = ethers.zeroPadValue(ethers.toBeHex(i), 32); hookAddr = ethers.getCreate2Address(A.create2, salt, initHash); if ((BigInt(hookAddr) & 0x3fffn) === FLAGS && (await P.getCode(hookAddr)) === '0x') break; }
  await send(owner, { to: A.create2, data: salt + hookInit.slice(2) });
  const hook = new ethers.Contract(hookAddr, Hook.abi, owner);
  const factory = await new ethers.ContractFactory(Factory.abi, Factory.bytecode, owner).deploy(me, A.pm, A.posm, A.permit2, await locker.getAddress(), hookAddr, A.tokenImpl, ethers.parseEther('0.0002')); await factory.waitForDeployment();
  const F = await factory.getAddress();
  await (await hook.setFactory(F)).wait(); await (await locker.setFactory(F)).wait();
  await (await factory.setPairTokenApproved(A.aztec, true)).wait(); await (await factory.setPairTokenApproved(A.wxmr, true)).wait();
  console.log('hook', hookAddr, 'factory', F);

  // ---- per-pair economics: the ETH config's market caps converted at the live pool prices
  const aztecKey = [ethers.ZeroAddress, A.aztec, 500, 10, A.aztecHook];
  const [aztecPerEth] = QUOTER.decodeFunctionResult('quoteExactInputSingle', await P.call({ to: A.quoter, data: QUOTER.encodeFunctionData('quoteExactInputSingle', [[aztecKey, true, E18, '0x']]) }));
  const pairV2 = new ethers.Contract(A.wxmrV2, ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'], P);
  const [r0, r1] = await pairV2.getReserves(); const wxmrIs0 = (await pairV2.token0()).toLowerCase() === A.wxmr.toLowerCase();
  const wxmrPerEthX = (wxmrIs0 ? r0 : r1) * E18 / (wxmrIs0 ? r1 : r0);
  console.log('1 ETH =', fmt(aztecPerEth), 'AZTEC =', fmt(wxmrPerEthX), 'WXMR');
  const ethCfg = { pairToken: ethers.ZeroAddress, supply: 10n ** 27n, startMcap: ethers.parseEther('1.75'), band1Mcap: ethers.parseEther('7'), band2Mcap: ethers.parseEther('35'), band0Bps: 2000, band1Bps: 3000, tickSpacing: 200, enabled: true };
  const conv = (cfg, pair, perEth) => ({ ...cfg, pairToken: pair, startMcap: cfg.startMcap * perEth / E18, band1Mcap: cfg.band1Mcap * perEth / E18, band2Mcap: cfg.band2Mcap * perEth / E18 });
  const cfgs = [ethCfg, conv(ethCfg, A.aztec, aztecPerEth), conv(ethCfg, A.wxmr, wxmrPerEthX)];
  for (const c of cfgs) await (await factory.addLaunchConfig(c)).wait();
  await (await factory.setLaunchEnabled(true)).wait();
  ok(Number(await factory.launchConfigCount()) === 3, 'three launch configs: ETH, AZTEC (start ' + fmt(cfgs[1].startMcap) + '), WXMR (start ' + fmt(cfgs[2].startMcap) + ')');

  // ---- the creator gets pair tokens for the opening buys through the same routes the site uses
  const C = await creator.getAddress(), T = await trader.getAddress();
  await exec(creator, '0x10', [v4swap([ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL], [single(aztecKey, true, ethers.parseEther('0.5'), 1n), AC.encode(['address', 'uint256'], [ethers.ZeroAddress, ethers.MaxUint256]), AC.encode(['address', 'uint256'], [A.aztec, 0])])], ethers.parseEther('0.5'));
  await exec(creator, '0x0b08', [AC.encode(['address', 'uint256'], ['0x0000000000000000000000000000000000000002', ethers.parseEther('0.5')]), AC.encode(['address', 'uint256', 'uint256', 'address[]', 'bool'], [C, CONTRACT_BALANCE, 1n, [A.weth, A.wxmr], false])], ethers.parseEther('0.5'));
  ok((await bal(A.aztec, C)) > 0n && (await bal(A.wxmr, C)) > 0n, `creator bought AZTEC (${fmt(await bal(A.aztec, C))}) and WXMR (${fmt(await bal(A.wxmr, C))}) from ETH`);

  const L = new ethers.Interface(Factory.abi);
  for (const [i, name, pair] of [[0, 'ETH', ethers.ZeroAddress], [1, 'AZTEC', A.aztec], [2, 'WXMR', A.wxmr]]) {
    console.log(`-- ${name} pair`);
    const cfg = cfgs[i], open = cfg.startMcap / 100n; // opening buy: 1% of the opening market cap
    if (pair !== ethers.ZeroAddress) await (await new ethers.Contract(pair, ERC, creator).approve(F, open)).wait();
    const econ = await factory.previewLaunchEconomics(i);
    const params = { name: name + ' coin', symbol: name.slice(0, 3) + 'C', logo: 'https://x.test/l.png', description: 'v2 test', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: C, creatorTaxBps: 100, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: open, minTokensOut: 0n };
    const predicted = await factory.predictTokenAddress(C, params.salt, i);
    const fee = await factory.launchFee(), protoEth0 = await P.getBalance(protocolAddr);
    const rc = await send(creator, { to: F, data: L.encodeFunctionData('launch', [params, i]), value: fee + (pair === ethers.ZeroAddress ? open : 0n) });
    const ev = rc.logs.map((l) => { try { return L.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
    const coin = ev.args.token, poolId = ev.args.poolId;
    ok(coin === predicted && BigInt(coin) > BigInt(pair) && ev.args.pairToken === pair, `launched ${coin} above the pair, as predicted; gas ${rc.gasUsed}`);
    ok((await P.getBalance(protocolAddr)) - protoEth0 === fee, 'launch fee paid to the protocol in ETH');
    const key = [pair, coin, 0, 200, hookAddr];
    ok((await bal(coin, C)) > 0n, `opening buy: ${fmt(await bal(coin, C))} coins to the creator`);
    const pend0 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    ok(pend0 > 0n, `opening buy fee booked in ${name}: ${fmt(pend0)}`);

    await mine(15); // past the snipe window
    // buy from ETH in one UniversalRouter call
    const ethIn = ethers.parseEther('0.05'); let r;
    const coin0 = await bal(coin, T);
    if (name === 'ETH') {
      r = await exec(trader, '0x10', [v4swap([ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL], [single(key, true, ethIn, 1n), AC.encode(['address', 'uint256'], [pair, ethers.MaxUint256]), AC.encode(['address', 'uint256'], [coin, 0])])], ethIn);
    } else if (name === 'AZTEC') {
      const pathKeys = [[A.aztec, 500, 10, A.aztecHook, '0x'], [coin, 0, 200, hookAddr, '0x']];
      const multi = AC.encode(['(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'], [[ethers.ZeroAddress, pathKeys, ethIn, 1n]]);
      r = await exec(trader, '0x10', [v4swap([ACT.SWAP_EXACT_IN, ACT.SETTLE_ALL, ACT.TAKE_ALL], [multi, AC.encode(['address', 'uint256'], [ethers.ZeroAddress, ethers.MaxUint256]), AC.encode(['address', 'uint256'], [coin, 0])])], ethIn);
    } else {
      r = await exec(trader, '0x0b0810', [
        AC.encode(['address', 'uint256'], ['0x0000000000000000000000000000000000000002', ethIn]),
        AC.encode(['address', 'uint256', 'uint256', 'address[]', 'bool'], ['0x0000000000000000000000000000000000000002', CONTRACT_BALANCE, 1n, [A.weth, A.wxmr], false]),
        v4swap([ACT.SETTLE, ACT.SWAP_EXACT_IN_SINGLE, ACT.TAKE_ALL], [AC.encode(['address', 'uint256', 'bool'], [pair, CONTRACT_BALANCE, false]), single(key, true, 0n, 1n), AC.encode(['address', 'uint256'], [coin, 0])]),
      ], ethIn);
    }
    const bought = (await bal(coin, T)) - coin0;
    ok(bought > 0n, `buy from 0.05 ETH${name === 'ETH' ? '' : ' via ' + name}: ${fmt(bought)} coins, gas ${r.gasUsed}`);
    const pend1 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    ok(pend1 > pend0, `buy fee booked in ${name}: +${fmt(pend1 - pend0)}`);
    ok((await bal(coin, hookAddr)) === 0n, 'the hook holds no coins (no coin-denominated fees)');

    // sell half back to the pair (Permit2 approval, exact input)
    const sellAmt = bought / 2n;
    await (await new ethers.Contract(coin, ERC, trader).approve(A.permit2, ethers.MaxUint256)).wait();
    await send(trader, { to: A.permit2, data: PERMIT2.encodeFunctionData('approve', [coin, A.ur, (1n << 160n) - 1n, (await now()) + 86400]) });
    const [quoted] = QUOTER.decodeFunctionResult('quoteExactInputSingle', await P.call({ to: A.quoter, data: QUOTER.encodeFunctionData('quoteExactInputSingle', [[key, false, sellAmt, '0x']]) }));
    const pairBefore = await bal(pair, T);
    r = await exec(trader, '0x10', [v4swap([ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL], [single(key, false, sellAmt, 1n), AC.encode(['address', 'uint256'], [coin, ethers.MaxUint256]), AC.encode(['address', 'uint256'], [pair, 0])])]);
    const got = (await bal(pair, T)) - pairBefore + (pair === ethers.ZeroAddress ? r.gasUsed * r.gasPrice : 0n);
    ok(got > 0n && (got === quoted || (got > quoted * 999n / 1000n && got < quoted * 1001n / 1000n)), `sell ${fmt(sellAmt)} coins: ${fmt(got)} ${name} (V4Quoter said ${fmt(quoted)})`);
    const pend2 = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    ok(pend2 > pend1, `sell fee booked in ${name}: +${fmt(pend2 - pend1)}`);

    // exact-output sell is refused
    let refused = false;
    try { await P.call({ from: T, to: A.ur, data: UR.encodeFunctionData('execute', ['0x10', [v4swap([ACT.SWAP_EXACT_OUT_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL], [AC.encode([`(${KEY_T},bool,uint128,uint128,bytes)`], [[key, false, 1000n, sellAmt, '0x']]), AC.encode(['address', 'uint256'], [coin, ethers.MaxUint256]), AC.encode(['address', 'uint256'], [pair, 0])])], (await now()) + 900]) }); } catch (e) { refused = true; }
    ok(refused, 'exact-output sell refused');

    // payout: anyone triggers, creator and protocol receive the pair currency
    const pc = await hook.pendingCreator(poolId), pp = await hook.pendingProtocol(poolId);
    const c0 = await bal(pair, C), p0 = await bal(pair, protocolAddr);
    await send(trader, { to: hookAddr, data: hook.interface.encodeFunctionData('payout', [poolId]) });
    const cGot = (await bal(pair, C)) - c0, pGot = (await bal(pair, protocolAddr)) - p0;
    ok(cGot === pc && pGot === pp && (await hook.pendingCreator(poolId)) === 0n, `payout by a third party: creator +${fmt(cGot)}, protocol +${fmt(pGot)} ${name}`);
    // the protocol gets 30% of the fee bucket only; the creator tax (1% here) is all the creator's
    const logs = await P.getLogs({ address: hookAddr, topics: [hook.interface.getEvent('HookFeeCollected').topicHash, poolId], fromBlock: (await P.getBlockNumber()) - 300 });
    let feeSum = 0n, taxSum = 0n; for (const l of logs) { const d = hook.interface.parseLog(l).args; feeSum += d.feeAmount; taxSum += d.taxAmount; }
    const expP = feeSum * 3000n / 10000n;
    ok(pp + pc === feeSum + taxSum && pp <= expP && pp + BigInt(logs.length) >= expP, `split: fees ${fmt(feeSum)} + creator tax ${fmt(taxSum)}; protocol ${fmt(pp)} = 30% of fees`);
  }

  // snipe tax: a buy right after launch pays far more than the base fee
  {
    const params = { name: 'Snipe', symbol: 'SNP', logo: 'https://x.test/l.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: C, creatorTaxBps: 0, expectedEconomics: ethers.ZeroHash, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
    await P.send('evm_setAutomine', [false]);
    const t1 = await creator.sendTransaction({ to: F, data: L.encodeFunctionData('launch', [params, 0]), value: await factory.launchFee(), gasLimit: 3_000_000n });
    const coin = await factory.predictTokenAddress(C, params.salt, 0); const key = [ethers.ZeroAddress, coin, 0, 200, hookAddr];
    const t2 = await trader.sendTransaction({ to: A.ur, data: UR.encodeFunctionData('execute', ['0x10', [v4swap([ACT.SWAP_EXACT_IN_SINGLE, ACT.SETTLE_ALL, ACT.TAKE_ALL], [single(key, true, ethers.parseEther('0.1'), 0n), AC.encode(['address', 'uint256'], [ethers.ZeroAddress, ethers.MaxUint256]), AC.encode(['address', 'uint256'], [coin, 0])])], (await now()) + 900]), value: ethers.parseEther('0.1'), gasLimit: 1_000_000n });
    await P.send('evm_mine', []); await P.send('evm_setAutomine', [true]);
    await t1.wait(); await t2.wait();
    const poolId = ethers.keccak256(AC.encode([KEY_T], [key]));
    const pend = (await hook.pendingCreator(poolId)) + (await hook.pendingProtocol(poolId));
    const elapsed = (await P.getBlock((await t2.wait()).blockNumber)).timestamp - (await P.getBlock((await t1.wait()).blockNumber)).timestamp;
    const snipe = Math.min(9900 >> Math.floor(elapsed * 14 / 10), 9800), expect = ethers.parseEther('0.1') * BigInt(100 + snipe) / 10000n;
    ok(pend === expect, `snipe ${elapsed}s after launch paid ${fmt(pend)} ETH of its 0.1 ETH (${(100 + snipe) / 100}%, as the halving curve says)`);
  }

  console.log(fails ? `FAILURES ${fails}` : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERROR', e.shortMessage || e.message); process.exit(1); });

// LiquidFiLocker's constructor: (positionManager, owner) in some order; read it from the ABI
function lockerArgs(abi, me) {
  const c = abi.find((x) => x.type === 'constructor');
  return c.inputs.map((i) => (/owner/i.test(i.name) ? me : A.posm));
}
