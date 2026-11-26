import { encodeAbiParameters, encodePacked, type Address, type Hex } from "viem";

// Ondo tokenized stocks on Ethereum mainnet, all 184 verified on-chain, ranked
// by real DEX liquidity. `route` is the ETH to stock path the router walks:
// WETH to USDC or USDT on Uniswap V3 (0.05%), then the stock's own pool
// (Uniswap V3 at `fee`, or a V4 pool key). Stocks without a route can still
// be a pair, but buyers must hold the stock. Regenerate with
// scratchpad gen-stocks.cjs from the contracts/deployments/ethereum-* files.
export interface StockRoute {
  kind: "v3" | "v4";
  via: "USDC" | "USDT" | "WETH";
  fee: number;
  tickSpacing?: number;
  hooks?: string;
}
export interface Stock {
  symbol: string;
  ticker: string;
  name: string;
  address: Address;
  /** Snapshot USD price (the factory's on-chain price wins when read). */
  usd: number;
  /** USD in the stock's deepest pool at the last scan (0 = none). */
  liqUsd: number;
  vol24Usd: number;
  route?: StockRoute;
}

export const WETH: Address = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const USDC: Address = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
export const USDT: Address = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const STABLE: Record<string, Address> = { USDC, USDT, WETH };
/** WETH/stable Uniswap V3 tier used for the first hop. */
const WETH_STABLE_FEE = 500;

