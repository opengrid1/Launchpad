/* eslint-disable no-console */
// Launches one test coin on the mainnet Stonkreum factory, paired with NVDAon,
// with a small ETH first buy that exercises the ETH -> USDC -> NVDAon route.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=... ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... \
//     FACTORY=0x... [PAIR=0x...] [DEV_BUY=0.001] [NAME=...] [SYMBOL=...] \
//     npx hardhat run scripts/launch-test-eth.ts --network robinhood
import { ethers } from "hardhat";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const NVDA = "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE";
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [
  ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, USDC]),
  { currency0: NVDA, currency1: USDC, fee: 9000, tickSpacing: 90, hooks: ethers.ZeroAddress },
]);
const LOGO = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0D1017"/><polygon points="32,12 47,34 32,43 17,34" fill="#F1F2F5"/><polygon points="32,47 47,38 32,56 17,38" fill="#F1F2F5"/></svg>').toString("base64");

async function main() {
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("StockPadFactory", process.env.FACTORY!, signer);
  const pair = process.env.PAIR ?? NVDA;
  const route = pair.toLowerCase() === NVDA.toLowerCase() ? NVDA_ROUTE : "0x";
  const devBuy = ethers.parseEther(process.env.DEV_BUY ?? "0.001");
  const name = process.env.NAME ?? "Stonkreum Test";
  const symbol = process.env.SYMBOL ?? "STEST";
  const meta = JSON.stringify({ description: "First coin on Stonkreum. A test launch paired with NVDAon: every trade pays holders in NVIDIA.", logo: LOGO, twitter: "https://x.com/stonkreum" });
  console.log("signer", signer.address, "bal", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "pair", pair, "devBuy", ethers.formatEther(devBuy));
  const n = Number(await factory.totalTokens());
  const salt = ethers.zeroPadValue(ethers.toBeHex(BigInt(Date.now())), 32);
  const p = { name, symbol, metadataURI: meta, pair };
  const gas = await factory.launch.estimateGas(p, salt, route, { value: devBuy });
  console.log("estimated gas", gas.toString());
  const tx = await factory.launch(p, salt, route, { value: devBuy, gasLimit: (gas * 12n) / 10n });
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  const token = await factory.allTokens(n);
  console.log("launched", symbol, token, "block", rc!.blockNumber, "gasUsed", rc!.gasUsed.toString());
  const coin = await ethers.getContractAt("StockPadToken", token);
  console.log("creator holds", ethers.formatEther(await coin.balanceOf(signer.address)), symbol, "| bal left", ethers.formatEther(await ethers.provider.getBalance(signer.address)));
}
main().catch((e) => { console.error(e); process.exit(1); });
