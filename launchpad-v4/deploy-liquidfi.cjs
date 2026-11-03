// Deploys LiquidFi: Uniswap's official v4 PositionManager build where the chain has none (Elysium), the Pons fee
// escrow and buyback vault (byte-identical), and the LiquidFi hook (CREATE2, address mined for its flags), locker,
// token implementation and factory. The deployer is the first owner so it can wire everything; ownership is then
// offered to the protocol owner, who completes it with acceptOwnership() on the hook, factory, locker and vault
// (Ownable2Step). The deployer stays the fee sweep operator (the keeper) until the owner rotates it.
// Writes deployments/liquidfi-<network>.json. Dry by default; --send deploys.
//   KEYFILE=../contracts/.env.deployer.v3 node deploy-liquidfi.cjs [--send] [--network elysium]
// Build first: node build/compile.cjs && node build/compile-liquidfi.cjs
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const E18 = 10n ** 18n;
const CONFIG = { supply: 1_000_000_000n * E18, startMcap: 50n * E18, band1Mcap: 200n * E18, band2Mcap: 1000n * E18, band0Bps: 2000, band1Bps: 3000, tickSpacing: 200, enabled: true };
const NET = {
  elysium: {
    chainId: 99901, rpc: process.env.ELYSIUM_RPC || "https://rpc-live.elysp.com", native: "HYPE",
    // Uniswap's v4 PoolManager on Elysium; no PositionManager there, so the official build is deployed (null)
    poolManager: "0xE2e105d3F7209A9DA11f83cCf3E7398a753823F1", positionManager: null,
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
  },
  hyperevm: {
    chainId: 999, rpc: process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm", native: "HYPE",
    poolManager: "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F", positionManager: "0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0x5555555555555555555555555555555555555555",
  },
  // a local Hardhat fork of either chain: FORK_OF=elysium|hyperevm (addresses are the forked chain's)
  local: { chainId: null, rpc: process.env.FORK_RPC || "http://127.0.0.1:8547", native: "HYPE" },
};
const OWNER = process.env.LIQUIDFI_OWNER || "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b"; // protocol owner and fee recipient
const LAUNCH_FEE = ethers.parseEther(process.env.LAUNCH_FEE || "0.005");
const SNIPE_SECONDS = Number(process.env.SNIPE_SECONDS || 10);
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "artifacts", n + ".json"), "utf8"));
const HOOK_FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n), FLAG_MASK = (1n << 14n) - 1n; // beforeInitialize, afterSwap, afterSwapReturnDelta
// gas measured on the fork test, for the dry run where estimates against placeholder addresses revert
const MEASURED = { PositionManager: 4_700_000n, PonsV2FeeEscrow: 493_535n, LiquidFiHook: 4_323_289n, PonsV2BuybackVault: 1_102_306n, LiquidFiLocker: 1_021_028n, LiquidFiToken: 759_223n, LiquidFiFactory: 4_522_025n, call: 60_000n, addLaunchConfig: 218_726n };

