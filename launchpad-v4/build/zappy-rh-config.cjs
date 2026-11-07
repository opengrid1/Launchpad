// Writes the Robinhood Chain entry into brands/zappy/config.js from a deployment record (deploy-v2.cjs with LEVERAGE=1
// and STOCKS=...): the v2 contracts, the margin contract, and the ETH pair plus every stock pair with its launch config.
//   node build/zappy-rh-config.cjs deployments/zappy-v2-robinhood.json
const fs = require('fs'), path = require('path');
const dep = JSON.parse(fs.readFileSync(path.resolve(process.argv[2] || 'deployments/zappy-v2-robinhood.json'), 'utf8'));
const S = require('../brands/zappy/stocks.json');
const file = path.join(__dirname, '../brands/zappy/config.js');
const pairs = [{ key: 'eth', sym: 'ETH', name: 'Ether', addr: '0x0000000000000000000000000000000000000000', cfg: 0, open: 1.75, logo: '/img/eth.svg' },
  ...(dep.stockPairs || []).map((p) => ({ key: p.key, sym: p.sym, name: p.name, addr: p.addr, cfg: p.cfg, open: +p.open.toFixed(4), logo: '/img/stock.svg' }))];
const entry = `    // Robinhood Chain: Uniswap's v4 deployment (its UniversalRouter takes the newer swap params: hopLayout), the v2
    // contracts with leverage funded by each coin's pool, and Robinhood stock pairs (${dep.stockPairs ? dep.stockPairs.length : 0}): ${path.basename(process.argv[2] || '')}
    { key: 'robinhood', evm: true, id: 4663, hex: '0x1237', name: 'Robinhood Chain', short: 'Robinhood', quote: 'ETH', quoteName: 'Ether', usd: ${Math.round(S.ethUsd)}, rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com', logo: '/img/eth.svg', color: '#13307a', blockSec: 1, main: true,
      contracts: { factory: '', hook: '', locker: '', escrow: '', vault: '', poolManager: '${dep.poolManager}', positionManager: '${dep.positionManager}', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0x8876789976decbfcbbbe364623c63652db8c0904', quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' },
      v2: { factory: '${dep.factory}', hook: '${dep.hook}', locker: '${dep.locker}', margin: '${(dep.leverage || {}).margin || ''}', hopLayout: true,
        pairs: ${JSON.stringify(pairs)} } },`;
let s = fs.readFileSync(file, 'utf8');
const a = s.indexOf('  chains: ['), b = s.indexOf('\n  ],', a);
s = s.slice(0, a) + '  chains: [\n' + entry + s.slice(b);
fs.writeFileSync(file, s);
console.log('brands/zappy/config.js: Robinhood Chain with', pairs.length, 'pairs, margin', (dep.leverage || {}).margin);
