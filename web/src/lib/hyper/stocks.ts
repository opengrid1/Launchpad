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

export const HYPER_STOCKS: HyperStock[] = [
  { symbol: 'wNVDAx', ticker: 'NVDAX', name: 'NVIDIA xStock', address: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', decimals: 18 },
  { symbol: 'wSPYx', ticker: 'SPYX', name: 'SP500 xStock', address: '0xe7e553cd128f0011777323a0b44a7b96ea1cb540', decimals: 18 },
  { symbol: 'wQQQx', ticker: 'QQQX', name: 'Nasdaq xStock', address: '0x4c1ae29c159838fc1b224636e28e086eb69101f7', decimals: 18 },
  { symbol: 'wMUx', ticker: 'MUX', name: 'Micron Technology xStock', address: '0xe2047ee3bddb5c99ae428ab83df63f8730698e30', decimals: 18 },
  { symbol: 'wSKHYx', ticker: 'SKHYX', name: 'SK hynix xStock', address: '0x6215a58ed045d71f2561aaabe54f4c885c522998', decimals: 18 },
  // Pre-IPO dStock: live Core spot market (buy with USDC, transfer to EVM).
  { symbol: 'SPCXd', ticker: 'SPCX', name: 'SpaceX dStock', address: '0xe8c8AFDf7E80bE51E91AFA28B6aC44404d270B5d', decimals: 18 },
];

export const hyperStockByAddress = (addr?: string): HyperStock | undefined =>
  addr ? HYPER_STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;
