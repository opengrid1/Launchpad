// Verifies a v2 deployment (deploy-v2.cjs output) on Sourcify, which needs no API key and feeds the chain's Blockscout
// explorer: the token implementation, locker (ZappyLocker with LEVERAGE), BuzzPadHook, BuzzPadFactory, and the
// ZappySwapper and ZappyMargin when the deployment has leverage. Compiled exactly as build/compile-buzzpad.cjs does;
// the standard-JSON input carries every source the compile read, so the metadata hash matches.
//   DEP=deployments/leverhook-v2-robinhood.json node build/verify-sourcify.cjs
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const dep = JSON.parse(fs.readFileSync(path.resolve(process.env.DEP || "deployments/leverhook-v2-robinhood.json"), "utf8"));
const API = process.env.SOURCIFY || "https://sourcify.dev/server";
const S = JSON.parse(fs.readFileSync(path.join(__dirname, "verified-settings.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function input() {
  const solc = require("solc"), CONTRACTS = path.join(ROOT, "contracts");
  const base = Object.values(S).find((s) => /MemeHook/.test(s.fullyQualifiedName)).settings;
  const files = [["liquidfi", "LiquidFiToken"], ["liquidfi", "LiquidFiLocker"], ["buzzpad", "BuzzPadHook"], ["buzzpad", "BuzzPadFactory"], ["zappy", "ZappyLocker"], ["zappy", "ZappySwapper"], ["zappy", "ZappyMargin"]];
  const sources = Object.fromEntries(files.map(([d, f]) => [`src/${d}/${f}.sol`, { content: fs.readFileSync(path.join(CONTRACTS, "src", d, f + ".sol"), "utf8") }]));
  const read = {};
  const findImports = (p) => { const f = [path.join(CONTRACTS, p), path.join(ROOT, p)].find((x) => fs.existsSync(x)); if (!f) return { error: "not found: " + p }; read[p] = fs.readFileSync(f, "utf8"); return { contents: read[p] }; };
  const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings: { ...base, outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } } } }), { import: findImports }));
  if ((out.errors || []).some((e) => e.severity === "error")) throw new Error("compile failed");
  for (const [k, v] of Object.entries(read)) sources[k] = { content: v };
  return { input: { language: "Solidity", sources, settings: { ...base, outputSelection: { "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] } } } }, version: solc.version().replace(/\.Emscripten.*$/, "") };
}

(async () => {
  const J = input(), chain = dep.chainId, lev = dep.leverage || {};
  const lockerName = dep.transactions.ZappyLocker ? "ZappyLocker" : "LiquidFiLocker";
  const list = [
    ...(dep.transactions.LiquidFiToken ? [["liquidfi", "LiquidFiToken", dep.tokenImplementation]] : []),
    [lockerName === "ZappyLocker" ? "zappy" : "liquidfi", lockerName, dep.locker],
    ["buzzpad", "BuzzPadHook", dep.hook], ["buzzpad", "BuzzPadFactory", dep.factory],
    ...(lev.swapper ? [["zappy", "ZappySwapper", lev.swapper]] : []), ...(lev.margin ? [["zappy", "ZappyMargin", lev.margin]] : []),
  ];
  let bad = 0;
  for (const [d, name, addr] of list) {
    const have = await (await fetch(`${API}/v2/contract/${chain}/${addr}`)).json().catch(() => ({}));
    if (have.match) { console.log(`${name.padEnd(15)} ${addr} already verified (${have.match})`); continue; }
    const r = await (await fetch(`${API}/v2/verify/${chain}/${addr}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ stdJsonInput: J.input, compilerVersion: J.version, contractIdentifier: `src/${d}/${name}.sol:${name}`, creationTransactionHash: dep.transactions[name] }) })).json();
    if (!r.verificationId) { bad++; console.log(`${name.padEnd(15)} ${addr} submit failed: ${JSON.stringify(r).slice(0, 300)}`); continue; }
    let j = {};
    for (let i = 0; i < 60; i++) { await sleep(5000); j = await (await fetch(`${API}/v2/verify/${r.verificationId}`)).json(); if (j.isJobCompleted) break; }
    const m = j.contract && j.contract.match;
    if (!m) bad++;
    console.log(`${name.padEnd(15)} ${addr} ${m ? "verified (" + m + ")" : "failed: " + JSON.stringify(j.error || j).slice(0, 300)}`);
  }
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
