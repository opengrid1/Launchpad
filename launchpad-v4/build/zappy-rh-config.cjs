// Writes the Robinhood Chain entry into brands/<brand>/config.js from a deployment record (deploy-v2.cjs with
// LEVERAGE=1 and STOCKS=...): the v2 contracts, the margin contract, and the ETH pair plus every stock pair with its
// launch config. With "none" for the record it writes the entry without contract addresses (a preview), the stock
// pairs numbered in brands/zappy/stocks.json order as deploy-v2.cjs numbers them.
//   node build/zappy-rh-config.cjs deployments/zappy-v2-robinhood.json [brand]
const fs = require('fs'), path = require('path');
const S = require('../brands/zappy/stocks.json');
const arg = process.argv[2] || 'none', brand = process.argv[3] || 'zappy';
const dep = arg === 'none' ? { poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951', positionManager: '0x58daec3116aae6D93017bAAea7749052E8a04fA7', factory: '', hook: '', locker: '', leverage: { margin: '' }, stockPairs: S.stocks.map((st, i) => ({ key: st.key, sym: st.sym, name: st.name, addr: st.addr, cfg: i + 1, open: (1.75 * S.ethUsd) / st.usd })) } : JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
const file = path.join(__dirname, '../brands/' + brand + '/config.js');
const pairs = [{ key: 'eth', sym: 'ETH', name: 'Ether', addr: '0x0000000000000000000000000000000000000000', cfg: 0, open: 1.75, logo: '/img/eth.svg' },
  ...(dep.stockPairs || []).map((p) => ({ key: p.key, sym: p.sym, name: p.name, addr: p.addr, cfg: p.cfg, open: +p.open.toFixed(4), logo: '/img/stock.svg' }))];
const entry = `    // Robinhood Chain: Uniswap's v4 deployment (its UniversalRouter takes the newer swap params: hopLayout), the v2
    // contracts with leverage funded by each coin's pool, and Robinhood stock pairs (${dep.stockPairs ? dep.stockPairs.length : 0}): ${path.basename(process.argv[2] || '')}
    { key: 'robinhood', evm: true, id: 4663, hex: '0x1237', name: 'Robinhood Chain', short: 'Robinhood', quote: 'ETH', quoteName: 'Ether', usd: ${Math.round(S.ethUsd)}, rpc: 'https://rpc.mainnet.chain.robinhood.com', explorer: 'https://robinhoodchain.blockscout.com', logo: '/img/eth.svg', color: '#13307a', blockSec: 1, main: true,
      contracts: { factory: '', hook: '', locker: '', escrow: '', vault: '', poolManager: '${dep.poolManager}', positionManager: '${dep.positionManager}', multicall: '0xcA11bde05977b3631167028862bE2a173976CA11', router: '0x8876789976decbfcbbbe364623c63652db8c0904', quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' },
      v2: { factory: '${dep.factory}', hook: '${dep.hook}', locker: '${dep.locker}', margin: '${(dep.leverage || {}).margin || ''}', swapper: '${(dep.leverage || {}).swapper || ''}', hopLayout: true,
        pairs: ${JSON.stringify(pairs)} } },`;
let s = fs.readFileSync(file, 'utf8');
const a = s.indexOf('  chains: ['), b = s.indexOf('\n  ],', a);
s = s.slice(0, a) + '  chains: [\n' + entry + s.slice(b);
fs.writeFileSync(file, s);
console.log(path.relative(process.cwd(), file) + ': Robinhood Chain with', pairs.length, 'pairs, margin', (dep.leverage || {}).margin);
