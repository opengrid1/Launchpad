// Launches the official LIQUIDFI token from the deployer, creator fees to the protocol owner, through the HyperEVM inbox.
const fs = require('fs');
const SITE = '/home/user/Launchpad/launchpad-v4/site';
const L = require(SITE + '/api/_lib'); const { ethers, sleep } = L; const NET = L.netOf(process.argv[3] || 'hyperevm');
const rpc = (m, p) => L.rpc(NET, m, p), multicall = (c) => L.multicall(NET, c), sendViaInbox = (w, t) => L.sendTx(NET, w, t);
const B = 'https://www.liquidfi.fun', OWNER = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const key = fs.readFileSync('/home/user/Launchpad/contracts/.env.deployer.v3', 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/)[2];
const w = new ethers.Wallet('0x' + key);
const F = new ethers.Interface(['function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt,uint256 openingBuy,uint256 minTokensOut) params, uint256 launchConfigId) payable returns (address)', 'function previewLaunchEconomics(uint256) view returns (bytes32)', 'function launchFee() view returns (uint256)', 'function launchEnabled() view returns (bool)', 'event TokenLaunched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 launchConfigId, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, uint256[3] positionIds)']);
(async () => {
  console.log('deployer HYPE on ' + NET.name, ethers.formatEther(await rpc('eth_getBalance', [w.address, 'latest'])));
  if (process.argv[2] !== '--send') return console.log('dry: add --send');
  const png = fs.readFileSync(SITE + '/img/token-512.png');
  const up = await (await fetch(B + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'data:image/png;base64,' + png.toString('base64') }) })).json();
  if (!up.url) throw new Error('upload ' + JSON.stringify(up)); console.log('logo', up.url);
  const [econ, fee, enabled] = await multicall([[NET.factory, F, 'previewLaunchEconomics', [0]], [NET.factory, F, 'launchFee'], [NET.factory, F, 'launchEnabled']]);
  if (!enabled) throw new Error('launches are off');
  const params = { name: 'liquidfi.fun', symbol: 'LIQUIDFI', logo: up.url, description: 'The official token of LiquidFi, the token launchpad on HyperEVM and Elysium. Every coin trades on a Uniswap v4 pool paired with HYPE from the first block.', socials: { twitter: 'https://x.com/liquidfi_fun', telegram: '', discord: '', website: 'https://liquidfi.fun', farcaster: '' }, creatorFeeRecipient: OWNER, creatorTaxBps: 0, buybackEnabled: true, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
  const r = await sendViaInbox(w, { to: NET.factory, data: F.encodeFunctionData('launch', [params, 0]), value: fee, gasLimit: 2500000n });
  console.log('launch status', r.status, 'gas', r.gasUsed, 'tx', r.hash);
  if (r.status !== 1) throw new Error('launch failed');
  const rc = await rpc('eth_getTransactionReceipt', [r.hash]);
  const ev = rc.logs.map((l) => { try { return F.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
  const token = ev.args.token.toLowerCase(); console.log('token', token, 'creator', ev.args.creator, 'fee recipient', ev.args.creatorFeeRecipient, 'positions', ev.args.positionIds.map(String).join(','), 'buyback', ev.args.buybackEnabled);
  for (let i = 0; i < 1; i++) { await sleep(1000); const s = await (await fetch(B + '/api/state?chain=' + NET.key + '&t=' + Date.now())).json(); const t = (s.tokens || []).find((x) => x.addr === token); if (t) { console.log('site shows', t.name, t.symbol, 'mcap', (1 / (Number(t.sqrtP) / 2 ** 96) ** 2 * 1e9).toFixed(2), 'HYPE'); break; } }
  console.log('page', B + '/token/' + token);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
