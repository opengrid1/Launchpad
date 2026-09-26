import { ethers } from "ethers";
const RPC = "https://rpc-gel.inkonchain.com";
const p = new ethers.JsonRpcProvider(RPC, 57073);
const FACTORY = "0x640887a9ba3a9c53ed27d0f7e8246a4f933f3424";
const WETH = "0x4200000000000000000000000000000000000006";
const USDG = "0xe343167631d89B6Ffc58B88d6b7fB0228795491D";
const USDT0 = "0x0200C29006150606B650577BBE7B6248F58470c1";
const ERC20 = ["function symbol() view returns (string)", "function decimals() view returns (uint8)"];
const FAB = ["function getPool(address,address,uint24) view returns (address)"];
const POOL = ["function liquidity() view returns (uint128)"];
const fab = new ethers.Contract(FACTORY, FAB, p);
const TOKENS = {
  NVDAX: "0xc845b2894dBddd03858fd2D643B4eF725fE0849d", SPYx: "0x90A2a4c76b5D8c0bc892A69EA28Aa775a8f2dD48",
  TSLAx: "0x8aD3c73F833d3F9A523aB01476625F269aEB7Cf0", QQQx: "0xa753A7395cAe905Cd615Da0B82A53E0560f250af",
  AAPLx: "0x9d275685dC284C8eB1C79f6ABA7a63Dc75ec890a", GOOGLx: "0xe92f673Ca36C5E2Efd2DE7628f815f84807e803F",
  METAx: "0x96702be57Cd9777f835117a809C7124fe4ec989A", MSTRx: "0xAE2f842EF90C0d5213259Ab82639D5BBF649b08E",
  MSFTx: "0x5621737f42dAE558b81269FcB9E9E70c19Aa6b35", SPCXx: "0x68fa48B1C2FE52b3D776E1953e0E782b5044Ce28",
  STRCx: "0x1Aad217B8F78dbA5E6693460e8470F8b1A3977f3", GLDx: "0x2380F2673C640fB67E2d6B55B44C62F0E0e69DA9",
  CRCLx: "0xfEbDEd1B0986a8ee107f5AB1a1c5a813491DeCEB", AMZNx: "0x3557Ba345B01EFa20A1bdDC61F573BFD87195081",
  wNVDAx: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", wSPYx: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540",
  wAAPLx: "0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f", wQQQx: "0x4C1AE29c159838fC1b224636E28E086EB69101f7",
  wTSLAx: "0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171", wGOOGLx: "0xf8c5308F80E459bb53d9EbE689854d9cBb2Caa6f",
  wMETAx: "0xe840946FfEBCd66B7C4E95095effaFaDfa0D0e56", wMSTRx: "0x30987adF0B11dc698438a99BA04ec3a1AB2c7EaB",
  wMSFTx: "0x166Fbe68274b6a47e025F4ba17388c539f1fa1d0", wNFLXx: "0x7d87fD6A379714194a797c0bBB8B40c30D250856",
  wPLTRx: "0x4A2df09536F62341C9f946427D16414C04e21342",
  USDG: USDG, USDT0: USDT0, KBTC: "0x73E0C0d45E048D25Fc26Fa3159b0aA04BfA4Db98",
  USDC: "0x2D270e6886d130D724215A266106e6832161EAEd", "USDC.E": "0xF1815bd50389c46847f0Bda824eC8da914045D14",
  WEETH: "0xA3D68b74bF0528fdD07263c60d6488749044914b",
};
const QUOTES = [["WETH", WETH], ["USDG", USDG], ["USDT0", USDT0]];
const TIERS = [100, 500, 3000, 10000];
for (const [name, addr] of Object.entries(TOKENS)) {
  let sym = "?", dec = "?";
  try {
    const c = new ethers.Contract(addr, ERC20, p);
    [sym, dec] = await Promise.all([c.symbol(), c.decimals()]);
  } catch { console.log(`${name}: NOT A TOKEN / no code`); continue; }
  const lines = [];
  for (const [qn, qa] of QUOTES) {
    if (qa.toLowerCase() === addr.toLowerCase()) continue;
    for (const t of TIERS) {
      try {
        const pool = await fab.getPool(addr, qa, t);
        if (pool !== ethers.ZeroAddress) {
          const liq = await new ethers.Contract(pool, POOL, p).liquidity();
          if (liq > 0n) lines.push(`vs ${qn} @${t / 10000}% liq=${liq}`);
        }
      } catch {}
    }
  }
  console.log(`${name} (${sym}, ${dec}d): ${lines.length ? lines.join(" | ") : "no live UniV3 pool"}`);
}
