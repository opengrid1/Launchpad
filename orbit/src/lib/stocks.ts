import { ROBINHOOD_STOCKS } from "./robinhoodStocks";

// Tokenized stocks on HyperEVM that HyperAuction accepts as a coin's pair
// asset. Every one is approved on the v2 factory (owner-priced in USD) and
// verified on-chain (code + symbol + decimals). Liquidity, where it exists,
// is on Hyperliquid Core spot: buy there, transfer to EVM, pair or trade.
export interface HyperStock {
  symbol: string;   // on-chain symbol, e.g. "QQQd"
  ticker: string;   // underlying ticker for display, e.g. "QQQ"
  name: string;
  address: `0x${string}`;
  decimals: number;
  issuer?: string;
}

export const WHYPE: `0x${string}` = "0x5555555555555555555555555555555555555555";

export const HYPER_STOCKS: HyperStock[] = [
  { symbol: "QQQd", ticker: "QQQ", name: "Invesco QQQ", issuer: "dStock", address: "0x499e347174f237ad28687b947b94c0d49570d1b7", decimals: 18 },
  { symbol: "GLDd", ticker: "GLD", name: "SPDR Gold Shares", issuer: "dStock", address: "0x08be08c37d93e689518ced744a89f113b4afaad4", decimals: 18 },
  { symbol: "HOODd", ticker: "HOOD", name: "Robinhood Markets", issuer: "dStock", address: "0xc304a9d52cf9165024ebc7814250ef3a5013f924", decimals: 18 },
  { symbol: "SPCXd", ticker: "SPCX", name: "SpaceX", issuer: "dStock", address: "0xe8c8afdf7e80be51e91afa28b6ac44404d270b5d", decimals: 18 },
  { symbol: "MUd", ticker: "MU", name: "Micron Technology", issuer: "dStock", address: "0x173c83a71c1a9e254721a86b7512cd65bf92648d", decimals: 18 },
  { symbol: "METAd", ticker: "META", name: "Meta Platforms", issuer: "dStock", address: "0x5a9d2deee7d8782011695623f1c453f46b2b566e", decimals: 18 },
  { symbol: "SPCX.dw", ticker: "SPCXD", name: "Space Exploration Technologies Corp.", issuer: "dStock (wrapped)", address: "0x95687557c66bc799a850ba7037673528238ae763", decimals: 18 },
  { symbol: "SPYd", ticker: "SPY", name: "SPDR S&P 500 ETF", issuer: "dStock", address: "0xb7bf37783db41a2851b77c6917280c56312c833a", decimals: 18 },
  { symbol: "TSLA", ticker: "TSLA", name: "Tesla", issuer: "Wagyu", address: "0x3727c797073840936e3c18b4088f3574cd1a72a3", decimals: 8 },
  { symbol: "AAPLd", ticker: "AAPL", name: "Apple", issuer: "dStock", address: "0x7374dc1894fbd1bc6c42f6ebbc50b78c211a8606", decimals: 18 },
  { symbol: "AMZNd", ticker: "AMZN", name: "Amazon", issuer: "dStock", address: "0x4f2164c12d2d450a8b1d430492ef6670fe4cad8e", decimals: 18 },
  { symbol: "AVGOd", ticker: "AVGO", name: "Broadcom", issuer: "dStock", address: "0xc2785563af80c05177fff006e3b380ac5d172602", decimals: 18 },
  { symbol: "BNBd", ticker: "BNB", name: "BNB", issuer: "dStock", address: "0xfd6f06d323f6cb08ee9eeb2d201e9ec0e9112c88", decimals: 18 },
  { symbol: "CRCLd", ticker: "CRCL", name: "Circle Internet Group", issuer: "dStock", address: "0xe74aa6c4050a15790525eb11cc4562c664dc67c9", decimals: 18 },
  { symbol: "GOOGLd", ticker: "GOOGL", name: "Alphabet Class A", issuer: "dStock", address: "0x35eeda03e55ff217a013892e9e2e37e792b264ea", decimals: 18 },
  { symbol: "MSFTd", ticker: "MSFT", name: "Microsoft", issuer: "dStock", address: "0x66520d8fd614487214a25af7babf27584f59f76b", decimals: 18 },
  { symbol: "wMUx", ticker: "MUX", name: "Micron Technology", issuer: "Backed xStock", address: "0xe2047ee3bddb5c99ae428ab83df63f8730698e30", decimals: 18 },
  { symbol: "wNVDAx", ticker: "NVDAX", name: "NVIDIA", issuer: "Backed xStock", address: "0xa8ddb5cd96b5222afe198316e9a57caa642850d5", decimals: 18 },
  { symbol: "ORCLd", ticker: "ORCL", name: "Oracle", issuer: "dStock", address: "0xca2156522638f597ffb3705857ffdc356efabe50", decimals: 18 },
  { symbol: "wQQQx", ticker: "QQQX", name: "Nasdaq", issuer: "Backed xStock", address: "0x4c1ae29c159838fc1b224636e28e086eb69101f7", decimals: 18 },
  { symbol: "wSKHYx", ticker: "SKHYX", name: "SK hynix", issuer: "Backed xStock", address: "0x6215a58ed045d71f2561aaabe54f4c885c522998", decimals: 18 },
  { symbol: "SLVd", ticker: "SLV", name: "iShares Silver Trust", issuer: "dStock", address: "0x7ef4eba0c0200957e357627ced1884d6cb63e961", decimals: 18 },
  { symbol: "wSPYx", ticker: "SPYX", name: "SP500", issuer: "Backed xStock", address: "0xe7e553cd128f0011777323a0b44a7b96ea1cb540", decimals: 18 },
  { symbol: "AAPLon", ticker: "AAPL", name: "Apple", issuer: "Ondo", address: "0x81db0df77669b3be563e7a0591685a2c8c3ee1c5", decimals: 18 },
  { symbol: "AMDon", ticker: "AMD", name: "AMD", issuer: "Ondo", address: "0x33706203a7a7c82b6f6c09dd9ae4e6e881d36386", decimals: 18 },
  { symbol: "AMZNon", ticker: "AMZN", name: "Amazon", issuer: "Ondo", address: "0xed68f063264a01fd7f93087dc19cc1e0d614e8de", decimals: 18 },
  { symbol: "BABAon", ticker: "BABA", name: "Alibaba", issuer: "Ondo", address: "0x799bf997b733cab2e1377d0411b63e35133991eb", decimals: 18 },
  { symbol: "COINon", ticker: "COIN", name: "Coinbase", issuer: "Ondo", address: "0x639bcd00422facaca534063e3d860e8fcf78b46f", decimals: 18 },
  { symbol: "COPXon", ticker: "COPX", name: "Global X Copper Miners ETF", issuer: "Ondo", address: "0x86e33197369a3560cee2ab6bb12376ac7b29f3dd", decimals: 18 },
  { symbol: "CRCLon", ticker: "CRCL", name: "Circle Internet Group", issuer: "Ondo", address: "0x13a81c5e8b4ab05fc721dff7ba95e250b29458f8", decimals: 18 },
  { symbol: "CRWVon", ticker: "CRWV", name: "CoreWeave", issuer: "Ondo", address: "0xd616ddc3a9e13e12533d7124d5bd94b53fb60a3f", decimals: 18 },
  { symbol: "EWYon", ticker: "EWY", name: "iShares MSCI South Korea ETF", issuer: "Ondo", address: "0xed871e0d99369ab869fc38255a284361a137746b", decimals: 18 },
  { symbol: "FCXon", ticker: "FCX", name: "Freeport-McMoRan", issuer: "Ondo", address: "0xa019295d44677dd2f5b066245453938b1b1c483b", decimals: 18 },
  { symbol: "GLDon", ticker: "GLD", name: "SPDR Gold Shares", issuer: "Ondo", address: "0x95febdd6f447b5278c9b98743b4254eb02c6ea1d", decimals: 18 },
  { symbol: "GOOGLon", ticker: "GOOGL", name: "Alphabet Class A", issuer: "Ondo", address: "0x4d34798f18eb747f7225663f0553ea2d880cf75d", decimals: 18 },
  { symbol: "HOODon", ticker: "HOOD", name: "Robinhood Markets", issuer: "Ondo", address: "0xf1df92ac8e22763a16bf4bd9a966eebcd70fa5a3", decimals: 18 },
  { symbol: "IAUon", ticker: "IAU", name: "iShares Gold Trust", issuer: "Ondo", address: "0x83b01ac9e2d1632a70dd1c813c5b8edf29cd707f", decimals: 18 },
  { symbol: "INTCon", ticker: "INTC", name: "Intel", issuer: "Ondo", address: "0x7bf529bb5db370d679f33f4fe5420f48ee234bb7", decimals: 18 },
  { symbol: "IVVon", ticker: "IVV", name: "iShares Core S&P 500 ETF", issuer: "Ondo", address: "0xad26b6048cc3682f67fe4c829b7ac99dbf95920e", decimals: 18 },
  { symbol: "METAon", ticker: "META", name: "Meta Platforms", issuer: "Ondo", address: "0x46fa18ffe2707bbecc46d457d40efbe6b932f711", decimals: 18 },
  { symbol: "MSFTon", ticker: "MSFT", name: "Microsoft", issuer: "Ondo", address: "0xd53471f6d493f7ed766181d88ba9c2bfc371399a", decimals: 18 },
  { symbol: "MSTRon", ticker: "MSTR", name: "MicroStrategy", issuer: "Ondo", address: "0x8a64fdf0857c1c734a594cd1db20b3f8e3f133f6", decimals: 18 },
  { symbol: "MUon", ticker: "MU", name: "Micron Technology", issuer: "Ondo", address: "0x0f8e33f5cdefae9c2e59de8fb61fed347046d046", decimals: 18 },
  { symbol: "NFLXon", ticker: "NFLX", name: "Netflix", issuer: "Ondo", address: "0x81ebb420a81855f1bf1b0ff95eca9d3bd736ea89", decimals: 18 },
  { symbol: "NVDAon", ticker: "NVDA", name: "NVIDIA", issuer: "Ondo", address: "0xb989ad9b91886b1aaed8daadb26f028b29b40945", decimals: 18 },
  { symbol: "ORCLon", ticker: "ORCL", name: "Oracle", issuer: "Ondo", address: "0x4775e99a13651b1d077c2fa04eb9bf007f684af5", decimals: 18 },
  { symbol: "PALLon", ticker: "PALL", name: "abrdn Physical Palladium Shares ETF", issuer: "Ondo", address: "0x5ff6e08a0bdbc1ff11004ffb62b7ac7cdcf101bd", decimals: 18 },
  { symbol: "PLTRon", ticker: "PLTR", name: "Palantir Technologies", issuer: "Ondo", address: "0x039358ab6919159f6026ea4428595a5aaf12a35c", decimals: 18 },
  { symbol: "PPLTon", ticker: "PPLT", name: "abrdn Physical Platinum Shares ETF", issuer: "Ondo", address: "0xb4c0eaf28ae7f667d9dabaa995f7a6e75e094770", decimals: 18 },
  { symbol: "QQQon", ticker: "QQQ", name: "Invesco QQQ", issuer: "Ondo", address: "0x911e2dcd2b70f44231f3f0f1c6ec9af75068fd85", decimals: 18 },
  { symbol: "RIVNon", ticker: "RIVN", name: "Rivian Automotive", issuer: "Ondo", address: "0x353d347bb7bc1c812e3a131d9b5193b3618029e5", decimals: 18 },
  { symbol: "SLVon", ticker: "SLV", name: "iShares Silver Trust", issuer: "Ondo", address: "0xd53d98d13d93c817011645442c2e4d46e499b460", decimals: 18 },
  { symbol: "SNDKon", ticker: "SNDK", name: "SanDisk", issuer: "Ondo", address: "0xb8927cff399e23328eec0e457e75c709dcfcf382", decimals: 18 },
  { symbol: "SPYon", ticker: "SPY", name: "SPDR S&P 500 ETF", issuer: "Ondo", address: "0x32ec2792aec02122edd9f28866b720db1e1c1b54", decimals: 18 },
  { symbol: "TSLAon", ticker: "TSLA", name: "Tesla", issuer: "Ondo", address: "0x417883b1709545f1211a25b00ad13455fc7f1bc5", decimals: 18 },
  { symbol: "TSMon", ticker: "TSM", name: "Taiwan Semiconductor Manufacturing", issuer: "Ondo", address: "0x3254cdffddeddb1f61b9ef6f67e178615ccb0e85", decimals: 18 },
  { symbol: "UNGon", ticker: "UNG", name: "US Natural Gas Fund", issuer: "Ondo", address: "0x2c81466c9b144e3b6e9d6e8858bc0973a953fb0a", decimals: 18 },
  { symbol: "USOon", ticker: "USO", name: "United States Oil Fund", issuer: "Ondo", address: "0xa4db50bb345151f3649539300523e83a8b8a6bc7", decimals: 18 },
];

