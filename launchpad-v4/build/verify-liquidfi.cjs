// Verifies the LiquidFi deployment's source on the chain's Etherscan-family explorer (Etherscan v2 API; HyperEVM is
// chain 999 on hyperevmscan.io): the Pons fee escrow and buyback vault with the settings they were verified with on
// Robinhood Chain, the LiquidFi token, hook, locker and factory with build/compile-liquidfi.cjs's settings. Each
// standard-JSON input carries every source the compile read, under the same keys, so the metadata hash matches.
// Constructor arguments come from the deploy transactions themselves. Then marks launched tokens (EIP-1167 clones of
// the token implementation) as proxies.
//   node build/verify-liquidfi.cjs [hyperevm] [token addresses...]
// Reads ETHERSCAN_API_KEY from contracts/.env (never printed).
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const ROOT = path.join(__dirname, "..");
// the HyperLend RPC keeps old transactions; the official one may not serve them
const NETS = { hyperevm: { chainId: 999, rpc: "https://rpc.hyperlend.finance" } };
const net = process.argv[2] && NETS[process.argv[2]] ? process.argv[2] : "hyperevm", N = NETS[net];
const extraTokens = process.argv.slice(2).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const KEY = (fs.readFileSync(path.join(ROOT, "../contracts/.env"), "utf8").match(/ETHERSCAN_API_KEY=([A-Za-z0-9]+)/) || [])[1];
if (!KEY) throw new Error("no ETHERSCAN_API_KEY in contracts/.env");
const API = `https://api.etherscan.io/v2/api?chainid=${N.chainId}`;
const P = new ethers.JsonRpcProvider(N.rpc, N.chainId, { staticNetwork: true });
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `liquidfi-${net}.json`), "utf8"));
const prog = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", `liquidfi-${net}.progress.json`), "utf8")).steps;
const S = JSON.parse(fs.readFileSync(path.join(__dirname, "verified-settings.json"), "utf8"));
const art = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", n + ".json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the standard JSON for the LiquidFi files: compile once with an import callback that records every file it reads
function liquidfiInput() {
  const solc = require("solc"), CONTRACTS = path.join(ROOT, "contracts");
  const hook = Object.values(S).find((s) => /MemeHook/.test(s.fullyQualifiedName)).settings;
  const files = ["LiquidFiToken", "LiquidFiHook", "LiquidFiLocker", "LiquidFiFactory"];
  const sources = Object.fromEntries(files.map((f) => [`src/liquidfi/${f}.sol`, { content: fs.readFileSync(path.join(CONTRACTS, "src/liquidfi", f + ".sol"), "utf8") }]));
  const read = {};
  const findImports = (p) => { const f = [path.join(CONTRACTS, p), path.join(ROOT, p)].find((x) => fs.existsSync(x)); if (!f) return { error: "not found: " + p }; read[p] = fs.readFileSync(f, "utf8"); return { contents: read[p] }; };
  const settings = { ...hook, outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } };
  const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings }), { import: findImports }));
  if ((out.errors || []).some((e) => e.severity === "error")) throw new Error("compile failed");
  for (const [k, v] of Object.entries(read)) sources[k] = { content: v };
  return { input: { language: "Solidity", sources, settings: { ...hook, outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } } } }, version: "v" + solc.version().replace(/\.Emscripten.*$/, "") };
}
function ponsInput(name) {
  const s = S[name];
  const resolve = (p) => [path.join(ROOT, p), path.join(__dirname, "locker-unit", p), path.join(ROOT, "contracts", p)].find((f) => fs.existsSync(f));
  return { input: { language: "Solidity", sources: Object.fromEntries(s.sources.map((p) => [p, { content: fs.readFileSync(resolve(p), "utf8") }])), settings: s.settings }, version: "v" + s.compilerVersion, fq: s.fullyQualifiedName };
}
async function ctorArgs(step, artifact, viaCreate2) {
  const tx = await P.getTransaction(prog[step].hash); let data = tx.data;
  if (viaCreate2) data = "0x" + data.slice(2 + 64); // the CREATE2 deployer's input is salt ++ initcode
  const bc = art(artifact).bytecode; if (!data.toLowerCase().startsWith(bc.toLowerCase())) throw new Error(step + ": deploy input does not start with the artifact bytecode");
  return data.slice(bc.length);
}
async function post(params) {
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ apikey: KEY, ...params }) });
  return r.json();
}
async function status(guid, action = "checkverifystatus") {
  for (let i = 0; i < 30; i++) { await sleep(5000); const r = await (await fetch(`${API}&module=contract&action=${action}&guid=${guid}&apikey=${KEY}`)).json(); if (!/pending|queue/i.test(r.result || "")) return r.result; }
  return "still pending";
}
async function isVerified(addr) { const r = await (await fetch(`${API}&module=contract&action=getsourcecode&address=${addr}&apikey=${KEY}`)).json(); return r.result && r.result[0] && r.result[0].SourceCode ? r.result[0].ContractName : ""; }

(async () => {
  const L = liquidfiInput();
  const jobs = [
    ["PonsV2FeeEscrow", dep.feeEscrow, ponsInput("PonsV2FeeEscrow"), "PonsV2FeeEscrow", false],
    ["LiquidFiHook", dep.hook, { ...L, fq: "src/liquidfi/LiquidFiHook.sol:LiquidFiHook" }, "LiquidFiHook", true],
    ["PonsV2BuybackVault", dep.buybackVault, ponsInput("PonsV2BuybackVault"), "PonsV2BuybackVault", false],
    ["LiquidFiLocker", dep.locker, { ...L, fq: "src/liquidfi/LiquidFiLocker.sol:LiquidFiLocker" }, "LiquidFiLocker", false],
    ["LiquidFiToken", dep.tokenImplementation, { ...L, fq: "src/liquidfi/LiquidFiToken.sol:LiquidFiToken" }, "LiquidFiToken", false],
    ["LiquidFiFactory", dep.factory, { ...L, fq: "src/liquidfi/LiquidFiFactory.sol:LiquidFiFactory" }, "LiquidFiFactory", false],
  ];
  for (const [step, addr, J, artifact, c2] of jobs) {
    const done = await isVerified(addr); if (done) { console.log(`${step.padEnd(20)} ${addr} already verified (${done})`); continue; }
    const args = await ctorArgs(step, artifact, c2);
    const r = await post({ module: "contract", action: "verifysourcecode", codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(J.input), contractaddress: addr, contractname: J.fq, compilerversion: J.version, constructorArguements: args.replace(/^0x/, "") });
    if (r.status !== "1") { console.log(`${step.padEnd(20)} ${addr} submit failed: ${r.result}`); continue; }
    console.log(`${step.padEnd(20)} ${addr} ${await status(r.result)}`);
  }
  // launched tokens: EIP-1167 clones of the implementation
  const tokens = [...new Set(extraTokens.map((a) => ethers.getAddress(a)))];
  for (const t of tokens) {
    const r = await post({ module: "contract", action: "verifyproxycontract", address: t, expectedimplementation: dep.tokenImplementation });
    console.log(`proxy ${t} ${r.status === "1" ? await status(r.result, "checkproxyverification") : r.result}`);
  }
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
