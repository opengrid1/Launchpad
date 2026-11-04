// Launches the official BUZZPAD token on Ethereum mainnet from the BuzzPad deployer, creator fees to the protocol
// owner, buyback off (no locked vesting). Logo uploaded through the live site's /api/upload.
//   node test/launch-official-buzzpad.cjs [--send]
const fs = require('fs'), path = require('path');
process.env.ETH_FACTORY = process.env.ETH_FACTORY || '0x341585f9E00bB9fAcf561957075C7e5b7d529134';
const L = require(path.join(__dirname, '../site/api/_lib')); const { ethers, sleep } = L; const NET = L.netOf('ethereum');
const B = 'https://www.buzzpad.fun', OWNER = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
const key = fs.readFileSync('/home/user/Launchpad/contracts/.env.deployer.buzzpad', 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/)[2];
const w = new ethers.Wallet('0x' + key);
const F = new ethers.Interface(['function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt,uint256 openingBuy,uint256 minTokensOut) params, uint256 launchConfigId) payable returns (address)', 'function previewLaunchEconomics(uint256) view returns (bytes32)', 'function launchFee() view returns (uint256)', 'function launchEnabled() view returns (bool)', 'event TokenLaunched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 launchConfigId, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, uint256[] positionIds)']);
(async () => {
  console.log('deployer', w.address, 'ETH', ethers.formatEther(await L.rpc(NET, 'eth_getBalance', [w.address, 'latest'])));
  const [econ, fee, enabled] = await L.multicall(NET, [[NET.factory, F, 'previewLaunchEconomics', [0]], [NET.factory, F, 'launchFee'], [NET.factory, F, 'launchEnabled']]);
  console.log('launchEnabled', enabled, 'fee', ethers.formatEther(fee));
  if (process.argv[2] !== '--send') return console.log('dry: add --send');
  if (!enabled) throw new Error('launches are off');
  const png = fs.readFileSync(path.join(__dirname, '../brands/buzzpad/press/buzzpad-token-512.png'));
  const up = await (await fetch(B + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'data:image/png;base64,' + png.toString('base64') }) })).json();
  if (!up.url) throw new Error('upload ' + JSON.stringify(up)); console.log('logo', up.url);
  const params = { name: 'buzzpad.fun', symbol: 'BUZZPAD', logo: up.url, description: 'The official token of BuzzPad, the meme launchpad on Ethereum. Every coin trades on its own Uniswap v4 pool paired with ETH from the first block.', socials: { twitter: 'https://x.com/buzzpad_fun', telegram: '', discord: '', website: 'https://buzzpad.fun', farcaster: '' }, creatorFeeRecipient: OWNER, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: 0n, minTokensOut: 0n };
  const r = await L.sendTx(NET, w, { to: NET.factory, data: F.encodeFunctionData('launch', [params, 0]), value: fee, gasLimit: 2500000n });
  console.log('launch status', r.status, 'gas', r.gasUsed, 'tx', r.hash);
  if (r.status !== 1) throw new Error('launch failed');
  const rc = await L.rpc(NET, 'eth_getTransactionReceipt', [r.hash]);
  const lg = rc.logs.find((l) => l.address.toLowerCase() === NET.factory.toLowerCase() && l.topics.length === 4); // TokenLaunched(token, creator, poolId)
  const token = ('0x' + lg.topics[1].slice(26)).toLowerCase(); console.log('token', token);
  for (let i = 0; i < 20; i++) { await sleep(3000); const s = await (await fetch(B + '/api/state?chain=ethereum&t=' + Date.now())).json(); const t = (s.tokens || []).find((x) => x.addr === token); if (t) { console.log('indexed', t.name, t.symbol); break; } }
  console.log('page', B + '/token/' + token);
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
