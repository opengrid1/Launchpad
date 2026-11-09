// Deploys the Pad launchpad stack (Tidepool): Uniswap's official v4 PositionManager build where the chain has none (Elysium), the fee
// escrow and buyback vault, the hook, the fee splitter, the AMM (factory, router) and the farm, then the locker, token implementation and launch factory; the hook (CREATE2, address mined for its flags), locker,
// token implementation and factory. The deployer is the first owner so it can wire everything; ownership is then
// offered to the protocol owner, who completes it with acceptOwnership() on the hook, factory, locker and vault
// (Ownable2Step). The deployer stays the fee sweep operator (the keeper) until the owner rotates it.
// Writes deployments/pad-<network>.json. Dry by default; --send deploys.
//   KEYFILE=../contracts/.env.deployer.v3 node deploy-pad.cjs [--send] [--network elysium]
// Build first: node build/compile-pad.cjs
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const E18 = 10n ** 18n;
// launch economics per network, in the native currency: the opening market cap (one single-sided range from it to the top)
const ECON = { HYPE: { start: "50", fee: "0.005" }, ETH: { start: "1.75", fee: "0.0002" } };
const configFor = (e) => ({ pairToken: ethers.ZeroAddress, supply: 1_000_000_000n * E18, startMcap: ethers.parseEther(e.start), tickSpacing: 200, enabled: true });
const NET = {
  elysium: {
    chainId: 99901, rpc: process.env.ELYSIUM_RPC || "https://rpc-live.elysp.com", native: "HYPE",
    // Uniswap's v4 PoolManager on Elysium; no PositionManager there, so the official build is deployed (null)
    poolManager: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1", positionManager: null,
    // Elysium is an Arbitrum Orbit chain on HyperEVM. The public RPC relays each signed transaction to this Inbox
    // (sendL2Message) but refuses big ones ("parent gas estimate exceeds cap"); those the deployer posts itself, paying
    // the HyperEVM gas from the same address on HyperEVM.
    parent: { rpc: process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm", chainId: 999, inbox: "0xce59f8b65ad41c9dae4c07a0571a39824bd92cff" },
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  hyperevm: {
    chainId: 999, rpc: process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm", native: "HYPE",
    poolManager: "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F", positionManager: "0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0x5555555555555555555555555555555555555555",
  },
  // Ethereum mainnet: Uniswap's v4 deployment used as is
  ethereum: {
    chainId: 1, rpc: process.env.ETH_RPC || "https://ethereum-rpc.publicnode.com", native: "ETH",
    poolManager: "0x000000000004444c5dc75cB358380D2e3dE08A90", positionManager: "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
  // a local Hardhat fork of any chain: FORK_OF=elysium|hyperevm|ethereum (addresses are the forked chain's)
  local: { chainId: null, rpc: process.env.FORK_RPC || "http://127.0.0.1:8547", native: "HYPE" },
};
const OWNER = process.env.PAD_OWNER || "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b"; // protocol owner and fee recipient
const SNIPE_SECONDS = Number(process.env.SNIPE_SECONDS || 10);
const HOOK_FEE_BPS = Number(process.env.HOOK_FEE_BPS || 250); // the pool fee on every trade (2.5%), split protocol / creator
const PROTOCOL_SHARE_BPS = Number(process.env.PROTOCOL_SHARE_BPS || 6000); // 60% of the fee to the protocol, 40% (1% of volume) to the creator
const MAX_CREATOR_TAX_BPS = Number(process.env.MAX_CREATOR_TAX_BPS || 0); // no extra creator fee: the pool fee is fixed
const VOL_EXTRA_BPS = Number(process.env.VOL_EXTRA_BPS || 0); // no volatility surcharge: the fee does not move on a pump or a dump
const SPLIT_STAKING_BPS = Number(process.env.SPLIT_STAKING_BPS || 0), SPLIT_BURN_BPS = Number(process.env.SPLIT_BURN_BPS || 5000), SPLIT_FARM_BPS = Number(process.env.SPLIT_FARM_BPS || 0); // the rest (50%) to the treasury: platform revenue
const AMM_LP_FEE_BPS = Number(process.env.AMM_LP_FEE_BPS || 25), AMM_PROTOCOL_FEE_BPS = Number(process.env.AMM_PROTOCOL_FEE_BPS || 5); // 0.30% per swap on the AMM
const FARM_DAYS = Number(process.env.FARM_DAYS || 7);
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "artifacts", n + ".json"), "utf8"));
const HOOK_FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n), FLAG_MASK = (1n << 14n) - 1n; // beforeInitialize, afterSwap, afterSwapReturnDelta
// gas measured on the fork test, for the dry run where estimates against placeholder addresses revert
const MEASURED = { PadSplitter: 1_659_648n, PadStaking: 1_047_238n, PadAmmFactory: 1_880_871n, PadAmmRouter: 1_659_270n, PadFarm: 1_246_536n, PositionManager: 5_254_855n, PadFeeEscrow: 493_535n, PadHook: 4_323_289n, PadBuybackVault: 1_102_306n, PadLocker: 1_021_028n, PadToken: 759_223n, PadFactory: 4_522_025n, call: 60_000n, addLaunchConfig: 218_726n };

