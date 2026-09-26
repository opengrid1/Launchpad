const fs = require("fs"), path = require("path");
// Tokenized stocks bridgeable to HyperEVM, priced at real Aug-2026 underlying
// USD (8 decimals). dStock + xStock lines. Excludes DIME (ambiguous underlying)
// and BNB1 (crypto, not a stock).
const usd8 = (p) => String(Math.round(p * 1e8));
const stocks = [
  ["QQQ",   "0x499e347174f237ad28687b947b94c0d49570d1b7", 795.26],
  ["GLD",   "0x08be08c37d93e689518ced744a89f113b4afaad4", 463.73],
  ["HOOD",  "0xc304a9d52cf9165024ebc7814250ef3a5013f924", 81.36],
  ["MU",    "0x173c83a71c1a9e254721a86b7512cd65bf92648d", 918.50],
  ["SPY",   "0xb7bf37783db41a2851b77c6917280c56312c833a", 769.35],
  ["META",  "0x5a9d2deee7d8782011695623f1c453f46b2b566e", 578.85],
  ["CRCL",  "0xe74aa6c4050a15790525eb11cc4562c664dc67c9", 95.30],
  ["TSLA",  "0x3727c797073840936e3c18b4088f3574cd1a72a3", 327.51],
  ["SLV",   "0x7ef4eba0c0200957e357627ced1884d6cb63e961", 62.31],
  ["GOOGL", "0x35eeda03e55ff217a013892e9e2e37e792b264ea", 342.37],
  ["AAPL",  "0x7374dc1894fbd1bc6c42f6ebbc50b78c211a8606", 302.25],
  ["AMZN",  "0x4f2164c12d2d450a8b1d430492ef6670fe4cad8e", 267.28],
  ["MSFT",  "0x66520d8fd614487214a25af7babf27584f59f76b", 492.43],
  ["ORCL",  "0xca2156522638f597ffb3705857ffdc356efabe50", 151.94],
  ["AVGO",  "0xc2785563af80c05177fff006e3b380ac5d172602", 372.64],
  ["SPCX",  "0xe8c8afdf7e80be51e91afa28b6ac44404d270b5d", 140.87],
  ["NVDAX", "0xa8ddb5cd96b5222afe198316e9a57caa642850d5", 224.09],
  ["SPYX",  "0xe7e553cd128f0011777323a0b44a7b96ea1cb540", 769.35],
  ["QQQX",  "0x4c1ae29c159838fc1b224636e28e086eb69101f7", 795.26],
  ["SKHYX", "0x6215a58ed045d71f2561aaabe54f4c885c522998", 161.61],
  ["MUX",   "0xe2047ee3bddb5c99ae428ab83df63f8730698e30", 918.50],
];
const qa = stocks.map(([t,a,p]) => `${a}:${usd8(p)}`).join(",");
const env = [
  `export QUOTE_ASSETS='${qa}'`,
  `export HYPE_USD8=8200000000`,
  `export FEE_RECIPIENT=0x77002c2e21575f0450d28c2e71c0707ba0f5995a`,
  `export FINAL_OWNER=0x77002c2e21575f0450d28c2e71c0707ba0f5995a`,
  `export POOL_FEE_TIER=10000`,
  ``,
].join("\n");
fs.writeFileSync(path.join(__dirname, "meow-quotes.env"), env);
console.log(`${stocks.length} stocks + WHYPE. wrote scripts/meow-quotes.env`);
stocks.forEach(([t,a,p]) => console.log(`  ${t.padEnd(6)} $${p}  ${a}`));
// also stash a tickered map for the frontend stocks.ts later
fs.writeFileSync(path.join(__dirname, "..", "deployments", "meow-stock-prices.json"),
  JSON.stringify({ hypeUsd8: "8200000000", stocks: stocks.map(([ticker,address,priceUsd])=>({ticker,address,priceUsd,usd8:usd8(priceUsd)})) }, null, 2));
