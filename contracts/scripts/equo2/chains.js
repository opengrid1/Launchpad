// The Equo chains: Uniswap v4 PoolManager, wrapped native coin, LayerZero endpoint, eid, libraries, executor
// and DVNs between them (LayerZero Labs + Twinstake, formerly Nethermind, both live on every chain here). LayerZero
// sets no default DVNs between Ink and the others, so these pins are what makes those pathways work. Sources: the Equo v1 deployments
// (PoolManager, WETH, endpoint) and LayerZero's metadata API (eids, libraries, executors, DVNs), 2026-10-27.
const CHAINS = [
  { name: "mainnet", chainId: 1, eid: 30101, rpc: "https://ethereum-rpc.publicnode.com",
    poolManager: "0x000000000004444c5dc75cb358380d2e3de08a90", weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    endpoint: "0x1a44076050125825900e736c501f859c50fe728c",
    dvns: ["0x589dedbd617e0cbcb916a9223f4d1300c294236b", "0xa59ba433ac34d2927232918ef5b2eaafcf130ba5"] },
  { name: "bsc", chainId: 56, eid: 30102, rpc: "https://bsc-dataseed.bnbchain.org",
    poolManager: "0x28e2ea090877bf75740558f6bfb36a5ffee9e9df", weth: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
    endpoint: "0x1a44076050125825900e736c501f859c50fe728c",
    dvns: ["0xfd6865c841c2d64565562fcc7e05e619a30615f0", "0x31f748a368a893bdb5abb67ec95f232507601a73"] },
  { name: "arbitrum", chainId: 42161, eid: 30110, rpc: "https://arb1.arbitrum.io/rpc",
    poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32", weth: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    endpoint: "0x1a44076050125825900e736c501f859c50fe728c",
    dvns: ["0x2f55c492897526677c5b68fb199ea31e2c126416", "0xa7b5189bca84cd304d8553977c7c614329750d99"] },
  { name: "base", chainId: 8453, eid: 30184, rpc: "https://mainnet.base.org",
    poolManager: "0x498581ff718922c3f8e6a244956af099b2652b2b", weth: "0x4200000000000000000000000000000000000006",
    endpoint: "0x1a44076050125825900e736c501f859c50fe728c",
    dvns: ["0x9e059a54699a285714207b43b055483e78faac25", "0xcd37ca043f8479064e10635020c65ffc005d36f6"] },
  { name: "unichain", chainId: 130, eid: 30320, rpc: "https://mainnet.unichain.org",
    poolManager: "0x1f98400000000000000000000000000000000004", weth: "0x4200000000000000000000000000000000000006",
    endpoint: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    dvns: ["0x282b3386571f7f794450d5789911a9804fa346b4", "0x25e0e650a78e6304a3983fc4b7ffc6544b1beea6"] },
  { name: "hyperevm", chainId: 999, eid: 30367, rpc: "https://rpc.hyperliquid.xyz/evm",
    poolManager: "0x12d4fd9c5dedd00ab8a0bce2cf0167bbf94b6b1f", weth: "0x5555555555555555555555555555555555555555",
    endpoint: "0x3a73033c0b1407574c76bdbac67f126f6b4a9aa9",
    dvns: ["0xc097ab8cd7b053326dfe9fb3e3a31a0cce3b526f", "0x8e49ef1dfae17e547ca0e7526ffda81fbaca810a"] },
  { name: "monad", chainId: 143, eid: 30390, rpc: "https://rpc.monad.xyz",
    poolManager: "0x188d586ddcf52439676ca21a244753fa19f9ea8e", weth: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
    endpoint: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    dvns: ["0x282b3386571f7f794450d5789911a9804fa346b4", "0xacde1f22eeab249d3ca6ba8805c8fee9f52a16e7"] },
  { name: "megaeth", chainId: 4326, eid: 30398, rpc: "https://mainnet.megaeth.com/rpc",
    poolManager: "0xacb7e78fa05d562e0a5d3089ec896d57d057d38e", weth: "0x4200000000000000000000000000000000000006",
    endpoint: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    dvns: ["0x282b3386571f7f794450d5789911a9804fa346b4", "0xeede111103535e473451311e26c3e6660b0f77e1"] },
  // Ink: Uniswap v4's PoolManager from Uniswap's deployments list (2026-10-28), LayerZero's endpoint and DVNs from
  // its metadata (eid 30339)
  { name: "ink", chainId: 57073, eid: 30339, rpc: "https://rpc-gel.inkonchain.com",
    poolManager: "0x360e68faccca8ca495c1b759fd9eee466db9fb32", weth: "0x4200000000000000000000000000000000000006",
    endpoint: "0xca29f3a6f966cb2fc0de625f8f325c0c46dbe958",
    dvns: ["0x174f2ba26f8adeafa82663bcf908288d5dbca649", "0xdd7b5e1db4aafd5c8ec3b764efb8ed265aa5445b"] },
];
// Toward Solana: LayerZero Labs + Horizen, the two of LayerZero's default verifiers on each EVM <-> Solana pathway
// that also run on Solana (Nethermind does not). From LayerZero's on-chain defaults (lz-solana-defaults.json).
const SOL_DVNS = {
  mainnet: ["0x380275805876Ff19055EA900CDb2B46a94ecF20D", "0x589dEDbD617e0CBcB916A9223F4d1300c294236b"],
  bsc: ["0x247624e2143504730aeC22912ed41F092498bEf2", "0xfD6865c841c2d64565562fCc7e05e619A30615f0"],
  arbitrum: ["0x19670Df5E16bEa2ba9b9e68b48C054C5bAEa06B8", "0x2f55C492897526677C5B68fb199ea31E2c126416"],
  base: ["0x9e059a54699a285714207b43B055483E78FAac25", "0xa7b5189bcA84Cd304D8553977c7C614329750d99"],
  unichain: ["0x282b3386571f7f794450d5789911a9804FA346b4", "0xC6a6324932B399D6A673B7Ed0af671F28033E046"],
  hyperevm: ["0xBB83Ecf372CbB6daa629ea9A9A53BEC6d601F229", "0xc097ab8CD7b053326DFe9fB3E3a31a0CCe3B526f"],
  monad: ["0x282b3386571f7f794450d5789911a9804FA346b4", "0xdCdd4628F858b45260C31D6ad076bD2C3D3c2f73"],
  megaeth: ["0x282b3386571f7f794450d5789911a9804FA346b4", "0x8Ede21203E062D7D1EAeC11c4c72Ad04cDc15658"],
  ink: ["0x174f2ba26f8adeafa82663bcf908288d5dbca649", "0x395b14700812cccc38b8e64f0a06ce2045fe9ba3"],
};
/// Solana as a remote: its eid, and its LayerZero Labs + Horizen DVNs (for the Solana side's own config).
const SOLANA = { name: "solana", eid: 30168, dvns: ["4VDjp6XQaxoZf5RGwiPU9NR1EXSZn2TP4ATMmiSzLfhb", "HR9NQKK1ynW9NzgdM37dU5CBtqRHTukmbMKS7qkwSkHX"] };
const { getAddress } = require("ethers");
for (const c of CHAINS) {
  for (const k of ["poolManager", "weth", "endpoint"]) c[k] = getAddress(c[k]);
  // a ULN config lists its DVNs in ascending order
  c.dvns = c.dvns.map((d) => getAddress(d)).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
  c.solDvns = SOL_DVNS[c.name].map((d) => getAddress(d)).sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : 1));
}
module.exports = { CHAINS, SOLANA };