// The public Elysium RPC rate-limits (429 / -32005 "rate limited"); retry with backoff. A resent raw transaction the node
// already has ("already known", "nonce too low") resolves to its own hash so the deploy carries on.
const RATE = /rate.?limit|429|too many|-32005|not ready|timeout|ECONNRESET|socket hang up/i;
class RetryProvider extends ethers.JsonRpcProvider {
  async send(method, params) {
    for (let i = 0; ; i++) {
      try { return await super.send(method, params); } catch (e) {
        const msg = (e.shortMessage || "") + " " + (e.message || "") + " " + JSON.stringify(e.error || e.info || "");
        if (method === "eth_sendRawTransaction" && i > 0 && /already known|nonce too low|known transaction/i.test(msg)) return ethers.keccak256(params[0]);
        if (i >= 8 || !RATE.test(msg)) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(i, 4)));
      }
    }
  }
}

(async () => {
  const netName = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "elysium";
  let N = NET[netName]; if (!N) throw new Error("unknown network " + netName);
  if (netName === "local") N = { ...NET[process.env.FORK_OF || "elysium"], rpc: NET.local.rpc, chainId: null, parent: null };
  const send = process.argv.includes("--send");
  // a new brand needs its own owner wallet: the default one's key has been shared, so Ethereum takes it only when named
  if (netName === "ethereum" && !process.env.PAD_OWNER) throw new Error("set PAD_OWNER to the new brand's owner wallet for Ethereum");
  const E_ = ECON[N.native] || ECON.HYPE, CONFIG = configFor(E_), LAUNCH_FEE = ethers.parseEther(process.env.LAUNCH_FEE || E_.fee);
  const P = new RetryProvider(N.rpc, N.chainId ?? undefined, { staticNetwork: !!N.chainId, cacheTimeout: -1, batchMaxCount: 1, pollingInterval: 2000 });
  const keyFile = process.env.KEYFILE || path.join(__dirname, "../contracts/.env.deployer.v3");
  const keyLine = fs.readFileSync(keyFile, "utf8").match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
  if (!keyLine) throw new Error("no PRIVATE_KEY in " + keyFile);
  const wallet = new ethers.Wallet("0x" + keyLine[2]); const me = wallet.address;
  const chainId = BigInt(N.chainId ?? (await P.getNetwork()).chainId);
  const bal = await P.getBalance(me);
  const fee = await P.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  const maxFeePerGas = (fee.maxFeePerGas ?? fee.gasPrice) * 2n, maxPriorityFeePerGas = fee.maxPriorityFeePerGas ?? 0n;
  // explicit gas limits everywhere: Elysium's public RPC often refuses eth_estimateGas ("Live reader is not ready")
  const limit = (g) => (g * 13n) / 10n + 200_000n;
  console.log(`${netName}: deployer ${me}, balance ${ethers.formatEther(bal)} ${N.native}; protocol owner ${OWNER}; gas ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  for (const [n, a] of [["PoolManager", N.poolManager], ["Permit2", N.permit2], ["CREATE2 deployer", N.create2], ["WHYPE", N.weth9]]) {
    if ((await P.getCode(a)) === "0x") throw new Error(`${n} ${a} has no code on ${netName}`);
  }

  // Every transaction is signed here and its raw bytes saved before broadcast, so an RPC that times out or drops a
  // send is answered by re-sending the very same transaction (same nonce, same hash) until its receipt shows up.
  // The progress file makes the deploy resumable: a rerun skips confirmed steps and re-sends a pending one.
  const progFile = path.join(__dirname, "deployments", `pad-${netName}.progress.json`);
  const prog = send && fs.existsSync(progFile) ? JSON.parse(fs.readFileSync(progFile, "utf8")) : { deployer: me, steps: {} };
  if (prog.deployer !== me) throw new Error("progress file belongs to another deployer: " + progFile);
  const save = () => { fs.mkdirSync(path.dirname(progFile), { recursive: true }); fs.writeFileSync(progFile, JSON.stringify(prog, null, 2) + "\n"); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const receiptOf = async (hash) => { try { return await P.send("eth_getTransactionReceipt", [hash]); } catch { return null; } };
  const steps = [];
  // posting a signed Elysium transaction straight to its HyperEVM inbox: message kind 4 (signed L2 tx) + raw bytes
  const PARENT_POST_BYTES = Number(process.env.PARENT_POST_BYTES || 6000);
  let parentW = null;
  async function postToInbox(raw) {
    if (!parentW) parentW = new ethers.Wallet(wallet.privateKey, new RetryProvider(N.parent.rpc, N.parent.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 }));
    const data = new ethers.Interface(["function sendL2Message(bytes messageData) returns (uint256)"]).encodeFunctionData("sendL2Message", ["0x04" + raw.slice(2)]);
    const gas = await parentW.estimateGas({ to: N.parent.inbox, data });
    const t = await parentW.sendTransaction({ to: N.parent.inbox, data, gasLimit: (gas * 13n) / 10n });
    const r = await t.wait(); if (r.status !== 1) throw new Error("inbox post reverted " + t.hash);
    return t.hash;
  }
  async function tx(name, req, measured) {
    if (!send) { steps.push([name, measured]); return { address: ethers.ZeroAddress }; }
    let rec = prog.steps[name];
    if (rec && rec.done) { steps.push([name, BigInt(rec.gasUsed)]); console.log(`  ${name.padEnd(28)} done earlier ${rec.address || ""}`); return rec; }
    if (!rec) {
      const used = Object.values(prog.steps).map((s) => s.nonce);
      const nonce = Math.max(await P.getTransactionCount(me, "latest"), used.length ? Math.max(...used) + 1 : 0);
      const t = { type: 2, chainId, nonce, gasLimit: limit(measured), maxFeePerGas, maxPriorityFeePerGas, to: req.to ?? null, data: req.data, value: 0n };
      const raw = await wallet.signTransaction(t);
      rec = prog.steps[name] = { nonce, hash: ethers.keccak256(raw), raw, address: req.to ? null : ethers.getCreateAddress({ from: me, nonce }) };
      save();
    }
    for (let round = 0; round < 40; round++) {
      let r = await receiptOf(rec.hash);
      if (!r) {
        let viaParent = !!(N.parent && rec.raw.length > 2 * PARENT_POST_BYTES);
        if (!viaParent) {
          try { await P.send("eth_sendRawTransaction", [rec.raw]); } catch (e) { const m = (e.shortMessage || "") + " " + JSON.stringify(e.error || e.info || ""); if (N.parent && /exceeds cap/i.test(m)) viaParent = true; else if (!/already known|known transaction|nonce too low/i.test(m)) console.log(`  ${name}: send not confirmed (${m.replace(/\s+/g, " ").slice(0, 120)}), checking`); }
        }
        if (viaParent && (!rec.parentHash || round - (rec.parentRound ?? 0) >= 5)) { rec.parentHash = await postToInbox(rec.raw); rec.parentRound = round; save(); console.log(`  ${name}: posted to the HyperEVM inbox in ${rec.parentHash}`); }
        for (let i = 0; i < 20 && !r; i++) { await sleep(3000); r = await receiptOf(rec.hash); }
      }
      if (r) {
        if (Number(r.status) !== 1) throw new Error(`${name} reverted in ${rec.hash}`);
        rec.done = true; rec.gasUsed = BigInt(r.gasUsed).toString(); if (r.contractAddress) rec.address = ethers.getAddress(r.contractAddress); save();
        steps.push([name, BigInt(r.gasUsed)]); console.log(`  ${name.padEnd(28)} ${rec.address || "ok"}  ${rec.hash}`); return rec;
      }
    }
    throw new Error(`${name}: no receipt for ${rec.hash} after many tries; rerun to keep re-sending it`);
  }
  const deploy = async (name, args) => { const a = art(name); const data = new ethers.ContractFactory(a.abi, a.bytecode).interface.encodeDeploy(args); return (await tx(name, { data: a.bytecode + data.slice(2) }, MEASURED[name])).address; };
  const call = (label, addr, abiName, fn, args) => tx(label, { to: addr, data: new ethers.Interface(art(abiName).abi).encodeFunctionData(fn, args) }, label.startsWith("factory.addLaunchConfig") ? MEASURED.addLaunchConfig : MEASURED.call);

  if (process.argv.includes("--staking")) {
    const token = ethers.getAddress(process.argv[process.argv.indexOf("--staking") + 1]);
    const rec = JSON.parse(fs.readFileSync(path.join(__dirname, "deployments", `pad-${netName}.json`), "utf8"));
    const STAKE_DAYS = Number(process.env.STAKE_DAYS || 7);
    console.log(`staking for ${token}: owner ${OWNER}, distributor (splitter) ${rec.splitter}, stream ${STAKE_DAYS} days`);
    const staking = await deploy("PadStaking", [OWNER, token, rec.splitter, STAKE_DAYS * 86400]);
    for (const [l, g] of steps) console.log(`  ${l.padEnd(28)} ${g.toString().padStart(9)} gas`);
    if (send) { rec.staking = staking; rec.platformToken = token; fs.writeFileSync(path.join(__dirname, "deployments", `pad-${netName}.json`), JSON.stringify(rec, null, 2) + "\n"); console.log(`written; next: the owner sets splitter.setStaking(${staking}) and splitter.setToken(${token}, key) from the admin page`); } else console.log("dry run: add --send");
    return;
  }
  // 1. the official v4 PositionManager where the chain has none (descriptor unset: the locker only needs ownerOf)
  let posm = N.positionManager;
  if (!posm) {
    const posmJ = JSON.parse(fs.readFileSync(path.join(__dirname, "build/position-manager.sourcify.json"), "utf8"));
    const posmInit = posmJ.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint256", "address", "address"], [N.poolManager, N.permit2, 300000, ethers.ZeroAddress, N.weth9]).slice(2);
    posm = (await tx("PositionManager", { data: posmInit }, MEASURED.PositionManager)).address;
  }
  // 2. the stack
  const escrow = await deploy("PadFeeEscrow", []);
  const hookInit = art("PadHook").bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address"], [N.poolManager, escrow, OWNER, me]).slice(2);
  const initHash = ethers.keccak256(hookInit); let salt, hookAddr;
  for (let i = 0; ; i++) { salt = ethers.zeroPadValue(ethers.toBeHex(i), 32); hookAddr = ethers.getCreate2Address(N.create2, salt, initHash); if ((BigInt(hookAddr) & FLAG_MASK) === HOOK_FLAGS) break; }
  await tx("PadHook", { to: N.create2, data: salt + hookInit.slice(2) }, MEASURED.PadHook);
  if (send) { if ((await P.getCode(hookAddr)) === "0x") throw new Error("hook not deployed at " + hookAddr); console.log(`  hook at ${hookAddr} (CREATE2 salt ${salt})`); }
  const vault = await deploy("PadBuybackVault", [me, hookAddr, escrow]);
  const locker = await deploy("PadLocker", [me, posm]);
  const impl = await deploy("PadToken", []);
  const factory = await deploy("PadFactory", [me, N.poolManager, posm, N.permit2, locker, hookAddr, escrow, vault, impl, LAUNCH_FEE]);
  // the fee flywheel: the splitter takes the protocol's fees (treasury = the protocol owner until it says otherwise)
  const splitter = await deploy("PadSplitter", [me, N.poolManager, escrow, OWNER, SPLIT_STAKING_BPS, SPLIT_BURN_BPS]);
  // the AMM: pairs anyone can open, their protocol fee to the splitter, and the farm the splitter streams to
  const ammFactory = await deploy("PadAmmFactory", [me, splitter, AMM_LP_FEE_BPS, AMM_PROTOCOL_FEE_BPS]);
  const ammRouter = await deploy("PadAmmRouter", [ammFactory, N.weth9]);
  const farm = await deploy("PadFarm", [me, splitter, FARM_DAYS * 86400]);
  // 3. wiring and launch settings (launching stays off until the owner turns it on)
  await call("hook.setFactory", hookAddr, "PadHook", "setFactory", [factory]);
  await call("hook.setProtocolFeeRecipient", hookAddr, "PadHook", "setProtocolFeeRecipient", [splitter]);
  if (HOOK_FEE_BPS !== 100) await call("hook.setHookFeeBps", hookAddr, "PadHook", "setHookFeeBps", [HOOK_FEE_BPS]);
  if (PROTOCOL_SHARE_BPS !== 3000) await call("hook.setProtocolFeeShareBps", hookAddr, "PadHook", "setProtocolFeeShareBps", [PROTOCOL_SHARE_BPS]);
  if (VOL_EXTRA_BPS !== 200) await call("hook.setVolatilityTerms", hookAddr, "PadHook", "setVolatilityTerms", [VOL_EXTRA_BPS ? 1000 : 0, 60, VOL_EXTRA_BPS, 120]);
  await call("splitter.setFarm", splitter, "PadSplitter", "setFarm", [farm]);
  await call("splitter.setAmmRouter", splitter, "PadSplitter", "setAmmRouter", [ammRouter]);
  await call("splitter.setShares", splitter, "PadSplitter", "setShares", [SPLIT_STAKING_BPS, SPLIT_BURN_BPS, SPLIT_FARM_BPS]);
  await call("hook.setBuybackVault", hookAddr, "PadHook", "setBuybackVault", [vault]);
  await call("vault.setFactory", vault, "PadBuybackVault", "setFactory", [factory]);
  await call("locker.setFactory", locker, "PadLocker", "setFactory", [factory]);
  await call("factory.addLaunchConfig", factory, "PadFactory", "addLaunchConfig", [CONFIG]);
  // stock pairs (Elysium): each EQX tokenized stock is approved as a pair and gets its own launch config, opening at the
  // same dollar market cap as the HYPE config; prices from Hyperliquid's spot book
  const pairCfgs = [];
  if ((netName === "elysium" || process.env.FORK_OF === "elysium") && process.env.STOCK_PAIRS !== "0") {
    const rd = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "brands/tidepool", f), "utf8")).pairs;
    // the EQX stocks first (config ids 1 to 11), then the other token pairs (KNTQ, 12): ids never move once deployed
    const list = [...rd("eqx-pairs.json").map((p) => ({ ...p, kind: "stock" })), ...rd("token-pairs.json").map((p) => ({ ...p, kind: "crypto" }))];
    const info = (b) => fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());
    const [meta, ctxs] = await info({ type: "spotMetaAndAssetCtxs" }), mids = await info({ type: "allMids" });
    const mid = (coin) => Number((ctxs.find((c) => c.coin === coin) || {}).midPx || 0), hypeUsd = Number(mids.HYPE || 0);
    if (!(hypeUsd > 0)) throw new Error("no HYPE price from Hyperliquid");
    const usdOpen = Number(E_.start) * hypeUsd; void meta;
    let id = 1;
    for (const p of list) {
      const px = mid(p.spot); if (!(px > 0)) throw new Error(`no Hyperliquid price for ${p.sym}: the config ids must stay in the list order`);
      const open = usdOpen / px, units = (x) => ethers.parseUnits(x.toFixed(p.decimals), p.decimals);
      const cfg = { ...CONFIG, pairToken: p.elysium, startMcap: units(open) };
      await call(`factory.approve ${p.sym}`, factory, "PadFactory", "setPairTokenApproved", [p.elysium, true]);
      await call(`factory.addLaunchConfig ${p.sym}`, factory, "PadFactory", "addLaunchConfig", [cfg]);
      pairCfgs.push({ key: p.key, kind: p.kind, sym: p.sym, name: p.name, ticker: p.ticker, addr: p.elysium.toLowerCase(), decimals: p.decimals, spot: p.spot, cfg: id++, open: Number(open.toFixed(4)), usdAtDeploy: Number(px.toFixed(2)) });
    }
  }
  if (SNIPE_SECONDS !== 10) await call("factory.setSnipeTaxSeconds", factory, "PadFactory", "setSnipeTaxSeconds", [SNIPE_SECONDS]);
  if (MAX_CREATOR_TAX_BPS !== 1000) await call("factory.setMaxCreatorTaxBps", factory, "PadFactory", "setMaxCreatorTaxBps", [MAX_CREATOR_TAX_BPS]);
  // 4. offer ownership to the protocol owner (two-step)
  if (OWNER.toLowerCase() !== me.toLowerCase()) {
    for (const [n, a, abi] of [["hook", hookAddr, "PadHook"], ["factory", factory, "PadFactory"], ["locker", locker, "PadLocker"], ["vault", vault, "PadBuybackVault"], ["splitter", splitter, "PadSplitter"], ["ammFactory", ammFactory, "PadAmmFactory"], ["farm", farm, "PadFarm"]]) await call(`${n}.transferOwnership`, a, abi, "transferOwnership", [OWNER]);
  }
  const total = steps.reduce((s, [, g]) => s + g, 0n);
  for (const [l, g] of steps) console.log(`  ${l.padEnd(28)} ${g.toString().padStart(9)} gas`);
  console.log(`  total ${total} gas = ${ethers.formatEther(total * gasPrice)} ${N.native} at ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  if (send) {
    const out = { network: netName, chainId: Number(chainId), deployer: me, owner: OWNER, ownershipPending: OWNER.toLowerCase() !== me.toLowerCase(), feeSweepOperator: me, hookFeeBps: HOOK_FEE_BPS, pairs: pairCfgs, protocolShareBps: PROTOCOL_SHARE_BPS, maxCreatorTaxBps: MAX_CREATOR_TAX_BPS, volExtraBps: VOL_EXTRA_BPS, splitter, splitStakingBps: SPLIT_STAKING_BPS, splitBurnBps: SPLIT_BURN_BPS, splitFarmBps: SPLIT_FARM_BPS, ammFactory, ammRouter, farm, wnative: N.weth9, ammLpFeeBps: AMM_LP_FEE_BPS, ammProtocolFeeBps: AMM_PROTOCOL_FEE_BPS, poolManager: N.poolManager, positionManager: posm, permit2: N.permit2, feeEscrow: escrow, hook: hookAddr, hookSalt: salt, buybackVault: vault, locker, tokenImplementation: impl, factory, launchConfig: Object.fromEntries(Object.entries(CONFIG).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), launchFee: LAUNCH_FEE.toString(), snipeTaxSeconds: SNIPE_SECONDS, launchEnabled: false, transactions: Object.fromEntries(Object.entries(prog.steps).map(([k, v]) => [k, v.hash])), deployedAt: new Date().toISOString() };
    const file = path.join(__dirname, "deployments", `pad-${netName}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    console.log("written " + path.relative(__dirname, file));
    if (out.ownershipPending) console.log(`next: ${OWNER} calls acceptOwnership() on the hook, factory, locker, vault, splitter, AMM factory and farm, then factory.setLaunchEnabled(true); after the platform token launches: node deploy-pad.cjs --staking <token> and splitter.setStaking / setToken from the admin page`);
  } else console.log("dry run: add --send");
})().catch((e) => { console.error("FAILED", e.shortMessage || e.message, JSON.stringify(e.error || e.info || {}).slice(0, 600)); process.exit(1); });
