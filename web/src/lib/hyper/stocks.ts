import { ROBINHOOD_STOCKS } from "./robinhoodStocks";

// Tokenized stock ERC20s live on HyperEVM (Backed xStocks, wrapped), verified
// on-chain (code + symbol + decimals) and tradable end to end: each has a live
// Hyperliquid Core spot market (buy with USDC, transfer to EVM) plus a real
// EVM supply. Any can be chosen as a coin pair on hyperstock; the creator
// earns the 1% pool fee in that stock.
export interface HyperStock {
  symbol: string;   // on-chain symbol, e.g. "NVDAon"
  ticker: string;   // underlying ticker for display, e.g. "NVDA"
  name: string;
  address: `0x${string}`;
  decimals: number;
}

export const WHYPE: `0x${string}` = "0x5555555555555555555555555555555555555555";

// Every stock registered as a quote on the meowstock factory. Two issuer lines
// bridge to HyperEVM and back a live Hyperliquid Core spot market (buy with
// USDC, transfer to EVM): dStock (…d) and Backed xStock (w…x). Prices are the
// real underlying equity, sized on the factory at deploy time.
export const HYPER_STOCKS: HyperStock[] = [
  // dStock line
  { symbol: 'QQQd', ticker: 'QQQ', name: 'Invesco QQQ', address: '0x499e347174f237ad28687b947b94c0d49570d1b7', decimals: 18 },
  { symbol: 'GLDd', ticker: 'GLD', name: 'SPDR Gold Shares', address: '0x08be08c37d93e689518ced744a89f113b4afaad4', decimals: 18 },
  { symbol: 'HOODd', ticker: 'HOOD', name: 'Robinhood Markets', address: '0xc304a9d52cf9165024ebc7814250ef3a5013f924', decimals: 18 },
  { symbol: 'SPYd', ticker: 'SPY', name: 'SPDR S&P 500 ETF', address: '0xb7bf37783db41a2851b77c6917280c56312c833a', decimals: 18 },
  { symbol: 'MUd', ticker: 'MU', name: 'Micron Technology', address: '0x173c83a71c1a9e254721a86b7512cd65bf92648d', decimals: 18 },
  { symbol: 'METAd', ticker: 'META', name: 'Meta Platforms', address: '0x5a9d2deee7d8782011695623f1c453f46b2b566e', decimals: 18 },
  { symbol: 'AAPLd', ticker: 'AAPL', name: 'Apple', address: '0x7374dc1894fbd1bc6c42f6ebbc50b78c211a8606', decimals: 18 },
  { symbol: 'MSFTd', ticker: 'MSFT', name: 'Microsoft', address: '0x66520d8fd614487214a25af7babf27584f59f76b', decimals: 18 },
  { symbol: 'GOOGLd', ticker: 'GOOGL', name: 'Alphabet', address: '0x35eeda03e55ff217a013892e9e2e37e792b264ea', decimals: 18 },
  { symbol: 'AMZNd', ticker: 'AMZN', name: 'Amazon', address: '0x4f2164c12d2d450a8b1d430492ef6670fe4cad8e', decimals: 18 },
  { symbol: 'TSLAd', ticker: 'TSLA', name: 'Tesla', address: '0x3727c797073840936e3c18b4088f3574cd1a72a3', decimals: 18 },
  { symbol: 'AVGOd', ticker: 'AVGO', name: 'Broadcom', address: '0xc2785563af80c05177fff006e3b380ac5d172602', decimals: 18 },
  { symbol: 'ORCLd', ticker: 'ORCL', name: 'Oracle', address: '0xca2156522638f597ffb3705857ffdc356efabe50', decimals: 18 },
  { symbol: 'CRCLd', ticker: 'CRCL', name: 'Circle', address: '0xe74aa6c4050a15790525eb11cc4562c664dc67c9', decimals: 18 },
  { symbol: 'SLVd', ticker: 'SLV', name: 'iShares Silver Trust', address: '0x7ef4eba0c0200957e357627ced1884d6cb63e961', decimals: 18 },
  { symbol: 'SPCXd', ticker: 'SPCX', name: 'SpaceX', address: '0xe8c8AFDf7E80bE51E91AFA28B6aC44404d270B5d', decimals: 18 },
  // Backed xStock line
  { symbol: 'wNVDAx', ticker: 'NVDAX', name: 'NVIDIA xStock', address: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', decimals: 18 },
  { symbol: 'wSPYx', ticker: 'SPYX', name: 'SP500 xStock', address: '0xe7e553cd128f0011777323a0b44a7b96ea1cb540', decimals: 18 },
  { symbol: 'wQQQx', ticker: 'QQQX', name: 'Nasdaq xStock', address: '0x4c1ae29c159838fc1b224636e28e086eb69101f7', decimals: 18 },
  { symbol: 'wMUx', ticker: 'MUX', name: 'Micron xStock', address: '0xe2047ee3bddb5c99ae428ab83df63f8730698e30', decimals: 18 },
  { symbol: 'wSKHYx', ticker: 'SKHYX', name: 'SK hynix xStock', address: '0x6215a58ed045d71f2561aaabe54f4c885c522998', decimals: 18 },
];

export const hyperStockByAddress = (addr?: string): HyperStock | undefined =>
  addr ? HYPER_STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;

// Wrapped Backed xStocks live on Ink (chain 57073), verified on-chain: code +
// symbol + free transfer, and a live canonical Uniswap V3 pool (USDG 0.05%,
// wNVDAx also WETH 1%) so fees earned in them always have an exit. Backed
// deploys deterministically, so several addresses match HyperEVM's.
// The natively issued xStocks (NVDAx, SPYx, ...) exist on Ink too but have no
// DEX liquidity there, so they are deliberately not offered as pairs.
export const INK_STOCKS: HyperStock[] = [
  { symbol: 'wNVDAx', ticker: 'NVDAX', name: 'NVIDIA xStock', address: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', decimals: 18 },
  { symbol: 'wSPYx', ticker: 'SPYX', name: 'SP500 xStock', address: '0xe7e553cd128f0011777323a0b44a7b96ea1cb540', decimals: 18 },
  { symbol: 'wAAPLx', ticker: 'AAPLX', name: 'Apple xStock', address: '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f', decimals: 18 },
  { symbol: 'wTSLAx', ticker: 'TSLAX', name: 'Tesla xStock', address: '0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171', decimals: 18 },
  { symbol: 'wMSTRx', ticker: 'MSTRX', name: 'MicroStrategy xStock', address: '0x30987adf0b11dc698438a99ba04ec3a1ab2c7eab', decimals: 18 },
  { symbol: 'wNFLXx', ticker: 'NFLXX', name: 'Netflix xStock', address: '0x7d87fd6a379714194a797c0bbb8b40c30d250856', decimals: 18 },
  { symbol: 'wPLTRx', ticker: 'PLTRX', name: 'Palantir xStock', address: '0x4a2df09536f62341c9f946427d16414c04e21342', decimals: 18 },
];

// Flavor-aware roster: squidpad (ink) offers the Ink list, robinhood the full
// Robinhood Chain roster, hyperstock/meowstock the HyperEVM list.
const FLAVOR = String(import.meta.env.VITE_BRAND ?? "");
export const STOCKS: HyperStock[] =
  FLAVOR === "ink"
    ? INK_STOCKS
    : FLAVOR === "robinhood"
      ? ROBINHOOD_STOCKS
      : HYPER_STOCKS;
export const stockByAddress = (addr?: string): HyperStock | undefined =>
  addr ? STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;
