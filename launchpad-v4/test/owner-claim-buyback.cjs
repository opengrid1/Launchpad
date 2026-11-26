// From the protocol owner, on each chain's LIQUIDFI: buyback off (nothing more gets locked), rescue the pool's token
// fees straight to the owner (no conversion, no lock, earmark cleared), claim the owner's HYPE in the fee escrow, then
// buy LIQUIDFI with that HYPE through the UniversalRouter (tokens stay in the wallet).
//   OWNER_KEYFILE=... node owner-claim-buyback.cjs
const fs = require('fs');
const L = require('/home/user/Launchpad/launchpad-v4/site/api/_lib'); const { ethers } = L;
const key = fs.readFileSync(process.env.OWNER_KEYFILE, 'utf8').match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
const w = new ethers.Wallet(key); const OWNER = '0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b';
if (w.address !== OWNER) throw new Error('not the owner key');
const T = { hyperevm: { token: '0x44f2104444606d644c908b42277319ccc44b52cf', router: '0x9aFe3C497e19501DB228F28CdBdD29bC98F65DBa' }, elysium: { token: '0x84c90663db2d1c0898c2a30e63bc6bbb6a969e81', router: '0xA13f7611115752DEB2B13813BDDE16A5073e4b45' } };
const F = new ethers.Interface(['function setBuybackEnabled(address token, bool enabled)', 'function getLaunchedToken(address) view returns (address creator, address creatorFeeRecipient, uint32 launchConfigId, uint16 creatorTaxBps, bool buybackEnabled, uint40 launchedAt, bool exists)']);
const H = new ethers.Interface(['function rescuePoolFees(bytes32 poolId) returns (uint256, uint256)']);
const ES = new ethers.Interface(['function claim() returns (uint256)', 'function balanceOf(address) view returns (uint256)']);
const ERC = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const R = new ethers.Interface(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const QI = new ethers.Interface(['function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)']);
const AC = ethers.AbiCoder.defaultAbiCoder(), f = (v) => Number(ethers.formatEther(v));
(async () => {
  for (const [k, X] of Object.entries(T)) {
    const N = L.netOf(k), tok = ethers.getAddress(X.token), call = async (to, I, fn, args) => I.decodeFunctionResult(fn, await L.rpc(N, 'eth_call', [{ to, data: I.encodeFunctionData(fn, args) }, 'latest']));
    const tx = async (label, t) => { const r = await L.sendTx(N, w, { gasLimit: 400000n, ...t }); console.log(`  ${label.padEnd(22)} status ${r.status} ${r.hash}`); if (r.status !== 1) throw new Error(label + ' failed'); return r; };
    console.log(`== ${k} LIQUIDFI ${tok}`);
    const bal0 = (await call(tok, ERC, 'balanceOf', [OWNER]))[0];
    const s = await (await fetch('https://www.liquidfi.fun/api/state?chain=' + k + '&t=' + Date.now())).json(); const poolId = s.tokens.find((x) => x.addr === X.token).poolId;
    if ((await call(N.factory, F, 'getLaunchedToken', [tok])).buybackEnabled) await tx('buyback off', { to: N.factory, data: F.encodeFunctionData('setBuybackEnabled', [tok, false]) });
    await tx('rescue token fees', { to: N.hook, data: H.encodeFunctionData('rescuePoolFees', [poolId]) }).catch((e) => console.log('  rescue skipped:', e.message));
    const bal1 = (await call(tok, ERC, 'balanceOf', [OWNER]))[0]; console.log(`  fee tokens received     ${f(bal1 - bal0).toLocaleString('en-US', { maximumFractionDigits: 0 })} LIQUIDFI`);
    const esc = (await call(N.escrow, ES, 'balanceOf', [OWNER]))[0];
    if (esc > 0n) {
      await tx('claim escrow', { to: N.escrow, data: ES.encodeFunctionData('claim()', []), gasLimit: 150000n });
      const keyP = [ethers.ZeroAddress, tok, 0, 200, N.hook];
      const q = QI.decodeFunctionResult('quoteExactInputSingle', await L.rpc(N, 'eth_call', [{ to: N.quoter, data: QI.encodeFunctionData('quoteExactInputSingle', [[keyP, true, esc, '0x']]) }, 'latest']))[0];
      const params = [AC.encode(['tuple(tuple(address,address,uint24,int24,address),bool,uint128,uint128,bytes)'], [[keyP, true, esc, (q * 97n) / 100n, '0x']]), AC.encode(['address', 'uint256'], [ethers.ZeroAddress, esc]), AC.encode(['address', 'uint256'], [tok, (q * 97n) / 100n])];
      await tx(`buyback ${f(esc)} HYPE`, { to: X.router, value: esc, gasLimit: 700000n, data: R.encodeFunctionData('execute', ['0x10', [AC.encode(['bytes', 'bytes[]'], ['0x060c0f', params])], BigInt(Math.floor(Date.now() / 1000) + 900)]) });
    }
    const bal2 = (await call(tok, ERC, 'balanceOf', [OWNER]))[0]; console.log(`  owner now holds        ${f(bal2).toLocaleString('en-US', { maximumFractionDigits: 0 })} LIQUIDFI (+${f(bal2 - bal0).toLocaleString('en-US', { maximumFractionDigits: 0 })})`);
  }
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
