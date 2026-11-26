import { defineChain } from "viem";

export const RPC = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export const CHAIN = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

// contracts/deployments/stocklend.json
export const MARKET = "0x5E07b6663e40e973F5Ef304D9f095b6a18d498E7" as const;
export const ORACLE = "0x1e779b64A0D6C83BedA478bffF71A93eb6F45A40" as const;
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;

export interface StockDef {
  sym: string;
  name: string;
  address: `0x${string}`;
  pool: `0x${string}`;
}

export const STOCKS: StockDef[] = [
  { sym: "TSLA", name: "Tesla", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", pool: "0xf4ACdAEEB7022862A763C9B1B885e11191c889E3" },
  { sym: "AAPL", name: "Apple", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", pool: "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D" },
  { sym: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3" },
  { sym: "AMZN", name: "Amazon", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", pool: "0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef" },
];

export const WC_PROJECT_ID = "e1bda672d5deb56579fe084dddfb9174";
export const BRAND = { name: "Borrowhood", url: "https://borrowhood.vercel.app", description: "Lend the stock, earn the stock. Securities lending on Robinhood Chain." };
