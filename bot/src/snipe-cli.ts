/**
 * Sniper CLI.
 *   npm run snipe -- <ethAmount> [tokenAddress] [--safe]
 *
 * With a token address: waits for that token's pool to go live, then buys.
 * Without one: snipes the FIRST new token paired with WETH that launches.
 * --safe runs a honeypot check before buying (slower).
 *
 * Respects DRY_RUN in .env — keep it true until you've watched it behave.
 */
import { armSniper, formatSnipeEvent } from "./sniper.js";
import { config } from "./config.js";

const args = process.argv.slice(2);
const ethAmount = args.find((a) => !a.startsWith("0x") && !a.startsWith("--")) || "0.01";
const target = args.find((a) => a.startsWith("0x"));
const safetyCheck = args.includes("--safe");

console.log(`Mode: ${config.dryRun ? "DRY RUN" : "🔴 LIVE"} | spend: ${ethAmount} ETH | target: ${target || "any new WETH pair"}`);

const handle = armSniper({ targetToken: target, ethAmount, safetyCheck }, (e) => {
  console.log(formatSnipeEvent(e).replace(/[`*]/g, ""));
});

process.on("SIGINT", () => { handle.stop(); process.exit(0); });
handle.done.then(() => process.exit(0));
