// One coin on every EVM chain, the way the launch service will do it: the same creator and launch salt on each
// chain give the same coin address everywhere; each launch wires the other chains as peers (sealed at launch);
// `split` shares the 1B supply across all of the coin's chains (Solana included when it is one of them).
// On chains whose oracle is an EquoPriceBook, the native coin's USD price is posted first (the signer must be an
// approved updater). Plain ethers, one provider per chain; the key comes from contracts/.env.deployer.
//
//   EQUO_CONFIRM_MULTI=1 npx ts-node --transpile-only scripts/launch-equo-multichain.ts \
//     --name "Equo Nine" --symbol NINE --split 9 [--chains eth,base,...] [--only base,...] [--salt <text>] [--check]
//
// --check only predicts the address and checks prices, balances and updater rights; nothing is sent.
import { ethers } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";

const arg = (k: string, d = "") => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k: string) => process.argv.includes("--" + k);

type Chain = { key: string; net: string; rpc: string; cg: string; eid: number; minFirstBuy: string };
const CHAINS_: Chain[] = [
  { key: "eth", net: "mainnet", rpc: "https://ethereum-rpc.publicnode.com", cg: "ethereum", eid: 30101, minFirstBuy: "0.001" },
  { key: "base", net: "base", rpc: "https://mainnet.base.org", cg: "ethereum", eid: 30184, minFirstBuy: "0.001" },
  { key: "bsc", net: "bsc", rpc: "https://bsc-dataseed.bnbchain.org", cg: "binancecoin", eid: 30102, minFirstBuy: "0.003" },
  { key: "arbitrum", net: "arbitrum", rpc: "https://arb1.arbitrum.io/rpc", cg: "ethereum", eid: 30110, minFirstBuy: "0.001" },
  { key: "hyper", net: "hyperevm", rpc: "https://rpc.hyperliquid.xyz/evm", cg: "hyperliquid", eid: 30367, minFirstBuy: "0.03" },
  { key: "monad", net: "monad", rpc: "https://rpc.monad.xyz", cg: "monad", eid: 30390, minFirstBuy: "100" },
  { key: "megaeth", net: "megaeth", rpc: "https://megaeth.drpc.org", cg: "ethereum", eid: 30398, minFirstBuy: "0.001" },
  { key: "unichain", net: "unichain", rpc: "https://mainnet.unichain.org", cg: "ethereum", eid: 30320, minFirstBuy: "0.001" },
];
// <KEY>_RPC overrides a chain's RPC (e.g. UNICHAIN_RPC, MEGAETH_RPC)
const CHAINS = CHAINS_.map((c) => ({ ...c, rpc: process.env[`${c.key.toUpperCase()}_RPC`] || c.rpc }));

const FACTORY_ABI = [
  "function launch((string name,string symbol,string metadataURI,address pair,uint256 minPairOut,uint8 capPreset,(uint8 feeMode,uint16 feeBps,uint16 snipeBps,uint32 snipeBlocks,uint16 buybackShareBps,uint16 divShareBps,uint16 maxWalletBps,uint32 maxWalletSecs,uint128 buybackThreshold) genes,(uint64 mcapUsd8,(uint8 feeMode,uint16 feeBps,uint16 snipeBps,uint32 snipeBlocks,uint16 buybackShareBps,uint16 divShareBps,uint16 maxWalletBps,uint32 maxWalletSecs,uint128 buybackThreshold) genes)[] stages,uint8 split) p, bytes32 salt, bytes route, bytes peers) payable returns (address token, bytes32 poolId)",
  "function minFirstBuy() view returns (uint256)",
  "function weth() view returns (address)",
  "event Launched(address indexed token, address indexed creator, address indexed pair, bytes32 poolId, uint256 pairUsdPrice)",
];
const TD_ABI = ["function predict(bytes32 salt, address pairAsset, bool dividends) view returns (address a, bytes32 s)"];
const BOOK_ABI = ["function updaters(address) view returns (bool)", "function setPrices(address[] tokens, uint256[] usd18)", "function maxAge() view returns (uint256)"];

