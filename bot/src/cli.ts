/**
 * CLI utilities.
 *   npm run info -- [tokenAddress]            full token data report
 *   npm run info -- --check [tokenAddress]    safety / honeypot check
 * Defaults to $MARIAN when no address is given.
 */
import { buildTokenReport } from "./report.js";
import { checkToken } from "./safety.js";
import { DEFAULT_TOKEN } from "./config.js";

const args = process.argv.slice(2);
const doCheck = args.includes("--check");
const token = args.find((a) => a.startsWith("0x")) || DEFAULT_TOKEN;

async function main() {
  if (doCheck) {
    const r = await checkToken(token);
    console.log(`Safety check — ${r.symbol}`);
    console.log(`verified: ${r.verified} | sellable: ${r.sellable} | sellTax%: ${r.sellTaxPct?.toFixed(2) ?? "n/a"}`);
    r.notes.forEach((n) => console.log(" - " + n));
  } else {
    const report = await buildTokenReport(token);
    console.log(report.replace(/[*`]/g, ""));
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