export const STOCKS: Stock[] = [
  { symbol: "TSLAon", ticker: "TSLA", name: "Tesla", address: "0xf6b1117ec07684d3958cad8beb1b302bfd21103f", usd: 1640.69, liqUsd: 355868, vol24Usd: 2 },
  { symbol: "HIMSon", ticker: "HIMS", name: "Hims & Hers Health", address: "0xca468554e5c0423ee858fe3942c9568c51fcaa79", usd: 27.76, liqUsd: 185592, vol24Usd: 7500 },
  { symbol: "SLVon", ticker: "SLV", name: "iShares Silver Trust", address: "0xf3e4872e6a4cf365888d93b6146a2baa7348f1a4", usd: 59.62, liqUsd: 148169, vol24Usd: 35954, route: {"kind":"v3","via":"USDT","fee":3000} },
  { symbol: "NVDAon", ticker: "NVDA", name: "NVIDIA", address: "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee", usd: 229.26, liqUsd: 73619, vol24Usd: 233785, route: {"kind":"v4","via":"USDC","fee":9000,"tickSpacing":90,"hooks":"0x0000000000000000000000000000000000000000"} },
  { symbol: "CRCLon", ticker: "CRCL", name: "Circle Internet Group", address: "0x3632dea96a953c11dac2f00b4a05a32cd1063fae", usd: 100.78, liqUsd: 54236, vol24Usd: 76, route: {"kind":"v4","via":"USDC","fee":9999,"tickSpacing":200,"hooks":"0x0000000000000000000000000000000000000000"} },
  { symbol: "SPYon", ticker: "SPY", name: "SPDR S&P 500 ETF", address: "0xfedc5f4a6c38211c1338aa411018dfaf26612c08", usd: 774.46, liqUsd: 44984, vol24Usd: 41691, route: {"kind":"v3","via":"USDC","fee":3000} },
  { symbol: "GOOGLon", ticker: "GOOGL", name: "Alphabet Class A", address: "0xba47214edd2bb43099611b208f75e4b42fdcfedc", usd: 338.13, liqUsd: 19725, vol24Usd: 7902, route: {"kind":"v3","via":"USDC","fee":10000} },
  { symbol: "SPCXon", ticker: "SPCX", name: "SpaceX", address: "0xc9eef266834730340a55b6cc24621b31baf55581", usd: 266.6, liqUsd: 17529, vol24Usd: 350 },
  { symbol: "QQQon", ticker: "QQQ", name: "Invesco QQQ", address: "0x0e397938c1aa0680954093495b70a9f5e2249aba", usd: 714.47, liqUsd: 13482, vol24Usd: 145, route: {"kind":"v4","via":"USDT","fee":10000,"tickSpacing":200,"hooks":"0x0000000000000000000000000000000000000000"} },
  { symbol: "SPGIon", ticker: "SPGI", name: "S&P Global", address: "0xbc843b147db4c7e00721d76037b8b92e13afe13f", usd: 468.16, liqUsd: 8721, vol24Usd: 467 },
  { symbol: "MUon", ticker: "MU", name: "Micron Technology", address: "0x050362ab1072cb2ce74d74770e22a3203ad04ee5", usd: 959.16, liqUsd: 5072, vol24Usd: 621, route: {"kind":"v3","via":"USDT","fee":3000} },
  { symbol: "MRVLon", ticker: "MRVL", name: "Marvell Technology", address: "0xf404e5f887dbd5508e16a1198fcdd5de1a4296b8", usd: 223.84, liqUsd: 5005, vol24Usd: 6069, route: {"kind":"v3","via":"USDT","fee":3000} },
  { symbol: "PLTRon", ticker: "PLTR", name: "Palantir Technologies", address: "0x0c666485b02f7a87d21add7aeb9f5e64975aa490", usd: 175.96, liqUsd: 4859, vol24Usd: 209 },
  { symbol: "COPXon", ticker: "COPX", name: "Global X Copper Miners ETF", address: "0x423a63dfe8d82cd9c6568c92210aa537d8ef6885", usd: 90.78, liqUsd: 3998, vol24Usd: 55, route: {"kind":"v3","via":"USDC","fee":10000} },
  { symbol: "USOon", ticker: "USO", name: "United States Oil Fund", address: "0x1f5fc5c3c8b0f15c7e21af623936ff2b210b6415", usd: 138.64, liqUsd: 3827, vol24Usd: 972, route: {"kind":"v4","via":"USDC","fee":3000,"tickSpacing":60,"hooks":"0x0000000000000000000000000000000000000000"} },
  { symbol: "TSMon", ticker: "TSM", name: "Taiwan Semiconductor Manufacturing", address: "0x3cafdbfe682aec17d5ace2f97a2f3ab3dcf6a4a9", usd: 429.17, liqUsd: 3623, vol24Usd: 317 },
  { symbol: "AAPLon", ticker: "AAPL", name: "Apple", address: "0x14c3abf95cb9c93a8b82c1cdcb76d72cb87b2d4c", usd: 316.93, liqUsd: 3463, vol24Usd: 121064, route: {"kind":"v3","via":"USDC","fee":10000} },
  { symbol: "ORCLon", ticker: "ORCL", name: "Oracle", address: "0x8a23c6baadb88512b30475c83df6a63881e33e1e", usd: 161.29, liqUsd: 2396, vol24Usd: 573, route: {"kind":"v3","via":"USDT","fee":3000} },
  { symbol: "ANETon", ticker: "ANET", name: "Arista Networks", address: "0x20e113e9235df6a2a9bfc6f244c2ccc380c8f546", usd: 306.47, liqUsd: 1407, vol24Usd: 0 },
  { symbol: "AMZNon", ticker: "AMZN", name: "Amazon", address: "0xbb8774fb97436d23d74c1b882e8e9a69322cfd31", usd: 262.42, liqUsd: 1220, vol24Usd: 10 },
  { symbol: "AMCon", ticker: "AMC", name: "AMC Entertainment", address: "0x592643a667633bca51cb2387c98b6de6ce549a45", usd: 1.26, liqUsd: 1199, vol24Usd: 89 },
  { symbol: "DASHon", ticker: "DASH", name: "DoorDash", address: "0x241958c86c7744d15d5f6314ba1ea4c81dda2896", usd: 649.25, liqUsd: 1061, vol24Usd: 77 },
  { symbol: "AAOIon", ticker: "AAOI", name: "Applied Optoelectronics", address: "0x99888f2ccd08258ed5f66e94ba59d7e75016900f", usd: 103.85, liqUsd: 1009, vol24Usd: 30 },
  { symbol: "CMGon", ticker: "CMG", name: "Chipotle", address: "0x25018520138bbab60684ad7983d4432e8b8e926b", usd: 36.96, liqUsd: 997, vol24Usd: 106 },
  { symbol: "SBUXon", ticker: "SBUX", name: "Starbucks", address: "0xf15fbc1349ab99abad63db3f9a510bf413be3bef", usd: 104.47, liqUsd: 919, vol24Usd: 35 },
  { symbol: "GMEon", ticker: "GME", name: "GameStop", address: "0x71d24baeb0a033ec5f90ff65c4210545af378d97", usd: 19.16, liqUsd: 865, vol24Usd: 6 },
  { symbol: "HOODon", ticker: "HOOD", name: "Robinhood Markets", address: "0x998f02a9e343ef6e3e6f28700d5a20f839fd74e6", usd: 122.11, liqUsd: 363, vol24Usd: 130 },
  { symbol: "AMDon", ticker: "AMD", name: "AMD", address: "0x0c1f3412a44ff99e40bf14e06e5ea321ae7b3938", usd: 477.57, liqUsd: 160, vol24Usd: 1 },
  { symbol: "METAon", ticker: "META", name: "Meta Platforms", address: "0x59644165402b611b350645555b50afb581c71eb2", usd: 616.77, liqUsd: 144, vol24Usd: 375 },
  { symbol: "TLTon", ticker: "TLT", name: "iShares 20+ Year Treasury Bond ETF", address: "0x992651bfeb9a0dcc4457610e284ba66d86489d4d", usd: 82.21, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IEFAon", ticker: "IEFA", name: "iShares Core MSCI EAFE ETF", address: "0xfeff7a377a86462f5a2a872009722c154707f09e", usd: 101.08, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AGGon", ticker: "AGG", name: "iShares Core US Aggregate Bond ETF", address: "0xff7cf16aa2ffc463b996db2f7b7cf0130336899d", usd: 97, liqUsd: 0, vol24Usd: 0 },
  { symbol: "PFEon", ticker: "PFE", name: "Pfizer", address: "0x06954faa913fa14c28eb1b2e459594f22f33f3de", usd: 28.45, liqUsd: 0, vol24Usd: 0 },
  { symbol: "PBRon", ticker: "PBR", name: "Petrobras", address: "0xd08ddb436e731f32455fe302723ee0fd2e9e8706", usd: 20.12, liqUsd: 0, vol24Usd: 0 },
  { symbol: "EEMon", ticker: "EEM", name: "iShares MSCI Emerging Markets ETF", address: "0x77a1a02e4a888ada8620b93c30de8a41e621126c", usd: 68.7, liqUsd: 0, vol24Usd: 0 },
  { symbol: "EFAon", ticker: "EFA", name: "iShares MSCI EAFE ETF", address: "0x4111b60bc87f2bd1e81e783e271d7f0ec6ee088b", usd: 108.35, liqUsd: 0, vol24Usd: 0 },
  { symbol: "TIPon", ticker: "TIP", name: "iShares TIPS Bond ETF", address: "0x2df38ca485d01fc15e4fd85847ed26b7ef871c1c", usd: 106.97, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IAUon", ticker: "IAU", name: "iShares Gold Trust", address: "0x4f0ca3df1c2e6b943cf82e649d576ffe7b2fabcf", usd: 83.39, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IVVon", ticker: "IVV", name: "iShares Core S&P 500 ETF", address: "0x62ca254a363dc3c748e7e955c20447ab5bf06ff7", usd: 773.92, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ITOTon", ticker: "ITOT", name: "iShares Core S&P Total US Stock Market ETF", address: "0x0692481c369e2bdc728a69ae31b848343a4567be", usd: 168.64, liqUsd: 0, vol24Usd: 0 },
  { symbol: "INTCon", ticker: "INTC", name: "Intel", address: "0xfda09936dbd717368de0835ba441d9e62069d36f", usd: 95.8, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MSTRon", ticker: "MSTR", name: "MicroStrategy", address: "0xcabd955322dfbf94c084929ac5e9eca3feb5556f", usd: 142.8, liqUsd: 0, vol24Usd: 0 },
  { symbol: "NVOon", ticker: "NVO", name: "Novo Nordisk", address: "0x28151f5888833d3d767c4d6945a0ee50d1b193e3", usd: 46.6, liqUsd: 0, vol24Usd: 0 },
  { symbol: "KOon", ticker: "KO", name: "Coca-Cola", address: "0x74a03d741226f738098c35da8188e57aca50d146", usd: 88.07, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IJHon", ticker: "IJH", name: "iShares Core S&P MidCap ETF", address: "0xfd50fc4e3686a8da814c5c3d6121d8ab98a537f0", usd: 75.85, liqUsd: 0, vol24Usd: 0 },
  { symbol: "JDon", ticker: "JD", name: "JD.com", address: "0xdeb6b89088ca9b7d7756087c8a0f7c6df46f319c", usd: 28.26, liqUsd: 0, vol24Usd: 0 },
  { symbol: "QBTSon", ticker: "QBTS", name: "D-Wave Quantum", address: "0x3807562a482b824c08a564dfefcc471806d3e00a", usd: 16.58, liqUsd: 0, vol24Usd: 0 },
  { symbol: "SMCIon", ticker: "SMCI", name: "Super Micro Computer", address: "0x2ca12a3f9635fd69c21580def14f25c210ca9612", usd: 39.59, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BMNRon", ticker: "BMNR", name: "BitMine Immersion Technologies", address: "0x33483a58079b4225b10e57958ca28ad7b9cdbaf7", usd: 24.97, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CSCOon", ticker: "CSCO", name: "Cisco Systems", address: "0x980a1001ee94e54142b231f44c7ca7c9df71fbe1", usd: 109.2, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IWNon", ticker: "IWN", name: "iShares Russell 2000 Value ETF", address: "0x9dcf7f739b8c0270e2fc0cc8d0dabe355a150dba", usd: 224.62, liqUsd: 0, vol24Usd: 0 },
  { symbol: "RIOTon", ticker: "RIOT", name: "Riot Platforms", address: "0x21deafd91116fce9fe87c8f15bde03f99a309b72", usd: 21.8, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ASTSon", ticker: "ASTS", name: "AST SpaceMobile", address: "0x0d1fa4e1e3719945899ef7b02840627df46af44a", usd: 62.31, liqUsd: 0, vol24Usd: 0 },
  { symbol: "WMTon", ticker: "WMT", name: "Walmart", address: "0x82106347ddbb23ce44cf4ce4053ef1adf8b9323b", usd: 107.14, liqUsd: 0, vol24Usd: 0 },
  { symbol: "PYPLon", ticker: "PYPL", name: "PayPal", address: "0x4efd92f372898b57f292de69fce377dd7d912bdd", usd: 54.96, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IWFon", ticker: "IWF", name: "iShares Russell 1000 Growth ETF", address: "0x8d05432c2786e3f93f1a9a62b9572dbf54f3ea06", usd: 123.41, liqUsd: 0, vol24Usd: 0 },
  { symbol: "PGon", ticker: "PG", name: "Procter & Gamble", address: "0x339ce23a355ed6d513dd3e1462975c4ecd86823a", usd: 146.44, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MARAon", ticker: "MARA", name: "MARA Holdings", address: "0x4604b0b581269843ac7a6b70a5fc019e7762e511", usd: 11.31, liqUsd: 0, vol24Usd: 0 },
  { symbol: "PEPon", ticker: "PEP", name: "PepsiCo", address: "0x3ce219d498d807317f840f4cb0f03fa27dd65046", usd: 137.63, liqUsd: 0, vol24Usd: 0 },
  { symbol: "WFCon", ticker: "WFC", name: "Wells Fargo", address: "0x4ad2118da8a65eaa81402a3d583fef6ee76bdf3f", usd: 89.97, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BABAon", ticker: "BABA", name: "Alibaba", address: "0x41765f0fcddc276309195166c7a62ae522fa09ef", usd: 113.24, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BOTon", ticker: "BOT", name: "RoboStrategy", address: "0x0e05ba0756c504b69aaa642f7379cd1af7c63969", usd: 26.8, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ABTon", ticker: "ABT", name: "Abbott", address: "0x3859385363f7bb4dfe42811ccf3f294fcd41dd1d", usd: 108.33, liqUsd: 0, vol24Usd: 0 },
  { symbol: "COINon", ticker: "COIN", name: "Coinbase", address: "0xf042cfa86cf1d598a75bdb55c3507a1f39f9493b", usd: 184.64, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CVXon", ticker: "CVX", name: "Chevron", address: "0x8f3e41b378ae010c46d255f36bfc1d303b52dceb", usd: 208.6, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IWMon", ticker: "IWM", name: "iShares Russell 2000 ETF", address: "0x070d79021dd7e841123cb0cf554993bf683c511d", usd: 296.01, liqUsd: 0, vol24Usd: 0 },
  { symbol: "UBERon", ticker: "UBER", name: "Uber", address: "0x5bcd8195e3ef58f677aef9ebc276b5087c027050", usd: 75.76, liqUsd: 0, vol24Usd: 0 },
  { symbol: "HYGon", ticker: "HYG", name: "iBoxx $ High Yield Corporate Bond ETF", address: "0xed3618bb8778f8ebbe2f241da532227591771d04", usd: 79.16, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BIDUon", ticker: "BIDU", name: "Baidu", address: "0x9d4c6ad12b55e4645b585209f90cc26614061e91", usd: 99.47, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BTGOon", ticker: "BTGO", name: "BitGo Holdings", address: "0x510dd21055188eda378714de3bb5591ffa0cc468", usd: 7.3, liqUsd: 0, vol24Usd: 0 },
  { symbol: "TMon", ticker: "TM", name: "Toyota", address: "0xab02fc332e9278ebcbbc6b4a8038050c01d15f69", usd: 197.11, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MSFTon", ticker: "MSFT", name: "Microsoft", address: "0xb812837b81a3a6b81d7cd74cfb19a7f2784555e5", usd: 499.7, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MCDon", ticker: "MCD", name: "McDonald's", address: "0x4c82c8cd9a218612dce60b156b73a36705645e3b", usd: 255.69, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ABNBon", ticker: "ABNB", name: "Airbnb", address: "0xb035c3d5083bdc80074f380aebc9fcb68aba0a28", usd: 181.94, liqUsd: 0, vol24Usd: 0 },
  { symbol: "DISon", ticker: "DIS", name: "Disney", address: "0xc3d93b45249e8e06cfeb01d25a96337e8893265d", usd: 105.31, liqUsd: 0, vol24Usd: 0 },
  { symbol: "JPMon", ticker: "JPM", name: "JPMorgan Chase", address: "0x03c1ec4ca9dbb168e6db0def827c085999cbffaf", usd: 358.64, liqUsd: 0, vol24Usd: 0 },
  { symbol: "IBMon", ticker: "IBM", name: "IBM", address: "0x25d3f236b2d61656eebdea86ac6d42168e340011", usd: 234.89, liqUsd: 0, vol24Usd: 0 },
  { symbol: "LMTon", ticker: "LMT", name: "Lockheed", address: "0x691b126cf619707ed5d16cab1b27c000aa8de300", usd: 525.28, liqUsd: 0, vol24Usd: 0 },
  { symbol: "FUTUon", ticker: "FUTU", name: "Futu Holdings", address: "0x5ce215d9c37a195df88e294a06b8396c296b4e15", usd: 121.75, liqUsd: 0, vol24Usd: 0 },
  { symbol: "PANWon", ticker: "PANW", name: "Palo Alto Networks", address: "0x34bfdff25f0fda6d3ad0c33f1e06c0d40bd68885", usd: 333.26, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ARMon", ticker: "ARM", name: "Arm Holdings plc", address: "0x5bf1b2a808598c0ef4af1673a5457d86fe6d7b3d", usd: 252.09, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AVGOon", ticker: "AVGO", name: "Broadcom", address: "0x0d54d4279b9e8c54cd8547c2c75a8ee81a0bcae8", usd: 357.895, liqUsd: 0, vol24Usd: 0 },
  { symbol: "QCOMon", ticker: "QCOM", name: "Qualcomm", address: "0xe3419710c1f77d44b4dab02316d3f048818c4e59", usd: 168.74, liqUsd: 0, vol24Usd: 0 },
  { symbol: "APOon", ticker: "APO", name: "Apollo Global Management", address: "0x4d21affd27183b07335935f81a5c26b6a5a15355", usd: 133.67, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BBAIon", ticker: "BBAI", name: "BigBear.ai Holdings", address: "0x1b8d3e59b31981385c066ee0916ec964628ff1f9", usd: 2.92, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BAon", ticker: "BA", name: "Boeing", address: "0x57270d35a840bc5c094da6fbeca033fb71ea6ab0", usd: 212.25, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ACNon", ticker: "ACN", name: "Accenture", address: "0xaba9ae731aad63335c604e5f6e6a5db2e05f549d", usd: 186.72, liqUsd: 0, vol24Usd: 0 },
  { symbol: "SHOPon", ticker: "SHOP", name: "Shopify", address: "0x908266c1192628371cff7ad2f5eba4de061a0ac5", usd: 145.09, liqUsd: 0, vol24Usd: 0 },
  { symbol: "Von", ticker: "V", name: "Visa", address: "0xac37c20c1d0e5285035e056101a64e263ff94a41", usd: 375.07, liqUsd: 0, vol24Usd: 0 },
  { symbol: "GEon", ticker: "GE", name: "General Electric", address: "0xd904bcf89b7cedf5c89f9df7e829191d695f847e", usd: 337.12, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CRMon", ticker: "CRM", name: "Salesforce", address: "0x55720ef5b023fd043ae5f8d2e526030207978950", usd: 259.23, liqUsd: 0, vol24Usd: 0 },
  { symbol: "LLYon", ticker: "LLY", name: "Eli Lilly", address: "0xf192957ae52db3eb088654403cc2eded014ae556", usd: 1149.36, liqUsd: 0, vol24Usd: 0 },
  { symbol: "RDDTon", ticker: "RDDT", name: "Reddit", address: "0xa9431d354cfad3c6b76e50f0e73b43d48be80cd0", usd: 154.46, liqUsd: 0, vol24Usd: 0 },
  { symbol: "SNOWon", ticker: "SNOW", name: "Snowflake", address: "0x5d1a9a9b118ff19721e0111f094f2360b6ef7a2f", usd: 337.18, liqUsd: 0, vol24Usd: 0 },
  { symbol: "LINon", ticker: "LIN", name: "Linde plc", address: "0x01b19c68f8a9ee3a480da788ba401cfabdf19b93", usd: 477.57, liqUsd: 0, vol24Usd: 0 },
  { symbol: "UNHon", ticker: "UNH", name: "UnitedHealth", address: "0x075756f3b6381a79633438faa8964946bf40163d", usd: 397.14, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ADBEon", ticker: "ADBE", name: "Adobe", address: "0x7042a8ffc7c7049684bfbc2fcb41b72380755a43", usd: 266.51, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AXPon", ticker: "AXP", name: "American Express", address: "0x2bc7ff0c5da9f1a4a51f96e77c5b0f7165dc06d2", usd: 326.16, liqUsd: 0, vol24Usd: 0 },
  { symbol: "INTUon", ticker: "INTU", name: "Intuit", address: "0x6cc0afd51ce4cb6920b775f3d6376ab82b9a93bb", usd: 332.7, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MAon", ticker: "MA", name: "Mastercard", address: "0xa29dc2102dfc2a0a4a5dcb84af984315567c9858", usd: 579.21, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BEon", ticker: "BE", name: "Bloom Energy", address: "0x92e04b1fcc2b16347820241d226853cf01c9ebab", usd: 252.87, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BLKon", ticker: "BLK", name: "Blackrock, Inc.", address: "0x7a0f89c1606f71499950aa2590d547c3975b728e", usd: 1122.29, liqUsd: 0, vol24Usd: 0 },
  { symbol: "NOWon", ticker: "NOW", name: "ServiceNow", address: "0x8bcf9012f4b0c1c3d359edb7133c294f82f80790", usd: 141.26, liqUsd: 0, vol24Usd: 0 },
  { symbol: "EQIXon", ticker: "EQIX", name: "Equinix", address: "0x73d2ccee12c120e7da265a2de9d9f952a0101b4f", usd: 1035.98, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ASMLon", ticker: "ASML", name: "ASML Holding NV", address: "0xe51ba774ebf6392c45bf1d9e6b334d07992460d3", usd: 1714.88, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ACHRon", ticker: "ACHR", name: "Archer Aviation", address: "0x9cfa08002d606e638fe91941be725e1b970b84a6", usd: 5.71, liqUsd: 0, vol24Usd: 0 },
  { symbol: "COSTon", ticker: "COST", name: "Costco", address: "0x0c8276e4fec072cf7854be69c70f7773d1610857", usd: 915.74, liqUsd: 0, vol24Usd: 0 },
  { symbol: "SPOTon", ticker: "SPOT", name: "Spotify", address: "0x590f21186489ca1612f49a4b1ff5c66acd6796a9", usd: 542.43, liqUsd: 0, vol24Usd: 0 },
  { symbol: "NFLXon", ticker: "NFLX", name: "Netflix", address: "0x032dec3372f25c41ea8054b4987a7c4832cdb338", usd: 78.25, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BILIon", ticker: "BILI", name: "Bilibili", address: "0x7e08ce07aca80cefe61ebbfa0cedfe5c7b07edb9", usd: 15.23, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CIFRon", ticker: "CIFR", name: "Cipher Mining", address: "0x24e5bc45d5b6cef6f38989ac33df587a3fc850cf", usd: 17.74, liqUsd: 0, vol24Usd: 0 },
  { symbol: "APPon", ticker: "APP", name: "AppLovin", address: "0xd5c5b2883735fa9b658dd52e2fcc8d7c0f1a42ce", usd: 320.56, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CIBRon", ticker: "CIBR", name: "First Trust NASDAQ Cybersecurity ETF", address: "0x42d6e274b8631e5289a8f853e8d1a7baeff3c8d1", usd: 94.59, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AALon", ticker: "AAL", name: "American Airlines Group", address: "0xbe8eb7b51a08f9d52bb6c8c7eca699f0f89bfc02", usd: 13.13, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AIPon", ticker: "AIP", name: "Arteris", address: "0x0d8ef471a11036bc6dda1536069457f7e97dab66", usd: 21.37, liqUsd: 0, vol24Usd: 0 },
  { symbol: "APLDon", ticker: "APLD", name: "Applied Digital", address: "0x318dcb4f07c3e6ccecc12a252100fb3bf76eeb02", usd: 26.37, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MELIon", ticker: "MELI", name: "MercadoLibre", address: "0x2816169a49953c548bfeb3948dcf05c4a0e4657d", usd: 1978.36, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CEGon", ticker: "CEG", name: "Constellation Energy", address: "0x060505527c83e8bfeb9b4ff08248b82e688800f1", usd: 298.96, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BOTZon", ticker: "BOTZ", name: "Global X Robotics & Artificial Intelligence ETF", address: "0x7abec847a3f9820397c82e1dad231721bf5a6732", usd: 35.95, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BNOon", ticker: "BNO", name: "US Brent Oil Fund", address: "0x9ddb2524782684942fad28b44e76552cb7f3f548", usd: 56.11, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CBRSon", ticker: "CBRS", name: "Cerebras Systems", address: "0x61882bb63af8e6a39531175cdfde1fcd98346503", usd: 210.05, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AXTIon", ticker: "AXTI", name: "AXT", address: "0x6a3e77d984e22bed6a036d3da79d7857936a593f", usd: 61.64, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AMATon", ticker: "AMAT", name: "Applied Materials", address: "0x6be935eadc71c49c414b1175985946ee40365c67", usd: 454.71, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BTGon", ticker: "BTG", name: "B2Gold", address: "0x8ac6ad49b3344024834f373f3ca491f22ceb952e", usd: 5.61, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AEHRon", ticker: "AEHR", name: "Aehr Test Systems", address: "0xeb48e68f01c0c76735dc6f1dcc0f151a973bd9d2", usd: 86.26, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BACon", ticker: "BAC", name: "Bank of America", address: "0x576e9ca70e3a040c00d8139b0665a2b7b7b64844", usd: 62.68, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CCJon", ticker: "CCJ", name: "Cameco", address: "0xa9f9be37b19f261ab067c5f7deda2c969ec66944", usd: 100.74, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AGon", ticker: "AG", name: "First Majestic Silver", address: "0xaa26e62e51bc5da24ed2b6fc6491e137d68824b9", usd: 20.97, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BTDRon", ticker: "BTDR", name: "Bitdeer Technologies", address: "0x0683154c33b7563ed39951b4d7c0470ea28d93e9", usd: 12.38, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ARGTon", ticker: "ARGT", name: "Global X MSCI Argentina ETF", address: "0xfb1b703b26957c344aab03bbe11ec9c23e9eddf5", usd: 96.41, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AAONon", ticker: "AAON", name: "AAON", address: "0x6e9c573e5b8a59cec47d8e317c148e4b0595fb39", usd: 79.4, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BZon", ticker: "BZ", name: "Kanzhun", address: "0x858e985126543b5a066c4e8a5dab0249c1d683f7", usd: 16.92, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BILon", ticker: "BIL", name: "SPDR Bloomberg 1-3 Month T-Bill ETF", address: "0x2710e30d84b376c34a3b3036aa196b26a83a321b", usd: 91.45, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ALOYon", ticker: "ALOY", name: "REalloys", address: "0x4cdd1099146f28a9b428cd85f36b562b6d05c8c8", usd: 10.1, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AMKRon", ticker: "AMKR", name: "Amkor Technology", address: "0xf02b8309df07641ddcfd1dabceffdde3d30915de", usd: 47.77, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CAPRon", ticker: "CAPR", name: "Capricor Therapeutics", address: "0x70ec0f5b23404c0cd6f29ce88f4af00a0b0d895d", usd: 9.4, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ALABon", ticker: "ALAB", name: "Astera Labs", address: "0xd6d09189b6fd611a75435e4a123e373a56ab0e41", usd: 310.4, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CIENon", ticker: "CIEN", name: "Ciena", address: "0x1ffac2df9696868d06f9fe8d72fee9e1452eef76", usd: 321, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AURon", ticker: "AUR", name: "Aurora Innovation", address: "0xfc9d0ebbd17d3aaa336a50488795806c69ea4b32", usd: 6.34, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ARQQon", ticker: "ARQQ", name: "Arqit Quantum", address: "0x45583545be579cc96409903597c5e17b3fd7ceff", usd: 21.37, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ALBon", ticker: "ALB", name: "Albemarle", address: "0x1b468d5535ed7c19ce42f0073db7fdf441028131", usd: 126.28, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AIQon", ticker: "AIQ", name: "Global X Artificial Intelligence & Technology ETF", address: "0x2a5ae1bde731cb8732fd762073dd0bbe151360b9", usd: 64.32, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AMGNon", ticker: "AMGN", name: "Amgen", address: "0x1c5fa55eade69ae98571059332520f73733c2d82", usd: 437.23, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CATon", ticker: "CAT", name: "Caterpillar", address: "0xf719b02079e0faa5450392da2d3e11a1e5b0eadb", usd: 813.94, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ABBVon", ticker: "ABBV", name: "AbbVie", address: "0x7c7378143a9c8839e0502e2178f058f46c6ea504", usd: 256.46, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BINCon", ticker: "BINC", name: "iShares Flexible Income Active ETF", address: "0x88703c1e71f44a2d329c99e8e112f7a4e7dd6312", usd: 51.68, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BAIon", ticker: "BAI", name: "iShares A.I. Innovation and Tech Active ETF", address: "0x9463b0ee32c1b40b7fda6459e815f0790159bc3a", usd: 44.59, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BLSHon", ticker: "BLSH", name: "Bullish", address: "0x334ccd8df4013bac99af8c5c61d3605b315302a0", usd: 36, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ATKRon", ticker: "ATKR", name: "Atkore", address: "0xb50a8bd8883dfe59eaf1a8b1130acd97ced9ac84", usd: 93.76, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AMEon", ticker: "AME", name: "AMETEK", address: "0x113fae6e1103a4c09250c8697a6a4be6ca987d06", usd: 237.72, liqUsd: 0, vol24Usd: 0 },
  { symbol: "APHon", ticker: "APH", name: "Amphenol", address: "0xd9c1b5df94063177cf168680b695a417919ae1ae", usd: 82.78, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CEVAon", ticker: "CEVA", name: "CEVA", address: "0xc4881ce8269744b9255b926b76728eadcb240a3b", usd: 26.95, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AOSLon", ticker: "AOSL", name: "Alpha and Omega Semiconductor", address: "0x55025c1e2acfe5a7092cf32f7a4f351a9fd21e1c", usd: 25.2, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BLCRon", ticker: "BLCR", name: "iShares Large Cap Core Active ETF", address: "0x08d777b6a82c8dee715848702f72dad4c2504687", usd: 49.87, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BRTRon", ticker: "BRTR", name: "iShares Total Return Active ETF", address: "0x3d45d340a30f49f036142e5e4d8993b9ad4e3f9a", usd: 49.231, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BRHYon", ticker: "BRHY", name: "iShares High Yield Active ETF", address: "0xaeb2c4f3540a162045cc3bd82d367ac38c2f4da6", usd: 50.735, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BRLNon", ticker: "BRLN", name: "iShares Floating Rate Loan Active ETF", address: "0xfcba0eebbb946ff933c91d2ddb2991845a400f39", usd: 50.89, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ACLSon", ticker: "ACLS", name: "Axcelis Technologies", address: "0x6785ce8060655b1f4991c3893dc41814154a1808", usd: 115.08, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BWETon", ticker: "BWET", name: "Breakwave Tanker Shipping ETF", address: "0xeca55ac71f83931b7e074228aebc9104f13d8c02", usd: 505.17, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BKCHon", ticker: "BKCH", name: "Global X Blockchain ETF", address: "0xdd00b1046692aa2780ef04849829609fc4f90fd7", usd: 74.91, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ACMRon", ticker: "ACMR", name: "ACM Research", address: "0x8379c5595b8148a9968bee6d8110b2b4a627a9dd", usd: 74.44, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ADIon", ticker: "ADI", name: "Analog Devices", address: "0x2ddc2391cc89e3e716a938f089ae755174cfdf1f", usd: 362.25, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CAMTon", ticker: "CAMT", name: "Camtek", address: "0xc087ea645a1efe021577c19413fbe39d617a3196", usd: 145.72, liqUsd: 0, vol24Usd: 0 },
  { symbol: "GRNDon", ticker: "GRND", name: "Grindr", address: "0xe5b26ba77e6a4d79a7c54a5296d81254269d9700", usd: 15.25, liqUsd: 0, vol24Usd: 0 },
  { symbol: "AIon", ticker: "AI", name: "C3.ai", address: "0x4554ad55cca5e7cb97b77813f486aaf6d4d9ab62", usd: 10.46, liqUsd: 0, vol24Usd: 0 },
  { symbol: "APDon", ticker: "APD", name: "Air Products & Chemicals", address: "0x6fafa492d5afbfd1a7328cd697164daaf08a0420", usd: 301.27, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ARon", ticker: "AR", name: "Antero Resources", address: "0xd7c740449090cd8864f1980076aff0b5f4561412", usd: 39.41, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ARRYon", ticker: "ARRY", name: "Array Technologies", address: "0x673f8d2e5f05c17baba0c86e1aaba99f2d7f9e1a", usd: 4.6, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ASXon", ticker: "ASX", name: "ASE Technology Holding", address: "0x94912d9f8ef1108ca605a6f5331a0da0294adfe0", usd: 37.51, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ATOMon", ticker: "ATOM", name: "Atomera", address: "0xa36182b7fc5cbd88ca8231b85195fdebde8646d9", usd: 4.04, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BATLon", ticker: "BATL", name: "Battalion Oil", address: "0x9af688db5fc6e34ce98cdac29cf977cf9d1ac204", usd: 1.29, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BHPon", ticker: "BHP", name: "BHP Group", address: "0xa2cbcd28f87bdf6ae1321818758f19402e97f3f1", usd: 90.42, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BIRDon", ticker: "BIRD", name: "Allbirds", address: "0xa310a90bb0929c577fc26095f41a381dbf9cba0f", usd: 2.52, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BKKTon", ticker: "BKKT", name: "Bakkt Holdings", address: "0x9e411a38ff3e6a3fede4ec2bac1da74e3203e4f8", usd: 8.33, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BTBTon", ticker: "BTBT", name: "Bit Digital", address: "0xfbc17997ce549373d3bd245f56908fb124a2723b", usd: 1.64, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BWXTon", ticker: "BWXT", name: "BWX Technologies", address: "0x5b82827a5fb24abad3bc542d48e59eb0a7fee148", usd: 157.59, liqUsd: 0, vol24Usd: 0 },
  { symbol: "BXSLon", ticker: "BXSL", name: "Blackstone Secured Lending Fund", address: "0x55b184974bf20fe41db42526bb15f33f35e57a47", usd: 24.72, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CDNSon", ticker: "CDNS", name: "Cadence Design Systems", address: "0x807c00e3a4b4e1e660a8d36e8dffe68448f95913", usd: 292.7, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CFon", ticker: "CF", name: "CF Industries Holdings", address: "0xd955d0f9907c3949345dd859d9cbb866f05c7eb8", usd: 133.35, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CGNXon", ticker: "CGNX", name: "Cognex", address: "0xc1715ee24c8f4a41f2d10143a320fa1d151ba22b", usd: 62.25, liqUsd: 0, vol24Usd: 0 },
  { symbol: "CMCSAon", ticker: "CMCSA", name: "Comcast", address: "0x85fd8dfd987988ede1777935d9d09c7ac7f09f0b", usd: 26.49, liqUsd: 0, vol24Usd: 0 },
  { symbol: "MSon", ticker: "MS", name: "Morgan Stanley", address: "0xb7cba7593baafffc96f9bbc86e578026369dec55", usd: 217.72, liqUsd: 0, vol24Usd: 0 },
  { symbol: "SONYon", ticker: "SONY", name: "Sony", address: "0xaf1382692f9927fd6a6c25add60285628a1879e5", usd: 24.56, liqUsd: 0, vol24Usd: 0 },
  { symbol: "ULon", ticker: "UL", name: "Unilever", address: "0x1598f7d25d0b0e1261eab9bd2ad7924291eb26bb", usd: 64.2, liqUsd: 0, vol24Usd: 0 },
];

export const stockByAddress = (addr?: string): Stock | undefined =>
  addr ? STOCKS.find((s) => s.address === addr.toLowerCase()) : undefined;

const KEY_T = { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] } as const;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO_KEY = { currency0: ZERO, currency1: ZERO, fee: 0, tickSpacing: 0, hooks: ZERO };

/** The router's encoded route for a pair: abi.encode(bytes v3Path, PoolKey v4Key).
 *  Empty for WETH. Null when the stock has no usable pool (pay in the stock). */
export function routeFor(pair: Address): Hex | null {
  if (pair.toLowerCase() === WETH) return "0x";
  const s = stockByAddress(pair);
  if (!s?.route) return null;
  const via = STABLE[s.route.via];
  if (s.route.kind === "v3") {
    const path = via === WETH
      ? encodePacked(["address", "uint24", "address"], [WETH, s.route.fee, pair])
      : encodePacked(["address", "uint24", "address", "uint24", "address"], [WETH, WETH_STABLE_FEE, via, s.route.fee, pair]);
    return encodeAbiParameters([{ type: "bytes" }, KEY_T], [path, ZERO_KEY]);
  }
  const path = via === WETH ? "0x" : encodePacked(["address", "uint24", "address"], [WETH, WETH_STABLE_FEE, via]);
  const [c0, c1] = [via, pair].map((a) => a.toLowerCase()).sort() as [Address, Address];
  const key = { currency0: c0, currency1: c1, fee: s.route.fee, tickSpacing: s.route.tickSpacing ?? 60, hooks: (s.route.hooks ?? ZERO) as Address };
  return encodeAbiParameters([{ type: "bytes" }, KEY_T], [path, key]);
}

/** True when ETH can be routed into and out of this pair on-chain. */
export const hasEthRoute = (pair: Address) => routeFor(pair) !== null;