async function main() {
  const name = arg("name"), symbol = arg("symbol"), split = Number(arg("split", "9"));
  if (!name || !symbol) throw new Error("--name and --symbol are required");
  const keys = arg("chains") ? arg("chains").split(",") : CHAINS.map((c) => c.key);
  const chains = CHAINS.filter((c) => keys.includes(c.key));
  const check = flag("check");
  if (!check && process.env.EQUO_CONFIRM_MULTI !== "1") throw new Error("set EQUO_CONFIRM_MULTI=1 to launch for real (or pass --check)");
  const key = readFileSync(join(__dirname, "../.env.deployer"), "utf8").match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)![1];
  const salt = ethers.id(arg("salt", `equo-multi-${symbol}-${Date.now()}`));
  const meta = JSON.stringify({ description: arg("desc", "Equo multichain test coin. Not an investment."), image: arg("image", "https://equo-fun.vercel.app/img/apple-touch-icon.png"), website: "https://equo-fun.vercel.app" });
  const genes = { feeMode: 0, feeBps: Number(arg("fee", "100")), snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };

  const usd = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${[...new Set(chains.map((c) => c.cg))].join(",")}&vs_currencies=usd`)).json();
  // every chain's coin lands at the same address: the token deployer's prediction, the same everywhere
  const dep = (c: Chain) => JSON.parse(readFileSync(join(__dirname, `../deployments/equo-${c.net}.json`), "utf8"));
  const tdAddr = dep(chains[0]).contracts.tokenDeployer;
  const p0 = new ethers.JsonRpcProvider(chains[0].rpc, undefined, { staticNetwork: true });
  const wallet0 = new ethers.Wallet(key);
  const creatorSalt = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [wallet0.address, salt]));
  const [coin] = await new ethers.Contract(tdAddr, TD_ABI, p0).predict(creatorSalt, dep(chains[0]).contracts.weth, false);
  console.log(`${name} ($${symbol}), split ${split}, coin ${coin} on ${chains.map((c) => c.key).join(", ")}`);

  // --only re-runs a subset (same --salt) while the peers stay the full --chains set
  const only = arg("only") ? arg("only").split(",") : null;
  for (const c of chains) {
    if (only && !only.includes(c.key)) continue;
    const d = dep(c), p = new ethers.JsonRpcProvider(c.rpc, d.chainId, { staticNetwork: true }), w = new ethers.Wallet(key, p);
    if (d.contracts.tokenDeployer.toLowerCase() !== tdAddr.toLowerCase()) throw new Error(`${c.key}: token deployer differs`);
    const factory = new ethers.Contract(d.contracts.factory, FACTORY_ABI, w);
    const first = ethers.parseEther(c.minFirstBuy);
    const bal = await p.getBalance(w.address);
    const peers = chains.filter((o) => o.key !== c.key);
    const peerData = peers.length ? ethers.AbiCoder.defaultAbiCoder().encode(["uint32[]", "bytes32[]"], [peers.map((o) => o.eid), peers.map(() => ethers.zeroPadValue(coin, 32))]) : "0x";
    const usd18 = ethers.parseEther(String(usd[c.cg].usd));
    let book = "";
    if (c.key !== "eth") {
      book = d.contracts.oracle;
      const ok = await new ethers.Contract(book, BOOK_ABI, p).updaters(w.address);
      console.log(`${c.key.padEnd(9)} balance ${ethers.formatEther(bal)}, first buy ${c.minFirstBuy}, price $${usd[c.cg].usd}, updater ${ok ? "yes" : "NO"}`);
      if (!ok) { if (check) continue; throw new Error(`${c.key}: ${w.address} is not an approved price updater (admin: /admin-setup)`); }
    } else console.log(`${c.key.padEnd(9)} balance ${ethers.formatEther(bal)}, first buy ${c.minFirstBuy}, oracle price`);
    if (check) continue;
    if (book) {
      await (await new ethers.Contract(book, BOOK_ABI, w).setPrices([d.contracts.weth], [usd18])).wait();
      await new Promise((r) => setTimeout(r, 5000)); // load-balanced RPCs can lag the price behind the receipt
    }
    const p_ = { name, symbol, metadataURI: meta, pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [], split };
    // ethers caps the fee at twice the base fee, which a balance sized for the launch may not cover; when it
    // doesn't, lower the cap to what the balance pays, as long as it still clears the base fee with room
    const gas = ((await factory.launch.estimateGas(p_, salt, "0x", peerData, { value: first })) * 11n) / 10n;
    const fd = await p.getFeeData();
    const ov: any = { value: first, gasLimit: gas };
    if (fd.maxFeePerGas && gas * fd.maxFeePerGas + first > (await p.getBalance(w.address))) {
      const base = (await p.getBlock("latest"))!.baseFeePerGas ?? 0n;
      const cap = ((await p.getBalance(w.address)) - first) / gas;
      if (cap < (base * 12n) / 10n) throw new Error(`${c.key}: balance too low for gas (cap ${cap}, base fee ${base})`);
      ov.maxFeePerGas = cap;
      ov.maxPriorityFeePerGas = fd.maxPriorityFeePerGas! < cap - base ? fd.maxPriorityFeePerGas : cap - base;
    }
    const tx = await factory.launch(p_, salt, "0x", peerData, ov);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "Launched") as any;
    const got = ev.args.token as string;
    console.log(`  launched ${got} in ${rc!.hash}${got.toLowerCase() === coin.toLowerCase() ? "" : "  ADDRESS MISMATCH"}`);
  }
  console.log(`\ncoin ${coin}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
