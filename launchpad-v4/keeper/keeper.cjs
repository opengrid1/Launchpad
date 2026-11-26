// The launchpad's keeper, the two jobs Pons runs off chain:
//   1. graduation: a curve that is ready but not graduated gets `graduate(token)`; a launch in the Swept phase
//      gets `createGraduatedPool(token)` (both permissionless, so a stuck crossing buy never strands a launch);
//   2. fee sweeps, as the sweep operator: `sweepFees` on curves and `sweepPoolFees` on graduated pools once
//      their pending fees pass a threshold, with the minimum outputs the contracts require for internal swaps
//      (a buyback or a memecoin-to-quote conversion), quoted from the pool's own state with the 3% impact cap.
// Launches come from the factory's TokenLaunched events, scanned from the deployment's block in LOG_PAGE-block
// pages (1,000 on HyperEVM's public RPC, which also rate-limits: set RPC to a private endpoint for a busy
// launchpad). Runs forever; KEEPER_ONCE=1 does one pass.
//   KEYFILE=../contracts/.env.launch-service node keeper/keeper.cjs
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments", (process.env.NETWORK || "hyperevm") + ".json"), "utf8"));
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts", n + ".json"), "utf8")).abi;
const RPC = process.env.RPC || "https://rpc.hyperliquid.xyz/evm";
const P = new ethers.JsonRpcProvider(RPC, D.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
const keyLine = fs.readFileSync(process.env.KEYFILE || path.join(__dirname, "../../contracts/.env.launch-service"), "utf8").match(/(?:EQUO_LAUNCHER_KEY|PRIVATE_KEY)=(0x)?([0-9a-fA-F]{64})/);
const w = new ethers.NonceManager(new ethers.Wallet("0x" + keyLine[2], P));
const factory = new ethers.Contract(D.factory, art("PonsV2LaunchFactory"), w);
const hook = new ethers.Contract(D.memeHook, art("PonsV2MemeHook"), w);
const SWEEP_MIN = ethers.parseEther(process.env.SWEEP_MIN_NATIVE || "0.5"); // sweep once this much native fee is pending
const PAGE = Number(process.env.LOG_PAGE || 1_000), POLL_MS = Number(process.env.POLL_MS || 15_000), opts = {}; // fees from the node (HyperEVM base fee moves)
const state = { from: Number(process.env.START_BLOCK || 0), launches: new Map() };
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function scan() {
  const head = await P.getBlockNumber();
  while (state.from <= head) {
    const to = Math.min(head, state.from + PAGE - 1);
    for (const l of await factory.queryFilter(factory.filters.TokenLaunched(), state.from, to)) state.launches.set(l.args.token, { curve: l.args.curve, pairToken: l.args.pairToken });
    state.from = to + 1;
    if (state.from <= head) await new Promise((r) => setTimeout(r, 250)); // public RPC rate limit
  }
}

async function graduations() {
  for (const [token, L] of state.launches) {
    const launch = await factory.getLaunchedToken(token);
    if (launch.phase === 1n) { log("createGraduatedPool", token); const rc = await (await factory.createGraduatedPool(token, { gasLimit: 2_000_000n, ...opts })).wait(); log("  pool created, gas", rc.gasUsed.toString()); continue; }
    if (launch.phase !== 0n) continue;
    const curve = new ethers.Contract(L.curve, art("PonsV2BondingCurve"), w);
    if (await curve.readyToGraduate()) { log("graduate", token); await (await factory.graduate(token, { gasLimit: 1_000_000n, ...opts })).wait(); }
  }
}

/** Pool price as quote per token from slot0, for sizing the operator's minimum outputs. */
async function poolPrice(poolId, memecoinIsCurrency0) {
  const pm = new ethers.Contract(D.poolManager, ["function extsload(bytes32) view returns (bytes32)"], P);
  const slot = BigInt(ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [poolId, 6])));
  const s0 = BigInt(await pm.extsload(ethers.toBeHex(slot, 32))) & ((1n << 160n) - 1n);
  const p = Number(s0) / 2 ** 96; const price1per0 = p * p; // currency1 per currency0
  return memecoinIsCurrency0 ? price1per0 : 1 / price1per0;
}

async function sweeps() {
  for (const [token, L] of state.launches) {
    const launch = await factory.getLaunchedToken(token);
    if (launch.phase === 0n) {
      const curve = new ethers.Contract(L.curve, art("PonsV2BondingCurve"), w);
      const [pending, tax, bb] = await Promise.all([curve.quoteFeeBalance(), curve.creatorTaxBalance(), curve.buybackQuoteBalance()]);
      if (pending + tax < SWEEP_MIN) continue;
      let minOut = 0n;
      if (bb > 0n) { const [q, t] = await curve.getReserves(); minOut = ((bb * t) / (q + bb)) * 97n / 100n; } // constant product, 3% below
      log("sweepFees", token, ethers.formatEther(pending + tax)); await (await curve.sweepFees(minOut, { gasLimit: 600_000n, ...opts })).wait();
    } else if (launch.phase === 2n) {
      const [c0, c1] = L.pairToken.toLowerCase() < token.toLowerCase() ? [L.pairToken, token] : [token, L.pairToken];
      const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], [c0, c1, launch.poolFee, launch.tickSpacing, D.memeHook]));
      const [fq, fm, tq, tm, bq] = await Promise.all([hook.pendingFees(poolId, L.pairToken), hook.pendingFees(poolId, token), hook.pendingCreatorTax(poolId, L.pairToken), hook.pendingCreatorTax(poolId, token), hook.pendingBuyback(poolId, L.pairToken)]);
      const px = await poolPrice(poolId, c0.toLowerCase() === token.toLowerCase());
      const memeAsQuote = BigInt(Math.floor(Number(fm + tm) * px));
      if (fq + tq + memeAsQuote < SWEEP_MIN) continue;
      const minConv = fm + tm > 0n ? memeAsQuote * 96n / 100n : 0n; // 3% impact cap plus rounding room
      const minBuy = bq > 0n ? BigInt(Math.floor(Number(bq) / px)) * 96n / 100n : 0n;
      log("sweepPoolFees", token, "quote", ethers.formatEther(fq + tq), "meme", ethers.formatEther(fm + tm));
      await (await hook.sweepPoolFees(poolId, minConv, minBuy, { gasLimit: 900_000n, ...opts })).wait();
    }
  }
}

(async () => {
  log("keeper", w.signer.address, "factory", D.factory, "from block", state.from);
  for (;;) {
    try { await scan(); await graduations(); await sweeps(); } catch (e) { log("error", (e.shortMessage || e.message).slice(0, 160)); }
    if (process.env.KEEPER_ONCE) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
