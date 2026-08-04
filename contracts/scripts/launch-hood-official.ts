import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

// Official token launch: same flow as launch-test-final but with on-chain
// metadata (logo + social links) baked into the token.
const NAME = process.env.T_NAME ?? "Copair";
const SYMBOL = process.env.T_SYMBOL ?? "COPAIR";
const PAIR = process.env.T_PAIR ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"; // WETH
const USD8 = BigInt(process.env.T_USD8 ?? "186322000000");
const TAX = Number(process.env.T_TAX ?? "100");

// Feather mark as a compact self-contained SVG data URI (board-dark tile).
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4CF28B"/><stop offset="1" stop-color="#15D262"/></linearGradient><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06BC52"/><stop offset="1" stop-color="#017C38"/></linearGradient></defs><rect width="256" height="256" fill="#07100a"/><g transform="translate(68 22) scale(1.0)"><path d="M76 10 L58 42 L69 42 Z" fill="url(#a)"/><path d="M76 10 L69 42 L90 30 Z" fill="url(#b)"/><path d="M72 48 L56 51 L40 94 L60 160 L63 152 Z" fill="url(#a)"/><path d="M72 48 L88 41 L95 86 L80 150 L60 160 L63 152 Z" fill="url(#b)"/><g stroke="#DBFCE7" stroke-opacity=".55" stroke-width="2.1" stroke-linecap="round" fill="none"><path d="M72 48 L61 156"/><path d="M76 10 L69 42"/></g><g stroke="#053B1E" stroke-opacity=".3" stroke-width="2" stroke-linecap="round" fill="none"><path d="M66 66 L48 82"/><path d="M64 92 L46 106"/><path d="M62 118 L50 130"/><path d="M70 66 L88 78"/><path d="M69 92 L90 104"/><path d="M67 118 L80 128"/></g><path d="M60 160 L57 170" stroke="url(#b)" stroke-width="3" stroke-linecap="round"/></g></svg>`;
const LOGO = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString("base64")}`;

const METADATA = JSON.stringify({
  description:
    "The official token of copair.fun, the launch-to-earn launchpad on Robinhood Chain. COPAIR trades against ETH with a flat 1% fee: 80% to the creator in ETH, 5% builds a real bid wall under the price, and snipers pay extra straight into the wall.",
  logo: LOGO,
  website: "https://www.copair.fun",
  twitter: "https://x.com/Copair_",
  telegram: "",
});

async function main() {
  const [signer] = await ethers.getSigners();
  const dep = JSON.parse(readFileSync(join(__dirname, "../deployments/robinhood-hood.json"), "utf8"));
  const factoryAddr = dep.contracts.factory as string;
  const factory = await ethers.getContractAt("HoodFactory", factoryAddr);
  const params = { name: NAME, symbol: SYMBOL, metadataURI: METADATA, pair: PAIR, taxBps: TAX, pairUsdPrice8: USD8 };
  const salt = ethers.hexlify(ethers.randomBytes(32));
  await (await factory.launch(params, salt)).wait();
  const coin = await factory.allTokens((await factory.totalTokens()) - 1n);
  console.log(`${SYMBOL}: ${coin}  pair=${PAIR}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