export const hyperStockByAddress = (addr?: string): HyperStock | undefined =>
  addr ? HYPER_STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;

// Wrapped Backed xStocks live on Ink (chain 57073); kept for the Ink flavor.
export const INK_STOCKS: HyperStock[] = [
  { symbol: 'wNVDAx', ticker: 'NVDAX', name: 'NVIDIA xStock', address: '0xa8ddb5cd96b5222afe198316e9a57caa642850d5', decimals: 18 },
  { symbol: 'wSPYx', ticker: 'SPYX', name: 'SP500 xStock', address: '0xe7e553cd128f0011777323a0b44a7b96ea1cb540', decimals: 18 },
  { symbol: 'wAAPLx', ticker: 'AAPLX', name: 'Apple xStock', address: '0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f', decimals: 18 },
  { symbol: 'wTSLAx', ticker: 'TSLAX', name: 'Tesla xStock', address: '0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171', decimals: 18 },
  { symbol: 'wMSTRx', ticker: 'MSTRX', name: 'MicroStrategy xStock', address: '0x30987adf0b11dc698438a99ba04ec3a1ab2c7eab', decimals: 18 },
  { symbol: 'wNFLXx', ticker: 'NFLXX', name: 'Netflix xStock', address: '0x7d87fd6a379714194a797c0bbb8b40c30d250856', decimals: 18 },
  { symbol: 'wPLTRx', ticker: 'PLTRX', name: 'Palantir xStock', address: '0x4a2df09536f62341c9f946427d16414c04e21342', decimals: 18 },
];

const FLAVOR = String(import.meta.env.VITE_BRAND ?? "");
export const STOCKS: HyperStock[] =
  FLAVOR === "ink"
    ? INK_STOCKS
    : FLAVOR === "robinhood"
      ? ROBINHOOD_STOCKS
      : HYPER_STOCKS;
export const stockByAddress = (addr?: string): HyperStock | undefined =>
  addr ? STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;