(async () => {
  const netName = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "elysium";
  let N = NET[netName]; if (!N) throw new Error("unknown network " + netName);
  if (netName === "local") N = { ...NET[process.env.FORK_OF || "elysium"], rpc: NET.local.rpc, chainId: null };
  const send = process.argv.includes("--send");
  const P = new ethers.JsonRpcProvider(N.rpc, N.chainId ?? undefined, { staticNetwork: !!N.chainId, cacheTimeout: -1, batchMaxCount: 1 });
  const keyFile = process.env.KEYFILE || path.join(__dirname, "../contracts/.env.deployer.v3");
  const keyLine = fs.readFileSync(keyFile, "utf8").match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
  if (!keyLine) throw new Error("no PRIVATE_KEY in " + keyFile);
  const w = new ethers.NonceManager(new ethers.Wallet("0x" + keyLine[2], P)); const me = w.signer.address;
  const bal = await P.getBalance(me);
  const fee = await P.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  const opts = { maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n };
  console.log(`${netName}: deployer ${me}, balance ${ethers.formatEther(bal)} ${N.native}; protocol owner ${OWNER}; gas ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  for (const [n, a] of [["PoolManager", N.poolManager], ["Permit2", N.permit2], ["CREATE2 deployer", N.create2], ["WHYPE", N.weth9]]) {
    if ((await P.getCode(a)) === "0x") throw new Error(`${n} ${a} has no code on ${netName}`);
  }
  const steps = [];
  const deploy = async (name, args) => {
    const a = art(name); const f = new ethers.ContractFactory(a.abi, a.bytecode, w);
    if (!send) { steps.push([name, MEASURED[name]]); return new ethers.Contract(ethers.ZeroAddress, a.abi, w); }
    const c = await f.deploy(...args, opts); const rc = await c.deploymentTransaction().wait(); steps.push([name, rc.gasUsed]); console.log(`  ${name.padEnd(20)} ${c.target}`); return c;
  };
  const call = async (label, fn) => { if (!send) { steps.push([label, label === "factory.addLaunchConfig" ? MEASURED.addLaunchConfig : MEASURED.call]); return; } const tx = await fn(); const rc = await tx.wait(); steps.push([label, rc.gasUsed]); };

  // 1. the official v4 PositionManager where the chain has none (descriptor unset: the locker only needs ownerOf)
  let posm = N.positionManager;
  if (!posm) {
    const posmJ = JSON.parse(fs.readFileSync(path.join(__dirname, "build/position-manager.sourcify.json"), "utf8"));
    const posmInit = posmJ.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint256", "address", "address"], [N.poolManager, N.permit2, 300000, ethers.ZeroAddress, N.weth9]).slice(2);
    if (send) { const tx = await w.sendTransaction({ data: posmInit, ...opts }); const rc = await tx.wait(); posm = rc.contractAddress; steps.push(["PositionManager", rc.gasUsed]); console.log(`  PositionManager      ${posm}`); }
    else { steps.push(["PositionManager", MEASURED.PositionManager]); posm = ethers.ZeroAddress; }
  }
  // 2. the stack
  const escrow = await deploy("PonsV2FeeEscrow", []);
  const hookA = art("LiquidFiHook");
  const hookInit = hookA.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address"], [N.poolManager, escrow.target, OWNER, me]).slice(2);
  const initHash = ethers.keccak256(hookInit); let salt, hookAddr;
  for (let i = 0; ; i++) { salt = ethers.zeroPadValue(ethers.toBeHex(i), 32); hookAddr = ethers.getCreate2Address(N.create2, salt, initHash); if ((BigInt(hookAddr) & FLAG_MASK) === HOOK_FLAGS) break; }
  if (send) { const tx = await w.sendTransaction({ to: N.create2, data: salt + hookInit.slice(2), gasLimit: 6_000_000n, ...opts }); const rc = await tx.wait(); steps.push(["LiquidFiHook", rc.gasUsed]); if ((await P.getCode(hookAddr)) === "0x") throw new Error("hook not deployed"); console.log(`  LiquidFiHook         ${hookAddr} (CREATE2 salt ${salt})`); }
  else steps.push(["LiquidFiHook", MEASURED.LiquidFiHook]);
  const hook = new ethers.Contract(hookAddr, hookA.abi, w);
  const vault = await deploy("PonsV2BuybackVault", [me, hookAddr, escrow.target]);
  const locker = await deploy("LiquidFiLocker", [me, posm]);
  const impl = await deploy("LiquidFiToken", []);
  const factory = await deploy("LiquidFiFactory", [me, N.poolManager, posm, N.permit2, locker.target, hookAddr, escrow.target, vault.target, impl.target, LAUNCH_FEE]);
  // 3. wiring and launch settings (launching stays off until the owner turns it on)
  await call("hook.setFactory", () => hook.setFactory(factory.target, opts));
  await call("hook.setBuybackVault", () => hook.setBuybackVault(vault.target, opts));
  await call("vault.setFactory", () => vault.setFactory(factory.target, opts));
  await call("locker.setFactory", () => locker.setFactory(factory.target, opts));
  await call("factory.addLaunchConfig", () => factory.addLaunchConfig(CONFIG, opts));
  if (SNIPE_SECONDS !== 10) await call("factory.setSnipeTaxSeconds", () => factory.setSnipeTaxSeconds(SNIPE_SECONDS, opts));
  // 4. offer ownership to the protocol owner (two-step)
  if (OWNER.toLowerCase() !== me.toLowerCase()) {
    for (const [n, c] of [["hook", hook], ["factory", factory], ["locker", locker], ["vault", vault]]) await call(`${n}.transferOwnership`, () => c.transferOwnership(OWNER, opts));
  }
  const total = steps.reduce((s, [, g]) => s + g, 0n);
  for (const [l, g] of steps) console.log(`  ${l.padEnd(28)} ${g.toString().padStart(9)} gas`);
  console.log(`  total ${total} gas = ${ethers.formatEther(total * gasPrice)} ${N.native} at ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  if (send) {
    const out = { network: netName, chainId: Number((await P.getNetwork()).chainId), deployer: me, owner: OWNER, ownershipPending: OWNER.toLowerCase() !== me.toLowerCase(), feeSweepOperator: me, poolManager: N.poolManager, positionManager: posm, permit2: N.permit2, feeEscrow: escrow.target, hook: hookAddr, hookSalt: salt, buybackVault: vault.target, locker: locker.target, tokenImplementation: impl.target, factory: factory.target, launchConfig: Object.fromEntries(Object.entries(CONFIG).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), launchFee: LAUNCH_FEE.toString(), snipeTaxSeconds: SNIPE_SECONDS, launchEnabled: false, deployedAt: new Date().toISOString() };
    fs.mkdirSync(path.join(__dirname, "deployments"), { recursive: true });
    const file = path.join(__dirname, "deployments", `liquidfi-${netName}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
    console.log("written " + path.relative(__dirname, file));
    if (out.ownershipPending) console.log(`next: ${OWNER} calls acceptOwnership() on the hook, factory, locker and vault, then factory.setLaunchEnabled(true)`);
  } else console.log("dry run: add --send");
})().catch((e) => { console.error("FAILED", e.shortMessage || e.message); process.exit(1); });
