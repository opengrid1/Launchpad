// Verify the Liqio deployment on Sourcify through its v2 API (the v1
// endpoint hardhat-verify still calls has been retired).
//
//   node scripts/sourcify-liqio.mjs [network]      (default: hyperevm)
//
// Reads deployments/liqio-<network>.json and the Hardhat build-info that
// compiled each contract, submits the standard JSON input, and polls each
// job until Sourcify reports a match. Uses curl so the session's HTTPS proxy
// settings apply.
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const network = process.argv[2] ?? "hyperevm";
const SOURCIFY = "https://sourcify.dev/server";
const d = JSON.parse(readFileSync(join(here, `../deployments/liqio-${network}.json`), "utf8"));
const chainId = String(d.chainId);
const c = d.contracts;

const targets = [
  { label: "HookDeployer", address: c.hookDeployer, source: "contracts/v4/test/HookDeployer.sol", name: "HookDeployer" },
  { label: "EquoHook", address: c.hook, source: "contracts/v4/equo/EquoHook.sol", name: "EquoHook" },
  { label: "LiqioOracle", address: c.oracle, source: "contracts/v4/liqio/LiqioOracle.sol", name: "LiqioOracle" },
  { label: "LiqioTokenDeployer", address: c.tokenDeployer, source: "contracts/v4/liqio/LiqioTokenDeployer.sol", name: "LiqioTokenDeployer" },
  { label: "LiqioToken (implementation)", address: c.tokenImpl, source: "contracts/v4/liqio/LiqioToken.sol", name: "LiqioToken" },
  { label: "LiqioDivToken (implementation)", address: c.divTokenImpl, source: "contracts/v4/liqio/LiqioDivToken.sol", name: "LiqioDivToken" },
  { label: "LiqioFactory", address: c.factory, source: "contracts/v4/liqio/LiqioFactory.sol", name: "LiqioFactory" },
  { label: "EquoRouter", address: c.router, source: "contracts/v4/equo/EquoRouter.sol", name: "EquoRouter" },
];

const buildInfos = readdirSync(join(here, "../artifacts/build-info"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(here, "../artifacts/build-info", f), "utf8")));

function buildInfoFor(source, name) {
  const bi = buildInfos.find((b) => b.output?.contracts?.[source]?.[name]);
  if (!bi) throw new Error(`no build-info compiled ${source}:${name}; run hardhat compile`);
  return bi;
}

const tmp = mkdtempSync(join(tmpdir(), "sourcify-"));
function curl(method, url, bodyObj) {
  const args = ["-sS", "--max-time", "120", "-X", method, url, "-H", "accept: application/json"];
  if (bodyObj) {
    const f = join(tmp, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(f, JSON.stringify(bodyObj));
    args.push("-H", "content-type: application/json", "--data-binary", `@${f}`);
  }
  const out = execFileSync("curl", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { return { raw: out }; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const t of targets) {
  console.log(`\n== ${t.label}: ${t.address}`);
  const status = curl("GET", `${SOURCIFY}/v2/contract/${chainId}/${t.address}`);
  if (status.match) { console.log(`   already verified (${status.match})`); continue; }

  const bi = buildInfoFor(t.source, t.name);
  const body = {
    stdJsonInput: bi.input,
    compilerVersion: bi.solcLongVersion,
    contractIdentifier: `${t.source}:${t.name}`,
    ...(t.creationTransactionHash ? { creationTransactionHash: t.creationTransactionHash } : {}),
  };
  const res = curl("POST", `${SOURCIFY}/v2/verify/${chainId}/${t.address}`, body);
  if (!res.verificationId) { console.log("   submit FAILED:", JSON.stringify(res).slice(0, 300)); continue; }

  let result;
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    result = curl("GET", `${SOURCIFY}/v2/verify/${res.verificationId}`);
    if (result.isJobCompleted) break;
  }
  if (result?.error) console.log("   FAILED:", result.error.customCode ?? "", result.error.message ?? JSON.stringify(result.error).slice(0, 300));
  else if (result?.contract) console.log(`   ok: ${result.contract.match} (runtime ${result.contract.runtimeMatch}, creation ${result.contract.creationMatch})`);
  else console.log("   unknown result:", JSON.stringify(result).slice(0, 300));
}
