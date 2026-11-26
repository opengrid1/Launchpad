// Copies the deployed LiquidFi addresses from deployments/liquidfi-<network>.json into site/config.js.
//   node build/site-config-liquidfi.cjs [elysium]
const fs = require("fs"), path = require("path");
const net = process.argv[2] || "elysium";
const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `liquidfi-${net}.json`), "utf8"));
const file = path.join(__dirname, "..", "site", "config.js");
const s = fs.readFileSync(file, "utf8");
const K = { factory: d.factory, hook: d.hook, locker: d.locker, escrow: d.feeEscrow, vault: d.buybackVault, poolManager: d.poolManager, positionManager: d.positionManager, multicall: "0xcA11bde05977b3631167028862bE2a173976CA11" };
const line = "contracts: { " + Object.entries(K).map(([k, v]) => `${k}: '${v}'`).join(", ") + " }";
const out = s.replace(/contracts: \{[^}]*\}/, () => line);
if (out === s) throw new Error("contracts line not found in config.js");
fs.writeFileSync(file, out);
console.log("site/config.js:", line);
