// Launches a token on a Pad factory (Kinex, or another brand's deployment of the same stack) from the key in KEYFILE,
// paired with native HYPE. Dry run by default (simulation and gas); --send sends.
//   KEYFILE=<key file> node launch-pad-token.cjs <record name> <out.json> [--send] [--open] [--close]
// <record name> is the deployment record deployments/pad-<name>.json (elysium is Kinex, kinetiqpump is KinetiqPump).
// Env: COIN_NAME, COIN_SYMBOL, COIN_DESC, COIN_LOGO (a URL), COIN_X, COIN_SITE, OPENING_BUY (HYPE, default none),
// OFFICIAL=1 (the platform's own token: its creator share goes to the fee splitter, so it is bought back and burned too).
// --open turns launching on first and --close turns it off again afterwards: both only while the sender still owns
// the factory (before the protocol owner has accepted ownership).
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { ethers } = require(path.join(__dirname, "node_modules/ethers"));
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "artifacts", n + ".json"), "utf8")).abi;
const REC = process.argv[2], OUT = process.argv[3], send = process.argv.includes("--send");
(async () => {
  if (!REC || !OUT) throw new Error("usage: node launch-pad-token.cjs <record name> <out.json> [--send] [--open] [--close]");
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "deployments", `pad-${REC}.json`), "utf8"));
  const E = process.env, NAME = E.COIN_NAME, SYMBOL = E.COIN_SYMBOL;
  if (!NAME || !SYMBOL) throw new Error("set COIN_NAME and COIN_SYMBOL");
  const p = new ethers.JsonRpcProvider(E.ELYSIUM_RPC || "https://rpc.elysium.kinetiq.xyz", d.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const k = fs.readFileSync(E.KEYFILE, "utf8").match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/); if (!k) throw new Error("no PRIVATE_KEY in KEYFILE");
  const w = new ethers.Wallet("0x" + k[2], p), f = new ethers.Contract(d.factory, art("PadFactory"), w);
  const saltFile = OUT + ".salt"; if (!fs.existsSync(saltFile)) fs.writeFileSync(saltFile, "0x" + crypto.randomBytes(32).toString("hex")); const salt = fs.readFileSync(saltFile, "utf8").trim();
  const owner = await f.owner(), mine = owner.toLowerCase() === w.address.toLowerCase();
  let enabled = await f.launchEnabled();
  if (!enabled && process.argv.includes("--open")) {
    if (!mine) throw new Error("launching is off and the sender does not own the factory: the owner turns it on from the admin page");
    if (send) { const t = await f.setLaunchEnabled(true); await t.wait(1); enabled = true; console.log("launching turned on in", t.hash); }
    else console.log("(would turn launching on first)");
  }
  const openingBuy = ethers.parseEther(E.OPENING_BUY || "0"), fee = await f.launchFee(), econ = await f.previewLaunchEconomics(0), bal = await p.getBalance(w.address);
  const params = { name: NAME, symbol: SYMBOL, logo: E.COIN_LOGO || "", description: E.COIN_DESC || "",
    socials: { twitter: E.COIN_X || "", telegram: "", discord: "", website: E.COIN_SITE || "", farcaster: "" },
    creatorFeeRecipient: E.OFFICIAL ? d.splitter : w.address, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: econ, salt, openingBuy, minTokensOut: 0n };
  const predicted = await f.predictTokenAddress(w.address, salt, 0);
  console.log(`from ${w.address}, balance ${ethers.formatEther(bal)} HYPE | factory ${d.factory} (owner ${owner}) | launching ${enabled ? "on" : "off"} | fee ${ethers.formatEther(fee)} | opening buy ${ethers.formatEther(openingBuy)} | will be ${predicted}`);
  if (!enabled) return console.log("dry run stops here: launching is off, so the launch cannot be simulated yet");
  const value = fee + openingBuy;
  const sim = await f.launch.staticCall(params, 0, { value }), gas = await f.launch.estimateGas(params, 0, { value });
  if (predicted !== sim) throw new Error("prediction and simulation disagree");
  console.log("simulated", sim, "| gas", gas.toString());
  if (!send) return console.log("dry run only");
  const tx = await f.launch(params, 0, { value, gasLimit: (gas * 13n) / 10n + 100_000n }); console.log("sent", tx.hash);
  const rc = await tx.wait(1); if (rc.status !== 1) throw new Error("the launch reverted: " + tx.hash);
  const ev = rc.logs.map((l) => { try { return f.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenLaunched");
  const out = { record: REC, name: NAME, symbol: SYMBOL, token: ev.args.token, poolId: ev.args[2], tx: tx.hash, block: rc.blockNumber, creator: w.address, feeRecipient: ev.args[5], official: !!E.OFFICIAL, openingBuyHype: ethers.formatEther(openingBuy), gasUsed: rc.gasUsed.toString() };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n"); console.log(JSON.stringify(out, null, 1));
  if (process.argv.includes("--close") && mine) { const t = await f.setLaunchEnabled(false); await t.wait(1); console.log("launching turned off again in", t.hash); }
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
