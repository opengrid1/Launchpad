// Mainnet test of LiquidFi on Elysium from the deployer: logo upload through the live /api/upload, factory.launch with a
// small opening buy, then a buy and a sell through Uniswap's UniversalRouter, the same calls chain.js makes. Every
// transaction is signed here and posted to Elysium's HyperEVM inbox (the public RPC relay times out wallets).
const fs = require('fs');
const SITE = '/home/user/Launchpad/launchpad-v4/site';
const { ethers, NET, rpc, multicall, sendViaInbox, sleep } = require(SITE + '/api/_lib');
const B = 'https://godmode-pad.vercel.app';
const key = fs.readFileSync('/home/user/Launchpad/contracts/.env.deployer.v3', 'utf8').match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/)[2];
const w = new ethers.Wallet('0x' + key); const me = w.address;
const UR = '0xA13f7611115752DEB2B13813BDDE16A5073e4b45', PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3', QUOTER = '0x379F556c5a748BD7Cc9baF0F7A344094Ac1814f5';
const F = new ethers.Interface(['function launch((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt,uint256 openingBuy,uint256 minTokensOut) params, uint256 launchConfigId) payable returns (address)', 'function previewLaunchEconomics(uint256) view returns (bytes32)', 'function launchFee() view returns (uint256)', 'function launchEnabled() view returns (bool)', 'event TokenLaunched(address indexed token, address indexed creator, bytes32 indexed poolId, uint256 launchConfigId, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, uint256[3] positionIds)']);
const ERC = new ethers.Interface(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
const P2 = new ethers.Interface(['function approve(address token, address spender, uint160 amount, uint48 expiration)']);
const R = new ethers.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const QI = new ethers.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)']);
const AC = ethers.AbiCoder.defaultAbiCoder();
const keyOf = (t) => [ethers.ZeroAddress, ethers.getAddress(t), 0, 200, NET.hook];
const quote = async (t, buy, amt) => QI.decodeFunctionResult('quoteExactInputSingle', await rpc('eth_call', [{ to: QUOTER, data: QI.encodeFunctionData('quoteExactInputSingle', [[keyOf(t), buy, amt, '0x']]) }, 'latest']))[0];
const swap = (t, buy, amountIn, minOut) => R.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], ['0x060c0f', [AC.encode(['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'], [[keyOf(t), buy, amountIn, minOut, '0x']]), AC.encode(['address', 'uint256'], [buy ? ethers.ZeroAddress : t, amountIn]), AC.encode(['address', 'uint256'], [buy ? t : ethers.ZeroAddress, minOut])]])], BigInt(Math.floor(Date.now() / 1000) + 900)]);
const bal = async (t) => BigInt(await rpc('eth_call', [{ to: t, data: ERC.encodeFunctionData('balanceOf', [me]) }, 'latest']));
const hype = async () => Number(ethers.formatEther(await rpc('eth_getBalance', [me, 'latest'])));
async function tx(label, t) { const r = await sendViaInbox(w, t); console.log(`${label.padEnd(18)} status ${r.status} gas ${r.gasUsed ?? '-'} ${r.hash}`); if (r.status !== 1) throw new Error(label + ' failed'); return r; }

(async () => {
  console.log('deployer', me, 'HYPE', await hype());
  // 1. logo through the live upload API
  const png = fs.readFileSync(SITE + '/img/token-512.png');
  const up = await (await fetch(B + '/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'data:image/png;base64,' + png.toString('base64') }) })).json();
  if (!up.url) throw new Error('upload ' + JSON.stringify(up)); console.log('logo', up.url);
  // 2. launch: 0.005 HYPE fee + 0.02 HYPE opening buy
  const [econ, fee, enabled] = await multicall([[NET.factory, F, 'previewLaunchEconomics', [0]], [NET.factory, F, 'launchFee'], [NET.factory, F, 'launchEnabled']]);
  console.log('launchEnabled', enabled, 'fee', ethers.formatEther(fee));
  const opening = ethers.parseEther('0.02');
  const params = { name: 'LiquidFi Test', symbol: 'LQTEST', logo: up.url, description: 'Test launch of LiquidFi on Elysium.', socials: { twitter: '', telegram: '', discord: '', website: '', farcaster: '' }, creatorFeeRecipient: ethers.ZeroAddress, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: econ, salt: ethers.hexlify(ethers.randomBytes(32)), openingBuy: opening, minTokensOut: 1n };
  const L = await tx('launch', { to: NET.factory, data: F.encodeFunctionData('launch', [params, 0]), value: fee + opening, gasLimit: 3500000n });
  const rc = await rpc('eth_getTransactionReceipt', [L.hash]);
  const ev = rc.logs.map((l) => { try { return F.parseLog(l); } catch { return null; } }).find((x) => x && x.name === 'TokenLaunched');
  const token = ev.args.token; console.log('token', token, 'pool', ev.args.poolId, 'positions', ev.args.positionIds.map(String).join(','));
  const b0 = await bal(token); console.log('opening buy tokens', ethers.formatEther(b0));
  // 3. buy 0.01 HYPE after the snipe window
  await sleep(15000);
  const inB = ethers.parseEther('0.01'), qB = await quote(token, true, inB); console.log('quote buy 0.01 HYPE ->', ethers.formatEther(qB));
  await tx('buy', { to: UR, data: swap(token, true, inB, (qB * 97n) / 100n), value: inB, gasLimit: 700000n });
  const b1 = await bal(token); console.log('bought', ethers.formatEther(b1 - b0), `(${(Number(b1 - b0) / Number(qB) * 100 - 100).toFixed(4)}% vs quote)`);
  // 4. sell half of everything: token -> Permit2 approval, Permit2 -> router allowance, swap
  const amt = b1 / 2n, h0 = await hype();
  await tx('approve permit2', { to: token, data: ERC.encodeFunctionData('approve', [PERMIT2, ethers.MaxUint256]), gasLimit: 120000n });
  await tx('permit2 allow', { to: PERMIT2, data: P2.encodeFunctionData('approve', [token, UR, (1n << 160n) - 1n, BigInt(Math.floor(Date.now() / 1000) + 30 * 86400)]), gasLimit: 120000n });
  const qS = await quote(token, false, amt); console.log('quote sell', ethers.formatEther(amt), 'tokens ->', ethers.formatEther(qS), 'HYPE');
  await tx('sell', { to: UR, data: swap(token, false, amt, (qS * 97n) / 100n), gasLimit: 700000n });
  console.log('HYPE received (net of gas)', (await hype() - h0).toFixed(6), 'tokens left', ethers.formatEther(await bal(token)));
  // 5. the live site's indexer
  for (let i = 0; i < 12; i++) {
    await sleep(5000); const s = await (await fetch(B + '/api/state?t=' + Date.now())).json(); const t = (s.tokens || []).find((x) => x.addr === token.toLowerCase());
    const trs = (s.trades || []).filter((x) => x.t === token.toLowerCase());
    if (t && trs.length >= 3) { console.log('site:', t.name, t.symbol, 'logo', t.logo, 'holders', t.holderCount, 'trades', trs.map((x) => (x.b ? 'buy ' : 'sell ') + x.h.toFixed(4) + ' HYPE ' + Math.round(x.k) + ' tok').join(' | ')); console.log('page', B + '/token/' + token.toLowerCase()); return; }
  }
  console.log('site has not indexed all trades yet');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
