// Compiles contracts/src/v2 with the exact settings each contract was verified with (build/verified-settings.json)
// and writes artifacts/<Name>.json. With --check, also fetches each contract's code from Robinhood Chain and
// confirms the recompiled runtime bytecode is identical (immutables and the metadata hash masked).
//   node build/compile.cjs [--check]
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const ROOT = path.join(__dirname, "..");
const SETTINGS = JSON.parse(fs.readFileSync(path.join(__dirname, "verified-settings.json"), "utf8"));
const check = process.argv.includes("--check");
const solcFor = (v) => require(v.startsWith("0.8.26") ? "solc-0.8.26" : "solc");
// The locker on chain is the earlier RobinFunFi-named build (solc 0.8.26) whose unit keys are "lib/…" and
// "src/v2/…": its two own files live in build/locker-unit, its OpenZeppelin files are the ones in contracts/lib.
const resolve = (p) => [path.join(ROOT, p), path.join(__dirname, "locker-unit", p), path.join(ROOT, "contracts", p)].find((f) => fs.existsSync(f));
const readSources = (names) => Object.fromEntries(names.map((p) => [p, { content: fs.readFileSync(resolve(p), "utf8") }]));

(async () => {
  fs.mkdirSync(path.join(ROOT, "artifacts"), { recursive: true });
  const R = check ? new ethers.JsonRpcProvider("https://rpc.mainnet.chain.robinhood.com", 4663, { staticNetwork: true }) : null;
  let bad = 0;
  for (const [name, s] of Object.entries(SETTINGS)) {
    const solc = solcFor(s.compilerVersion);
    const settings = { ...s.settings, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } } };
    const t0 = Date.now();
    const out = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: readSources(s.sources), settings })));
    const errs = (out.errors || []).filter((e) => e.severity === "error");
    if (errs.length) { console.log(`${name}: COMPILE ERRORS\n` + errs.map((e) => e.formattedMessage).join("\n")); bad++; continue; }
    // every contract of this compile unit that lives in src/ (the deployer's unit holds the token and the curve)
    for (const [file, cs] of Object.entries(out.contracts)) {
      if (!file.startsWith("contracts/src/")) continue;
      for (const [cn, c] of Object.entries(cs)) {
        if (!c.evm.bytecode.object) continue; // interfaces and libraries without code
        fs.writeFileSync(path.join(ROOT, "artifacts", cn + ".json"), JSON.stringify({ contractName: cn, sourceName: file, compiler: s.compilerVersion, abi: c.abi, bytecode: "0x" + c.evm.bytecode.object, deployedBytecode: "0x" + c.evm.deployedBytecode.object, immutableReferences: c.evm.deployedBytecode.immutableReferences || {} }));
      }
    }
    let note = "";
    if (check) {
      const [file, cn] = s.fullyQualifiedName.split(":"), c = out.contracts[file][cn];
      const local = c.evm.deployedBytecode.object, chain = (await R.getCode(s.address)).slice(2);
      const mask = (code) => { const a = code.split(""); for (const refs of Object.values(c.evm.deployedBytecode.immutableReferences || {})) for (const r of refs) for (let i = r.start * 2; i < (r.start + r.length) * 2; i++) a[i] = "0"; return a.join(""); };
      const strip = (h) => h.slice(0, -2 * (parseInt(h.slice(-4), 16) + 2));
      const same = strip(mask(local)) === strip(mask(chain));
      if (!same) bad++;
      note = same ? "  == Robinhood Chain bytecode" : "  !! DIFFERS from Robinhood Chain";
    }
    console.log(`${name.padEnd(28)} ${s.compilerVersion.split("+")[0]}  ${((Date.now() - t0) / 1000).toFixed(1)}s${note}`);
  }
  console.log(bad ? `${bad} problem(s)` : "done");
  process.exit(bad ? 1 : 0);
})();
