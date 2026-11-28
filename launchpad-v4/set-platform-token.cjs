// Points a Pad deployment's fee splitter at the platform token, so its buybacks buy and burn that token. Only the
// splitter's owner can do it: the deployer, until the protocol owner has accepted ownership (after that, the admin
// page's "Set platform token").
//   KEYFILE=<key file> node set-platform-token.cjs <record name> <token address> [--send]
const fs = require("fs"), path = require("path");
const { ethers } = require(path.join(__dirname, "node_modules/ethers"));
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "artifacts", n + ".json"), "utf8")).abi;
(async () => {
  const REC = process.argv[2], token = ethers.getAddress(process.argv[3]), send = process.argv.includes("--send");
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "deployments", `pad-${REC}.json`), "utf8"));
  const p = new ethers.JsonRpcProvider(process.env.ELYSIUM_RPC || "https://rpc.elysium.kinetiq.xyz", d.chainId, { staticNetwork: true, batchMaxCount: 1 });
  const k = fs.readFileSync(process.env.KEYFILE, "utf8").match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/); const w = new ethers.Wallet("0x" + k[2], p);
  const s = new ethers.Contract(d.splitter, art("PadSplitter"), w), f = new ethers.Contract(d.factory, art("PadFactory"), p);
  // the token's pool: native HYPE against the token, no LP fee, the launch config's tick spacing, this deployment's hook
  const key = { currency0: ethers.ZeroAddress, currency1: token, fee: 0, tickSpacing: d.launchConfig.tickSpacing, hooks: d.hook };
  const owner = await s.owner();
  console.log(`splitter ${d.splitter}: owner ${owner}, token now ${await s.token()}; setting ${token}`);
  if ((await f.tokenCount()) === 0n) throw new Error("no token has launched on this factory");
  if (owner.toLowerCase() !== w.address.toLowerCase()) throw new Error("the sender does not own the splitter: the owner sets the token from the admin page");
  await s.setToken.staticCall(token, key);
  if (!send) return console.log("dry run only");
  const t = await s.setToken(token, key); await t.wait(1);
  console.log("set in", t.hash, "| token now", await s.token());
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message); process.exit(1); });
