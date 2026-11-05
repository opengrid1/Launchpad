// Verifies the BuzzPad v2 deployment on etherscan.io (Etherscan v2 API, chain 1): BuzzPadHook, BuzzPadFactory and
// the new LiquidFiLocker, compiled exactly as build/compile-buzzpad.cjs does. The standard-JSON input carries every
// source the compile read, so the metadata hash matches. Constructor arguments come from the deploy transactions.
//   node build/verify-buzzpad.cjs
// Reads ETHERSCAN_API_KEY from contracts/.env (never printed).
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const ROOT = path.join(__dirname, "..");
const KEY = (fs.readFileSync(path.join(ROOT, "../contracts/.env"), "utf8").match(/ETHERSCAN_API_KEY=([A-Za-z0-9]+)/) || [])[1];
if (!KEY) throw new Error("no ETHERSCAN_API_KEY in contracts/.env");
const API = "https://api.etherscan.io/v2/api?chainid=1";
const P = new ethers.JsonRpcProvider(process.env.ETH_RPC || "https://ethereum-rpc.publicnode.com", 1, { staticNetwork: true });
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments/buzzpad-v2-ethereum.json"), "utf8"));
const S = JSON.parse(fs.readFileSync(path.join(__dirname, "verified-settings.json"), "utf8"));
const art = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", n + ".json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function input() {
  const solc = require("solc"), CONTRACTS = path.join(ROOT, "contracts");
  const base = Object.values(S).find((s) => /MemeHook/.test(s.fullyQualifiedName)).settings;
  const files = [["liquidfi", "LiquidFiToken"], ["liquidfi", "LiquidFiLocker"], ["buzzpad", "BuzzPadHook"], ["buzzpad", "BuzzPadFactory"]];
  const sources = Object.fromEntries(files.map(([d, f]) => [`src/${d}/${f}.sol`, { content: fs.readFileSync(path.join(CONTRACTS, "src", d, f + ".sol"), "utf8") }]));
  const read = {};
  const findImports = (p) => { const f = [path.join(CONTRACTS, p), path.join(ROOT, p)].find((x) => fs.existsSync(x)); if (!f) return { error: "not found: " + p }; read[p] = fs.readFileSync(f, "utf8"); return { contents: read[p] }; };
  const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings: { ...base, outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } } }), { import: findImports }));
  if ((out.errors || []).some((e) => e.severity === "error")) throw new Error("compile failed");
  for (const [k, v] of Object.entries(read)) sources[k] = { content: v };
  return { input: { language: "Solidity", sources, settings: { ...base, outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } } } }, version: "v" + solc.version().replace(/\.Emscripten.*$/, "") };
}
async function ctorArgs(hash, artifact, viaCreate2) {
  let data = (await P.getTransaction(hash)).data;
  if (viaCreate2) data = "0x" + data.slice(2 + 64);
  const bc = art(artifact).bytecode; if (!data.toLowerCase().startsWith(bc.toLowerCase())) throw new Error(artifact + ": deploy input does not start with the artifact bytecode");
  return data.slice(bc.length);
}
const post = async (params) => (await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ apikey: KEY, ...params }) })).json();
async function status(guid) { for (let i = 0; i < 30; i++) { await sleep(5000); const r = await (await fetch(`${API}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${KEY}`)).json(); if (!/pending|queue/i.test(r.result || "")) return r.result; } return "still pending"; }
async function isVerified(a) { const r = await (await fetch(`${API}&module=contract&action=getsourcecode&address=${a}&apikey=${KEY}`)).json(); return r.result && r.result[0] && r.result[0].SourceCode ? r.result[0].ContractName : ""; }

(async () => {
  const J = input();
  for (const [name, addr, d, c2] of [["LiquidFiLocker", dep.locker, "liquidfi", false], ["BuzzPadHook", dep.hook, "buzzpad", true], ["BuzzPadFactory", dep.factory, "buzzpad", false]]) {
    const done = await isVerified(addr); if (done) { console.log(`${name.padEnd(16)} ${addr} already verified (${done})`); continue; }
    const args = await ctorArgs(dep.transactions[name], name, c2);
    let r;
    for (let t = 0; t < 5; t++) { r = await post({ module: "contract", action: "verifysourcecode", codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(J.input), contractaddress: addr, contractname: `src/${d}/${name}.sol:${name}`, compilerversion: J.version, constructorArguements: args.replace(/^0x/, "") }); if (!/rate limit|unable to locate/i.test(r.result || "")) break; await sleep(6000); }
    if (r.status !== "1") { console.log(`${name.padEnd(16)} ${addr} submit failed: ${r.result}`); continue; }
    console.log(`${name.padEnd(16)} ${addr} ${await status(r.result)}`);
    await sleep(1500);
  }
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
