// Launches the official LEVERHOOK token on Robinhood Chain from the LeverHook deployer on the v2 factory (ETH pair, config 0), creator
// fees to the admin wallet, no tax, no opening buy. Logo uploaded through the live site's /api/upload.
//   node test/launch-official-leverhook.cjs [--send]
const fs = require('fs'), path = require('path');
const { ethers } = require('ethers');
const SEND = process.argv.includes('--send');
const dep = require('../deployments/leverhook-v2-robinhood.json');
const SITE = 'https://www.leverhook.fun';
const P = new ethers.JsonRpcProvider(process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com', 4663, { staticNetwork: true });
const key = fs.readFileSync(path.join(__dirname, '../../contracts/.env.deployer.leverhook'), 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/)[2];
const w = new ethers.Wallet('0x' + key, P);
const F = new ethers.Contract(dep.factory, require('../artifacts/BuzzPadFactory.json').abi, w);
(async () => {
  const fee = await F.launchFee(), econ = await F.previewLaunchEconomics(0), enabled = await F.launchEnabled();
  console.log('deployer', w.address, ethers.formatEther(await P.getBalance(w.address)), 'ETH; launchEnabled', enabled, 'fee', ethers.formatEther(fee));
  if (!SEND) return console.log('dry: add --send');
  if (!enabled) throw new Error('launches are off');
  const png = fs.readFileSync(path.join(__dirname, '../brands/leverhook/press/leverhook-pfp-k2.png'));
  const up = await (await fetch(SITE + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'data:image/png;base64,' + png.toString('base64') }) })).json();
  if (!up.url) throw new Error('upload ' + JSON.stringify(up)); console.log('logo', up.url);
  const params = { name: 'leverhook.fun', symbol: 'LEVERHOOK', logo: up.url, description: 'The official token of LeverHook, the launchpad on Robinhood Chain. Launch a coin paired with ETH or a stock, then long it up to 3x, funded by each coin\'s own pool.', socials: { twitter: 'https://x.com/leverhook_fun', telegram: '', discord: '', website: 'https://leverhook.fun', farcaster: '' }, creatorFeeRecipient: dep.owner, creatorTaxBps: 0, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
  const tx = await F.launch(params, 0, { value: fee, gasLimit: 2_500_000n });
  const r = await tx.wait(); console.log('tx', tx.hash, 'status', r.status, 'gas', r.gasUsed);
  if (r.status !== 1) throw new Error('launch failed');
  const ev = r.logs.map((l) => { try { return F.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
  const token = ev.args.token.toLowerCase(); console.log('token', token, 'poolId', ev.args.poolId);
  for (let i = 0; i < 30; i++) { await new Promise((s) => setTimeout(s, 3000)); const s = await (await fetch(SITE + '/api/state?chain=robinhood&t=' + Date.now())).json(); const t = (s.tokens || []).find((x) => x.addr === token); if (t) { console.log('indexed', t.name, t.symbol); break; } }
  console.log('page', SITE + '/token/' + token);
})().catch((e) => { console.error('FAILED', e.shortMessage || e.message); process.exit(1); });
