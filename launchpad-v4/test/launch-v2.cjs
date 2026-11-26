// Launches a coin on the BuzzPad v2 factory (Ethereum mainnet) from the BuzzPad deployer, creator fees to the admin
// wallet: node test/launch-v2.cjs <configId 0=ETH 1=AZTEC 2=WXMR> <name> <SYMBOL> <logo.png> "<description>" [--send]
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');
const [cfgId, name, symbol, logoFile, description] = process.argv.slice(2);
const SEND = process.argv.includes('--send');
const dep = require('../deployments/buzzpad-v2-ethereum.json');
const P = new ethers.JsonRpcProvider(process.env.ETH_RPC || 'https://ethereum-rpc.publicnode.com', 1, { staticNetwork: true });
const key = fs.readFileSync(path.join(__dirname, '../../contracts/.env.deployer.buzzpad'), 'utf8').match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
const w = new ethers.Wallet(key, P);
const F = new ethers.Contract(dep.factory, require('../artifacts/BuzzPadFactory.json').abi, w);
(async () => {
  const fee = await F.launchFee(), econ = await F.previewLaunchEconomics(Number(cfgId)), [cfg] = await F.getLaunchConfig(Number(cfgId));
  console.log('deployer', w.address, ethers.formatEther(await P.getBalance(w.address)), 'ETH; config', cfgId, 'pair', cfg.pairToken, 'opens at', ethers.formatEther(cfg.startMcap), 'launchEnabled', await F.launchEnabled());
  if (!SEND) return console.log('dry: add --send');
  const png = fs.readFileSync(logoFile);
  const up = await (await fetch('https://www.buzzpad.fun/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'data:image/png;base64,' + png.toString('base64') }) })).json();
  if (!up.url) throw new Error('upload ' + JSON.stringify(up)); console.log('logo', up.url);
  const params = { name, symbol, logo: up.url, description: description || '', socials: { twitter: 'https://x.com/buzzpad_fun', telegram: '', discord: '', website: 'https://buzzpad.fun', farcaster: '' }, creatorFeeRecipient: dep.owner, creatorTaxBps: 0, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
  const tx = await F.launch(params, Number(cfgId), { value: fee, gasLimit: 2_500_000n });
  const r = await tx.wait(); console.log('tx', tx.hash, 'status', r.status, 'gas', r.gasUsed);
  const ev = r.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
  console.log('token', ev.args.token, 'poolId', ev.args.poolId, 'pair', ev.args.pairToken);
})().catch((e) => { console.error('FAILED', e.shortMessage || e.message); process.exit(1); });
