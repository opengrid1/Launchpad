// Snapshot of $ANY holders at one block: balances rebuilt from Transfer events since launch,
// each checked with balanceOf at that block. Contracts that only hold liquidity are excluded.
const { ethers } = require('ethers'); const fs = require('fs'); const path = require('path');
const TOKEN = '0x78c171589fD107e95638559fbC0A2a7c8D75f805', FROM = 52213870;
const SYSTEM = { // not holders: liquidity and launchpad contracts
  '0x498581ff718922c3f8e6a244956af099b2652b2b': 'Uniswap V4 PoolManager (both pools\' liquidity)',
  '0x4adca6c4e9aa0dbc8b26da334ea36df3f410c0cc': 'Anypair hook', '0xeb0905ff25886e1c4fc317d505161480ecc2434b': 'Anypair factory',
  '0x456f9a4f5f4dffbaa79878fb9fd095fb48f41960': 'Anypair router', [TOKEN.toLowerCase()]: 'the token itself', '0x0000000000000000000000000000000000000000': 'zero address',
};
(async () => {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org', 8453, { staticNetwork: true, batchMaxCount: 1 });
  const block = Number(process.env.BLOCK || (await p.getBlockNumber()) - 2);
  const topic = ethers.id('Transfer(address,address,uint256)');
  const bal = {}; let n = 0; const add = (a, v) => { a = a.toLowerCase(); bal[a] = (bal[a] || 0n) + v; };
  for (let a = FROM; a <= block; a += 450) {
    const b = Math.min(block, a + 449);
    for (let k = 0; ; k++) { try { const logs = await p.getLogs({ address: TOKEN, topics: [topic], fromBlock: a, toBlock: b });
      for (const l of logs) { const from = '0x' + l.topics[1].slice(26), to = '0x' + l.topics[2].slice(26), v = BigInt(l.data); add(from, -v); add(to, v); n++; } break; }
      catch (e) { if (k > 5) throw e; await new Promise(r => setTimeout(r, 800 * (k + 1))); } }
  }
  const ERC = new ethers.Contract(TOKEN, ['function balanceOf(address) view returns (uint256)', 'function pendingRewards(address) view returns (uint256)', 'function totalSupply() view returns (uint256)'], p);
  const holders = []; let mismatch = 0, checked = 0;
  for (const [a, v] of Object.entries(bal)) {
    if (v <= 0n || SYSTEM[a]) continue;
    let onchain = null; try { onchain = await ERC.balanceOf(a, { blockTag: block }); checked++; if (onchain !== v) mismatch++; } catch {}
    const code = await p.getCode(a); let pend = 0n; try { pend = await ERC.pendingRewards(a); } catch {}
    holders.push({ address: ethers.getAddress(a), balance: v.toString(), balanceWhole: Number(ethers.formatEther(v)), isContract: code !== '0x', pendingEthRewards: ethers.formatEther(pend) });
  }
  holders.sort((x, y) => (BigInt(y.balance) > BigInt(x.balance) ? 1 : -1));
  const total = holders.reduce((s, h) => s + BigInt(h.balance), 0n); const supply = await ERC.totalSupply({ blockTag: block });
  for (const h of holders) h.shareOfHeld = Number((BigInt(h.balance) * 10n ** 12n) / total) / 1e12;
  const excluded = Object.entries(SYSTEM).map(([a, why]) => ({ address: a, why, balance: (bal[a] || 0n).toString() }));
  const out = { token: TOKEN, symbol: 'ANY', block, timestamp: (await p.getBlock(block)).timestamp, transfers: n, totalSupply: supply.toString(),
    heldByHolders: total.toString(), heldByHoldersWhole: Number(ethers.formatEther(total)), holders, excluded, checkedOnChain: checked, mismatches: mismatch };
  const f = path.join(__dirname, '..', 'deployments', `any-snapshot-${block}.json`); fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log('block', block, new Date(out.timestamp * 1000).toISOString(), '| transfers', n, '| holders', holders.length, '| held', out.heldByHoldersWhole.toLocaleString(), 'ANY | checked', checked, 'mismatches', mismatch, '\n->', f);
  for (const h of holders.slice(0, 15)) console.log(h.address, h.balanceWhole.toLocaleString().padStart(14), (h.shareOfHeld * 100).toFixed(2) + '%', h.isContract ? 'contract' : '', 'pending ETH', h.pendingEthRewards);
  for (const e of excluded) if (e.balance !== '0') console.log('excluded', e.address, e.why, Number(ethers.formatEther(BigInt(e.balance))).toLocaleString());
})().catch(e => { console.error(e); process.exit(1); });
