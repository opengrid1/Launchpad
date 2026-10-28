// Points the indexer and the site at a fresh Equo deployment: reads deployments/<TAG>-<chain>.json (default equo3)
// and rewrites, per chain, the factory / hook / router / coin deployer / coin creator in indexer/chains.json and
// stockpad-site/config.js, with the deployment's gen (3) and its first block as the indexer's start. Chains in the
// deployment but missing from those files (Ink) are added from scripts/equo2/chains.js.
//   node scripts/equo2/cutover.js            show what changes
//   node scripts/equo2/cutover.js --write    write the files
const fs = require("fs");
const path = require("path");
const { CHAINS } = require("./chains");

const TAG = process.env.EQUO_TAG || "equo3", GEN = Number(process.env.EQUO_GEN || 3);
const ROOT = path.join(__dirname, "../../..");
const KEY = { mainnet: "eth", base: "base", bsc: "bsc", arbitrum: "arbitrum", hyperevm: "hyper", monad: "monad", megaeth: "megaeth", unichain: "unichain", ink: "ink" };
const SITE_EXTRA = { ink: { blockSec: 1, code: "INK", name: "Ink", short: "Ink", native: "ETH", cg: "ethereum", logo: "/img/chains/ink.png", color: "#7132f5", explorer: "https://explorer.inkonchain.com", rpc: "https://rpc-gel.inkonchain.com" } };
const write = process.argv.includes("--write");

const deps = {};
for (const c of CHAINS) {
  const f = path.join(__dirname, `../../deployments/${TAG}-${c.name}.json`);
  if (!fs.existsSync(f)) { console.log(`no ${TAG} deployment on ${c.name}: left as it is`); continue; }
  const d = JSON.parse(fs.readFileSync(f, "utf8"));
  const k = d.contracts;
  if (!k.factory || !k.hook || !k.router || !k.coinDeployer || !k.coinCreator) throw new Error(`${c.name}: deployment incomplete`);
  deps[c.name] = { ...k, startBlock: d.startBlock || d.firstBlock || null, chain: c };
}

// ---- indexer/chains.json
const ip = path.join(ROOT, "indexer/chains.json");
const idx = JSON.parse(fs.readFileSync(ip, "utf8"));
for (const [name, d] of Object.entries(deps)) {
  const key = KEY[name];
  let e = idx.chains.find((x) => x.key === key);
  if (!e) {
    e = { key, name: SITE_EXTRA[key] ? SITE_EXTRA[key].name : key, chainId: d.chain.chainId, lzEid: d.chain.eid, native: "ETH", rpcs: [d.chain.rpc], maxRange: 1000, confirmations: 2, pollMs: 4000, poolManager: d.chain.poolManager, wrappedNative: d.chain.weth };
    idx.chains.push(e);
    console.log(`indexer: added ${key}`);
  }
  e.factory = d.factory; e.hook = d.hook; e.router = d.router; e.tokenDeployer = d.coinDeployer;
  e.v2 = { factory: d.factory, hook: d.hook, router: d.router, coinDeployer: d.coinDeployer, coinCreator: d.coinCreator, gen: GEN };
  if (d.startBlock) e.startBlock = d.startBlock;
  console.log(`indexer ${key}: factory ${d.factory}${d.startBlock ? " from block " + d.startBlock : ""}`);
}

// ---- stockpad-site/config.js: each chain's line holds v2:{factory,hook,router}
const sp = path.join(ROOT, "stockpad-site/config.js");
let site = fs.readFileSync(sp, "utf8");
for (const [name, d] of Object.entries(deps)) {
  const key = KEY[name];
  const v2 = `v2:{factory:'${d.factory}', hook:'${d.hook}', router:'${d.router}'}`;
  const re = new RegExp(`(\\{key:'${key}',[\\s\\S]*?)v2:\\{[^}]*\\}`);
  if (re.test(site)) { site = site.replace(re, `$1${v2}`); console.log(`site ${key}: ${d.factory}`); continue; }
  const x = SITE_EXTRA[key];
  if (!x) throw new Error(`site: no entry for ${key} and nothing to add it from`);
  const line = `    {key:'${key}', blockSec:${x.blockSec}, code:'${x.code}', name:'${x.name}', short:'${x.short}', chainId:${d.chain.chainId}, native:'${x.native}', cg:'${x.cg}', logo:'${x.logo}', color:'${x.color}', main:false, live:true,\n     rpc:'${x.rpc}', explorer:'${x.explorer}', lzEid:${d.chain.eid}, poolManager:'${d.chain.poolManager}', launchGas:8700000, ${v2}},\n`;
  site = site.replace(/(\n\s*\/\* Solana: launched by Equo)/, `\n${line.replace(/\n$/, "")}$1`);
  console.log(`site: added ${key}`);
}
site = site.replace(/launchGas:\d+/g, "launchGas:8700000");
if (!/\bgen:\s*\d/.test(site)) site = site.replace(/(\n\s*chains:\s*\[)/, `\n  /* gen: which deployment's coins the site lists (3: the fresh one with Solana and Ink) */\n  gen: ${GEN},$1`);
else site = site.replace(/\bgen:\s*\d+/, `gen: ${GEN}`);

if (write) {
  fs.writeFileSync(ip, JSON.stringify(idx, null, 1) + "\n");
  fs.writeFileSync(sp, site);
  console.log("written");
} else console.log("dry run: add --write");
