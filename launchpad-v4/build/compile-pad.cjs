// Compiles the Pad launchpad stack (contracts/src/pad): token, hook, locker, factory, fee escrow, buyback vault,
// splitter and staking, with the settings the hook lineage was verified with (solc 0.8.35, viaIR, optimizer 200,
// cancun) and writes artifacts/<Name>.json.
//   node build/compile-pad.cjs
const fs = require("fs"), path = require("path");
const solc = require("solc");
const ROOT = path.join(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");
const S = JSON.parse(fs.readFileSync(path.join(__dirname, "verified-settings.json"), "utf8"));
const hookSettings = Object.values(S).find((s) => /MemeHook/.test(s.fullyQualifiedName)).settings;
const FILES = ["PadToken", "PadHook", "PadLocker", "PadFactory", "PadFeeEscrow", "PadBuybackVault", "PadSplitter", "PadStaking"];
const sources = Object.fromEntries(FILES.map((f) => [`src/pad/${f}.sol`, { content: fs.readFileSync(path.join(CONTRACTS, "src/pad", f + ".sol"), "utf8") }]));
const findImports = (p) => { const f = [path.join(CONTRACTS, p), path.join(ROOT, p)].find((x) => fs.existsSync(x)); return f ? { contents: fs.readFileSync(f, "utf8") } : { error: "not found: " + p }; };
const settings = { ...hookSettings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } };
const t0 = Date.now();
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings }), { import: findImports }));
const errs = (out.errors || []).filter((e) => e.severity === "error");
for (const w of (out.errors || []).filter((e) => e.severity !== "error" && e.sourceLocation && e.sourceLocation.file.startsWith("src/pad"))) console.log("warning: " + w.formattedMessage.split("\n")[0]);
if (errs.length) { console.log(errs.map((e) => e.formattedMessage).join("\n")); process.exit(1); }
fs.mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
let bad = 0;
for (const f of FILES) {
  const c = out.contracts[`src/pad/${f}.sol`][f];
  const size = c.evm.deployedBytecode.object.length / 2;
  if (size > 24576) bad++;
  fs.writeFileSync(path.join(ROOT, "artifacts", f + ".json"), JSON.stringify({ contractName: f, sourceName: `src/pad/${f}.sol`, compiler: solc.version(), abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, deployedBytecode: "0x" + c.evm.deployedBytecode.object }, null, 1));
  console.log(`${f.padEnd(18)} ${String(size).padStart(6)} B runtime${size > 24576 ? "  !! over the 24,576 B limit" : ""}`);
}
console.log(`solc ${solc.version().split("+")[0]} in ${((Date.now() - t0) / 1000).toFixed(1)}s${bad ? `, ${bad} over size` : ""}`);
process.exit(bad ? 1 : 0);
