// Compiles the BuzzPad v2 contracts (contracts/src/buzzpad, plus the LiquidFi token and locker they reuse) with the settings the Pons v2 hook was verified with
// (solc 0.8.35, viaIR, optimizer 200, cancun) and writes artifacts/<Name>.json. The Pons fee escrow and buyback
// vault are used as built by build/compile.cjs (byte-identical to Robinhood Chain); run that first.
//   node build/compile-liquidfi.cjs
const fs = require("fs"), path = require("path");
const solc = require("solc");
const ROOT = path.join(__dirname, "..");
const CONTRACTS = path.join(ROOT, "contracts");
const S = JSON.parse(fs.readFileSync(path.join(__dirname, "verified-settings.json"), "utf8"));
const hookSettings = Object.values(S).find((s) => /MemeHook/.test(s.fullyQualifiedName)).settings;
const FILES = [["liquidfi", "LiquidFiToken"], ["liquidfi", "LiquidFiLocker"], ["buzzpad", "BuzzPadHook"], ["buzzpad", "BuzzPadFactory"], ["zappy", "ZappyVault"], ["zappy", "ZappyMargin"]];
const sources = Object.fromEntries(FILES.map(([d, f]) => [`src/${d}/${f}.sol`, { content: fs.readFileSync(path.join(CONTRACTS, "src", d, f + ".sol"), "utf8") }]));
const findImports = (p) => { const f = [path.join(CONTRACTS, p), path.join(ROOT, p)].find((x) => fs.existsSync(x)); return f ? { contents: fs.readFileSync(f, "utf8") } : { error: "not found: " + p }; };
const settings = { ...hookSettings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } };
const t0 = Date.now();
const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings }), { import: findImports }));
const errs = (out.errors || []).filter((e) => e.severity === "error");
for (const w of (out.errors || []).filter((e) => e.severity !== "error" && e.sourceLocation && /^src\/(liquidfi|buzzpad|zappy)/.test(e.sourceLocation.file))) console.log("warning: " + w.formattedMessage.split("\n")[0]);
if (errs.length) { console.log(errs.map((e) => e.formattedMessage).join("\n")); process.exit(1); }
fs.mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
let bad = 0;
for (const [d, f] of FILES) {
  const c = out.contracts[`src/${d}/${f}.sol`][f];
  const size = c.evm.deployedBytecode.object.length / 2;
  if (size > 24576) bad++;
  fs.writeFileSync(path.join(ROOT, "artifacts", f + ".json"), JSON.stringify({ contractName: f, sourceName: `src/${d}/${f}.sol`, compiler: solc.version(), abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, deployedBytecode: "0x" + c.evm.deployedBytecode.object }));
  console.log(`${f.padEnd(18)} ${String(size).padStart(6)} B runtime${size > 24576 ? "  !! over the 24,576 B limit" : ""}`);
}
console.log(`solc ${solc.version().split("+")[0]} in ${((Date.now() - t0) / 1000).toFixed(1)}s${bad ? `, ${bad} over size` : ""}`);
process.exit(bad ? 1 : 0);
