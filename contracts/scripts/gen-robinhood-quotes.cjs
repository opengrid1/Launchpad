const fs = require("fs");
const path = require("path");
const dir = "/tmp/claude-0/-home-user-Launchpad/dfc4f013-9c73-51ea-a5ff-a0c98e61bbc5/scratchpad/";
const prices = JSON.parse(fs.readFileSync(dir + "rh-final-prices.json", "utf8"));
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const quotes = [USDG + ":100000000"].concat(prices.map((p) => p.address + ":" + p.usd8));
const lines = [
  "QUOTE_ASSETS=" + quotes.join(","),
  "HYPE_USD8=185500000000",
  "FEE_RECIPIENT=0x0315eCb53F64b7A4bA56bb8A4DAB0D96F0856b60",
  "FINAL_OWNER=0x0315eCb53F64b7A4bA56bb8A4DAB0D96F0856b60",
  "POOL_FEE_TIER=10000",
  "MAX_FEE_WEI=1000000000",
  "PRIORITY_FEE_WEI=100000000",
  "",
];
fs.writeFileSync(path.join(__dirname, "robinhood-quotes.env"), lines.join("\n"));
console.log("wrote robinhood-quotes.env |", quotes.length, "quotes | QA chars", quotes.join(",").length);
