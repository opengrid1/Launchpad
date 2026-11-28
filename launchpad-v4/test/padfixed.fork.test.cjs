// The fixed-fee hook (PadHookFixed) on an anvil fork of Elysium, deployed by deploy-pad.cjs itself:
//   anvil --fork-url https://rpc.elysium.kinetiq.xyz --port 8547
//   node build/compile-pad.cjs && node build/router-compile.cjs
//   PAD_NAME=fork-fixed PAD_OWNER=<the fork deployer> HOOK_ARTIFACT=PadHookFixed HOOK_FEE_BPS=300 PROTOCOL_SHARE_BPS=6000 \
//     SPLIT_BURN_BPS=10000 STOCK_PAIRS=0 FORK_OF=elysium KEYFILE=<an anvil key> node deploy-pad.cjs --network local --send
//   node test/padfixed.fork.test.cjs fork-fixed
// Checks what the variant is for: the pool fee is the one given at deployment and nothing can change it, there is no
// volatility surcharge however far the price moves, a pool's fee and creator tax together cannot pass 10%, and a
// launch still trades both ways.
const { ethers } = require('ethers');
const fs = require('fs'), path = require('path');
const A = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts', n + '.json'), 'utf8'));
const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../deployments', `pad-${process.argv[2] || 'fork-fixed'}.json`), 'utf8'));
const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || 'http://127.0.0.1:8547', undefined, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
// The deployer is the anvil key deploy-pad.cjs was given. The creator and the trader are fresh wallets funded on the
// fork: anvil's well-known accounts have sweepers attached on real chains (anything they receive is passed straight
// on), which makes a sale look as if it paid nothing.
const owner = new ethers.NonceManager(new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', P));
const creator = new ethers.NonceManager(ethers.Wallet.createRandom().connect(P)), bob = new ethers.NonceManager(ethers.Wallet.createRandom().connect(P));
for (const w of [owner, creator, bob]) w.address = w.signer.address;
let failures = 0;
const ok = (c, m) => { if (!c) failures++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${m}`); };
const fails = async (label, p) => { try { await p; ok(false, label + ': it went through'); } catch (e) { ok(true, label + ': refused'); } };
const E18 = 10n ** 18n, fmt = (v) => Number(ethers.formatEther(v)).toLocaleString('en-US', { maximumFractionDigits: 6 });
(async () => {
  if (d.hookArtifact !== 'PadHookFixed') throw new Error('this record was not deployed with HOOK_ARTIFACT=PadHookFixed');
  const hookAbi = A('PadHookFixed').abi, hook = new ethers.Contract(d.hook, hookAbi, owner), factory = new ethers.Contract(d.factory, A('PadFactory').abi, owner);
  console.log(`fork at block ${await P.getBlockNumber()}; hook ${d.hook}, factory ${d.factory}`);
  for (const w of [creator, bob]) await P.send('anvil_setBalance', [w.address, ethers.toBeHex(1000n * E18)]);

  console.log('\n1. the fee is fixed');
  ok((await hook.hookFeeBps()) === 300n, 'the pool fee is the 3% given at deployment');
  ok((await hook.volExtraBps()) === 0n && (await hook.volThresholdBps()) === 0n, 'the volatility terms are off');
  ok(!hookAbi.some((x) => x.type === 'function' && /^(setHookFeeBps|setVolatilityTerms)$/.test(x.name)), 'the hook has no function to set the fee or the volatility terms');
  const kinex = new ethers.Interface(A('PadHook').abi);
  await fails('the owner calling setHookFeeBps(1000)', owner.call({ to: d.hook, data: kinex.encodeFunctionData('setHookFeeBps', [1000]) }));
  await fails('the owner calling setVolatilityTerms(1000, 60, 1000, 120)', owner.call({ to: d.hook, data: kinex.encodeFunctionData('setVolatilityTerms', [1000, 60, 1000, 120]) }));
  ok((await hook.owner()) === owner.address, 'the caller above is the hook owner');

  console.log('\n2. a launch trades both ways at 3%');
  await (await factory.setLaunchEnabled(true)).wait();
  const fee = await factory.launchFee();
  const params = async (symbol, creatorTaxBps) => ({ name: symbol + ' coin', symbol, logo: 'https://example.com/logo.png', description: '', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' },
    creatorFeeRecipient: creator.address, creatorTaxBps, buybackEnabled: false, expectedEconomics: await factory.previewLaunchEconomics(0), salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n });
  const launch = async (symbol, tax) => {
    const rc = await (await factory.connect(creator).launch(await params(symbol, tax), 0, { value: fee })).wait();
    const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === 'TokenLaunched');
    return { token: ev.args.token, poolId: ev.args[2] };
  };
  const L = await launch('FIX', 0);
  const key = { currency0: ethers.ZeroAddress, currency1: L.token, fee: 0, tickSpacing: 200, hooks: d.hook };
  const coin = new ethers.Contract(L.token, ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'], bob);
  await P.send('evm_increaseTime', [30]); await P.send('evm_mine', []); // past the snipe window
  let f = await hook.feeNow(L.poolId);
  ok(f.baseBps === 300n && f.volatilityBps === 0n && f.snipeBuyBps === 0n && f.creatorTaxBps === 0n, `after the snipe window a trade pays ${Number(f.baseBps) / 100}% and nothing else`);
  const R = A('TestSwapRouter'), rt = await new ethers.ContractFactory(R.abi, R.bytecode, owner).deploy(d.poolManager); await rt.waitForDeployment();
  const surcharged = (rc) => rc.logs.some((l) => { try { return hook.interface.parseLog(l).name === 'SurchargeApplied'; } catch { return false; } });
  let rc = await (await rt.connect(bob).swap(key, true, E18, { value: E18 })).wait();
  const got = await coin.balanceOf(bob.address);
  ok(got > 0n && !surcharged(rc), `a 1 HYPE buy returns ${fmt(got)} coins, with no surcharge`);
  rc = await (await rt.connect(bob).swap(key, true, 40n * E18, { value: 40n * E18 })).wait();
  f = await hook.feeNow(L.poolId);
  ok(!surcharged(rc) && f.volatilityBps === 0n && f.baseBps === 300n, 'a 40 HYPE buy that moves the price far pays the same 3%: no volatility surcharge');
  const have = await coin.balanceOf(bob.address), b0 = await P.getBalance(bob.address);
  await (await coin.approve(rt.target, have)).wait();
  const [q0] = await rt.connect(bob).swap.staticCall(key, false, have / 2n); // what the sell pays out, in HYPE
  rc = await (await rt.connect(bob).swap(key, false, have / 2n)).wait();
  const net = (await P.getBalance(bob.address)) - b0;
  ok(!surcharged(rc) && (await coin.balanceOf(bob.address)) === have - have / 2n, `selling half the coins (${fmt(have / 2n)}) goes through`);
  // 41 HYPE went in for these coins; half of them come back out as roughly half of that, less the 3% fee each way
  ok(q0 > 15n * E18 && net > 15n * E18 && net <= q0, `and pays the seller ${fmt(net)} HYPE net of gas (the pool quoted ${fmt(q0)})`);

  console.log('\n3. fee and creator tax together stay within 10%');
  await (await factory.setMaxCreatorTaxBps(1000)).wait();
  await fails('a launch with an 8% creator tax (11% with the fee)', factory.connect(creator).launch.staticCall(await params('TAX8', 800), 0, { value: fee }));
  const T = await launch('TAX7', 700);
  await P.send('evm_increaseTime', [30]); await P.send('evm_mine', []);
  f = await hook.feeNow(T.poolId);
  ok(f.baseBps + f.creatorTaxBps === 1000n && f.volatilityBps === 0n, `a launch with a 7% creator tax pays ${Number(f.baseBps + f.creatorTaxBps) / 100}% in all, the most a pool can charge`);

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED'); process.exit(failures ? 1 : 0);
})().catch((e) => {
  // name the custom error where one of the stack's contracts raised it
  const data = e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data); let name = '';
  for (const n of ['PadFactory', 'PadHookFixed', 'PadLocker', 'PadToken']) { try { const x = new ethers.Interface(A(n).abi).parseError(data); if (x) { name = n + '.' + x.name + '(' + x.args.join(', ') + ')'; break; } } catch {} }
  console.error('ERROR', e.shortMessage || e.message, name || data || ''); process.exit(1);
});
