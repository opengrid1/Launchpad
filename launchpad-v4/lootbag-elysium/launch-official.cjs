// Launches KinetiqPump's own coin on Elysium from the deployer wallet, paid for in HYPE. Paired with HYPE, the dev
// buy goes straight in; paired with KNTQ, the factory swaps it into KNTQ inside the launch. Holders are paid in HYPE
// and KNTQ by turns. A ticker that was launched before costs the copy fee on top, which the factory holds until the
// owner refunds it to the creator or keeps it (admin page, Coin tools).
//   node launch-official.cjs <file holding the picture as a data: URI>            dry run: simulates, sends nothing
//   node launch-official.cjs <picture file> --send
// Env: PAIR (HYPE, the default, or KNTQ), DEV_BUY (HYPE, default 0.15). The key is read from
// .env.deployer.kinetiqpump2 here, or KEYFILE. Elysium's public RPC refuses transactions much over 6,000 bytes, so the
// picture has to be a small one.
const fs = require('fs'), path = require('path');
const { ethers } = require(path.join(__dirname, '../node_modules/ethers'));
// DEPLOY_NAME names the deployment record to launch on (the default is the first deployment's)
const dep = JSON.parse(fs.readFileSync(path.join(__dirname, 'deployments', (process.env.DEPLOY_NAME || 'kinetiqpump-elysium') + '.json'), 'utf8'));
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, 'out/KinetiqPumpFactory.sol/KinetiqPumpFactory.json'), 'utf8')).abi;
const SEND = process.argv.includes('--send'), IMG = process.argv[2];
const PAIR = (process.env.PAIR || 'HYPE').toUpperCase();
if (PAIR !== 'HYPE' && PAIR !== 'KNTQ') throw new Error('PAIR is HYPE or KNTQ');
const DEV = ethers.parseEther(process.env.DEV_BUY || '0.15');
// COIN_NAME and COIN_SYMBOL launch another coin with the same script (a test coin); its record is coin-<symbol>.json
const NAME = process.env.COIN_NAME || 'kinetiqpump.fun', SYMBOL = (process.env.COIN_SYMBOL || 'KPUMP').toUpperCase(), OFFICIAL = SYMBOL === 'KPUMP';
const META = {
  image: fs.readFileSync(IMG, 'utf8').trim(),
  description: process.env.COIN_DESC || "The official coin of KinetiqPump, the launchpad on Elysium where every trade pays a coin's holders straight to their wallets.",
  x: 'https://x.com/kinetiqpump_fun', telegram: '', website: 'https://kinetiqpump.fun',
};
const retry = async (f) => { for (let i = 0; ; i++) { try { return await f(); } catch (e) { const m = (e.shortMessage || '') + (e.message || '') + JSON.stringify(e.info || ''); if (i >= 6 || !/not ready|rate.?limit|429|timeout|ECONNRESET|50[234]|invalid block height/i.test(m)) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } } };

