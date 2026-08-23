// Tokenized stock/ETF ERC20s live on HyperEVM (Ondo Global Markets), verified
// on-chain (code + symbol + decimals). Any can be chosen as a coin pair on
// stonkliquid; the creator earns the 1% pool fee in that stock. Generated from
// contracts/deployments/hyperevm-ondo-stocks.json.
export interface HyperStock {
  symbol: string;   // on-chain symbol, e.g. "NVDAon"
  ticker: string;   // underlying ticker for display, e.g. "NVDA"
  name: string;
  address: `0x${string}`;
  decimals: number;
}

export const WHYPE: `0x${string}` = "0x5555555555555555555555555555555555555555";

export const HYPER_STOCKS: HyperStock[] = [
  { symbol: 'AAPLon', ticker: 'AAPL', name: 'Apple', address: '0x81db0DF77669b3BE563e7a0591685a2C8C3EE1c5', decimals: 18 },
  { symbol: 'AMDon', ticker: 'AMD', name: 'AMD', address: '0x33706203A7a7c82B6F6c09dd9Ae4E6e881d36386', decimals: 18 },
  { symbol: 'AMZNon', ticker: 'AMZN', name: 'Amazon', address: '0xeD68F063264a01fd7f93087DC19CC1E0D614e8De', decimals: 18 },
  { symbol: 'BABAon', ticker: 'BABA', name: 'Alibaba', address: '0x799Bf997B733CAb2e1377D0411b63E35133991eb', decimals: 18 },
  { symbol: 'COINon', ticker: 'COIN', name: 'Coinbase', address: '0x639Bcd00422facAcA534063e3d860e8fcf78B46F', decimals: 18 },
  { symbol: 'COPXon', ticker: 'COPX', name: 'Global X Copper Miners ETF', address: '0x86E33197369a3560CeE2Ab6Bb12376AC7b29f3dD', decimals: 18 },
  { symbol: 'CRCLon', ticker: 'CRCL', name: 'Circle Internet Group', address: '0x13a81c5e8b4AB05Fc721DfF7bA95e250b29458F8', decimals: 18 },
  { symbol: 'CRWVon', ticker: 'CRWV', name: 'CoreWeave', address: '0xd616dDC3a9e13e12533d7124d5BD94B53Fb60A3f', decimals: 18 },
  { symbol: 'EWYon', ticker: 'EWY', name: 'iShares MSCI South Korea ETF', address: '0xed871e0D99369AB869Fc38255a284361A137746B', decimals: 18 },
  { symbol: 'FCXon', ticker: 'FCX', name: 'Freeport-McMoRan', address: '0xA019295D44677dd2f5B066245453938B1b1C483B', decimals: 18 },
  { symbol: 'GLDon', ticker: 'GLD', name: 'SPDR Gold Shares', address: '0x95FebDd6f447B5278c9b98743B4254eB02c6EA1d', decimals: 18 },
  { symbol: 'GOOGLon', ticker: 'GOOGL', name: 'Alphabet Class A', address: '0x4D34798f18Eb747F7225663F0553eA2D880cf75D', decimals: 18 },
  { symbol: 'HOODon', ticker: 'HOOD', name: 'Robinhood Markets', address: '0xF1Df92AC8E22763A16bf4Bd9a966EEBcD70fA5a3', decimals: 18 },
  { symbol: 'IAUon', ticker: 'IAU', name: 'iShares Gold Trust', address: '0x83b01AC9e2D1632A70Dd1C813c5B8eDF29cd707f', decimals: 18 },
  { symbol: 'INTCon', ticker: 'INTC', name: 'Intel', address: '0x7bf529bb5Db370D679F33f4fe5420F48eE234bB7', decimals: 18 },
  { symbol: 'IVVon', ticker: 'IVV', name: 'iShares Core S&P 500 ETF', address: '0xAd26B6048cc3682f67Fe4C829b7Ac99dbF95920e', decimals: 18 },
  { symbol: 'METAon', ticker: 'META', name: 'Meta Platforms', address: '0x46FA18Ffe2707bbecc46D457D40EFBE6B932f711', decimals: 18 },
  { symbol: 'MSFTon', ticker: 'MSFT', name: 'Microsoft', address: '0xD53471f6D493f7eD766181D88Ba9c2Bfc371399A', decimals: 18 },
  { symbol: 'MSTRon', ticker: 'MSTR', name: 'MicroStrategy', address: '0x8a64FDf0857c1C734A594cd1DB20B3f8E3f133f6', decimals: 18 },
  { symbol: 'MUon', ticker: 'MU', name: 'Micron Technology', address: '0x0f8E33F5CdefAE9C2E59de8fB61feD347046D046', decimals: 18 },
  { symbol: 'NFLXon', ticker: 'NFLX', name: 'Netflix', address: '0x81Ebb420a81855f1Bf1B0fF95eCa9d3Bd736ea89', decimals: 18 },
  { symbol: 'NVDAon', ticker: 'NVDA', name: 'NVIDIA', address: '0xB989ad9b91886b1Aaed8DaADb26F028b29b40945', decimals: 18 },
  { symbol: 'ORCLon', ticker: 'ORCL', name: 'Oracle', address: '0x4775e99a13651B1D077c2fa04Eb9BF007f684af5', decimals: 18 },
  { symbol: 'PALLon', ticker: 'PALL', name: 'abrdn Physical Palladium Shares ETF', address: '0x5Ff6E08A0Bdbc1ff11004FfB62B7aC7CdCf101Bd', decimals: 18 },
  { symbol: 'PLTRon', ticker: 'PLTR', name: 'Palantir Technologies', address: '0x039358AB6919159f6026Ea4428595a5AaF12A35C', decimals: 18 },
  { symbol: 'PPLTon', ticker: 'PPLT', name: 'abrdn Physical Platinum Shares ETF', address: '0xB4C0eaf28Ae7f667D9dabAA995F7A6E75e094770', decimals: 18 },
  { symbol: 'QQQon', ticker: 'QQQ', name: 'Invesco QQQ', address: '0x911e2dCD2b70F44231F3F0f1C6ec9aF75068FD85', decimals: 18 },
  { symbol: 'RIVNon', ticker: 'RIVN', name: 'Rivian Automotive', address: '0x353D347bb7bc1C812E3a131d9b5193b3618029e5', decimals: 18 },
  { symbol: 'SLVon', ticker: 'SLV', name: 'iShares Silver Trust', address: '0xd53d98d13D93C817011645442c2e4d46E499B460', decimals: 18 },
  { symbol: 'SNDKon', ticker: 'SNDK', name: 'SanDisk', address: '0xB8927cfF399E23328eEC0e457e75c709DCfcF382', decimals: 18 },
  { symbol: 'SPYon', ticker: 'SPY', name: 'SPDR S&P 500 ETF', address: '0x32eC2792aeC02122eDD9f28866B720db1e1c1B54', decimals: 18 },
  { symbol: 'TSLAon', ticker: 'TSLA', name: 'Tesla', address: '0x417883b1709545f1211A25b00ad13455fC7F1bc5', decimals: 18 },
  { symbol: 'TSMon', ticker: 'TSM', name: 'Taiwan Semiconductor Manufacturing', address: '0x3254cdffDDEDdb1F61B9eF6f67e178615CCb0E85', decimals: 18 },
  { symbol: 'UNGon', ticker: 'UNG', name: 'US Natural Gas Fund', address: '0x2c81466C9B144E3B6e9D6e8858Bc0973a953Fb0A', decimals: 18 },
  { symbol: 'USOon', ticker: 'USO', name: 'United States Oil Fund', address: '0xA4dB50bB345151f3649539300523e83a8b8A6BC7', decimals: 18 },
];

export const hyperStockByAddress = (addr?: string): HyperStock | undefined =>
  addr ? HYPER_STOCKS.find((s) => s.address.toLowerCase() === addr.toLowerCase()) : undefined;