(async () => {
  if (!/^data:image\/(webp|png|jpeg);base64,/.test(META.image)) throw new Error('the picture file must hold a data:image URI');
  const P = new ethers.JsonRpcProvider('https://rpc.elysium.kinetiq.xyz', 99901, { staticNetwork: true, batchMaxCount: 1 });
  const keyFile = process.env.KEYFILE || path.join(__dirname, '.env.deployer.kinetiqpump2');
  const m = fs.readFileSync(keyFile, 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
  if (!m) throw new Error('no PRIVATE_KEY=... in ' + keyFile);
  const w = new ethers.Wallet('0x' + m[2], P), f = new ethers.Contract(dep.contracts.factory, abi, w);
  const K = dep.tokens.kntq, W = dep.tokens.whype, quote = PAIR === 'HYPE' ? W : K;

  if (await retry(() => f.paused())) throw new Error('launches are paused: the owner opens them on the admin page');
  const copy = await retry(() => f.tickerKey(SYMBOL).then((k) => f.tickerTaken(k)));
  const fee = await retry(() => f.launchFee(SYMBOL)), q = await retry(() => f.quotes(quote));
  if (!q.listed) throw new Error(PAIR + ' is not listed as a pair');
  let minQuote = 0n, expect = Number(ethers.formatEther(DEV));
  if (PAIR === 'KNTQ') {
    // KNTQ per HYPE from the pool the route uses, to bound what the dev buy's swap may return
    const pm = new ethers.Contract(dep.contracts.poolManager, ['function extsload(bytes32) view returns (bytes32)'], P), AC = ethers.AbiCoder.defaultAbiCoder(), kp = dep.kntqPool;
    const id = ethers.keccak256(AC.encode(['address', 'address', 'uint24', 'int24', 'address'], [kp.currency0, kp.currency1, kp.fee, kp.tickSpacing, kp.hooks]));
    const sqrtP = BigInt(await retry(() => pm.extsload(ethers.keccak256(AC.encode(['bytes32', 'uint256'], [id, 6]))))) & ((1n << 160n) - 1n);
    expect *= (Number(sqrtP) / 2 ** 96) ** 2;
    minQuote = ethers.parseEther((expect * 0.96).toFixed(6));
  }
  const least = PAIR === 'KNTQ' ? minQuote : DEV;
  console.log(`${SEND ? '' : 'DRY RUN. '}creator ${w.address}, ${ethers.formatEther(await P.getBalance(w.address))} HYPE`);
  console.log(`pair ${PAIR}; fee ${ethers.formatEther(fee)} HYPE${copy ? ' ($' + SYMBOL + ' was launched before, so this includes the copy fee, held by the factory)' : ''}; dev buy ${ethers.formatEther(DEV)} HYPE${PAIR === 'KNTQ' ? ' ~ ' + expect.toFixed(1) + ' KNTQ' : ''} (the pair's minimum is ${ethers.formatEther(q.minDevBuy)} ${PAIR})`);
  if (least < q.minDevBuy) throw new Error('that dev buy is under the minimum for this pair');

  const p = { name: NAME, symbol: SYMBOL, quote, rewards: PAIR === 'HYPE' ? [W, K] : [K, W], devBuy: 0, minCoinsOut: 1 };
  const tx = await f.launchWithEth.populateTransaction(p, META, minQuote, { value: fee + DEV });
  console.log(`transaction data: ${(tx.data.length - 2) / 2} bytes (picture ${META.image.length})`);
  const coin = await retry(() => f.launchWithEth.staticCall(p, META, minQuote, { value: fee + DEV }));
  const gas = await retry(() => f.launchWithEth.estimateGas(p, META, minQuote, { value: fee + DEV }));
  console.log(`simulated: the coin will be ${coin}, about ${gas} gas`);
  if (!SEND) return console.log('Add --send to launch.');

  const sent = await f.launchWithEth(p, META, minQuote, { value: fee + DEV, gasLimit: (gas * 14n) / 10n + 200_000n });
  console.log('sent', sent.hash);
  const rc = await sent.wait();
  if (rc.status !== 1) throw new Error('the launch reverted: ' + sent.hash);
  const ev = rc.logs.filter((l) => l.address.toLowerCase() === dep.contracts.factory.toLowerCase()).map((l) => { try { return f.interface.parseLog(l); } catch (e) { return null; } }).find((x) => x && x.name === 'Launched');
  const addr = ev ? ev.args.coin : coin;
  const bal = await retry(() => new ethers.Contract(addr, ['function balanceOf(address) view returns (uint256)'], P).balanceOf(w.address));
  const out = { chainId: 99901, name: NAME, symbol: SYMBOL, coin: addr, factory: dep.contracts.factory, pair: PAIR, rewards: PAIR === 'HYPE' ? ['HYPE', 'KNTQ'] : ['KNTQ', 'HYPE'], creator: w.address, tx: sent.hash, block: rc.blockNumber, feeHype: ethers.formatEther(fee), copyFeeHeld: copy, devBuyHype: ethers.formatEther(DEV), devCoins: ethers.formatEther(bal), gasUsed: rc.gasUsed.toString() };
  const file = path.join(__dirname, 'deployments', OFFICIAL ? 'kpump-official.json' : 'coin-' + SYMBOL.toLowerCase() + '.json');
  // a record already there is an earlier, withdrawn launch: it is kept under `withdrawn`
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (prev && prev.coin && prev.coin !== addr) { const { withdrawn = [], ...old } = prev; out.withdrawn = [...withdrawn, old]; }
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message, e.info ? JSON.stringify(e.info).slice(0, 300) : ''); process.exit(1); });
