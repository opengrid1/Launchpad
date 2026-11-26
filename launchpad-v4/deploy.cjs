// Deploys the launchpad on HyperEVM (or any chain with Permit2 and the CREATE2 proxy): the official Uniswap v4
// PoolManager when the chain has none, the official v4 PositionManager, then the stack in Pons' order, wired, with
// the launch economics in the chain's native coin. Writes deployments/<network>.json. Dry by default; --send deploys.
//   KEYFILE=../contracts/.env.deployer.v3 node deploy.cjs [--send] [--network hyperevm]
// HyperEVM: every deployment here is bigger than the 3M-gas small blocks, so the deployer must have big blocks
// switched on (HyperCore action evmUserModify {usingBigBlocks: true}, see README) before --send.
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");
const NET = {
  hyperevm: {
    chainId: 999, rpc: process.env.HYPEREVM_RPC || "https://rpc.hyperliquid.xyz/evm", native: "HYPE",
    // Uniswap's official v4 deployment on HyperEVM (developers.uniswap.org/docs/protocols/v4/deployments)
    poolManager: "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F", positionManager: "0x0d7Ab5B3db668128Aff6F70C4eBC71D7d4DA9bf9",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0x5555555555555555555555555555555555555555",
    owner: "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b",
    config: { supply: ethers.parseEther("1000000000"), curveFeeBps: 100, phantomQuote: ethers.parseEther("48"), graduationThreshold: ethers.parseEther("120"), poolFee: 0, tickSpacing: 200, enabled: true },
    launchFee: ethers.parseEther("0.005"), snipeTaxSeconds: 3, gasPrice: null, // null: EIP-1559 fees from the node (HyperEVM's base fee moves)
  },
  elysium: {
    chainId: 99901, rpc: process.env.ELYSIUM_RPC || "https://rpc-live.boxa.pro", native: "HYPE",
    poolManager: "0x06c63714fbf1f5753017123e2fcfdede4540b2c4", permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0xba876237b0f021a6c6d852d6c26e107997cc5e81",
    owner: "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b", // protocol owner, fee recipient and sweep operator at first
    // launch economics: the Pons shape (2/7 of supply reserved for the pool) sized in HYPE
    config: { supply: ethers.parseEther("1000000000"), curveFeeBps: 100, phantomQuote: ethers.parseEther("48"), graduationThreshold: ethers.parseEther("120"), poolFee: 0, tickSpacing: 200, enabled: true },
    launchFee: ethers.parseEther("0.005"), snipeTaxSeconds: 12, gasPrice: 100_000_000n,
  },
  local: { chainId: 31337, rpc: "http://127.0.0.1:8547", native: "HYPE", poolManager: "0x06c63714fbf1f5753017123e2fcfdede4540b2c4", permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", create2: "0x4e59b44847b379578588920cA78FbF26c0B4956C", weth9: "0xba876237b0f021a6c6d852d6c26e107997cc5e81", owner: null, config: null, launchFee: ethers.parseEther("0.005"), snipeTaxSeconds: 12, gasPrice: 100_000_000n },
};
const art = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, "artifacts", n + ".json"), "utf8"));
const HOOK_FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n), FLAG_MASK = (1n << 14n) - 1n; // beforeInitialize, afterSwap, afterSwapReturnDelta

(async () => {
  const netName = process.argv.includes("--network") ? process.argv[process.argv.indexOf("--network") + 1] : "hyperevm";
  const N = NET[netName]; if (!N) throw new Error("unknown network " + netName);
  const send = process.argv.includes("--send");
  const P = new ethers.JsonRpcProvider(N.rpc, N.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  const keyLine = fs.readFileSync(process.env.KEYFILE || path.join(__dirname, "../contracts/.env.deployer.v3"), "utf8").match(/PRIVATE_KEY=(0x)?([0-9a-fA-F]{64})/);
  const w = new ethers.NonceManager(new ethers.Wallet("0x" + keyLine[2], P)); const me = w.signer.address;
  const owner = N.owner || me;
  const bal = await P.getBalance(me);
  console.log(`${netName}: deployer ${me} balance ${ethers.formatEther(bal)} ${N.native}; owner/fee recipient ${owner}`);
  const fee = await P.getFeeData();
  const gasPrice = N.gasPrice ?? (fee.gasPrice ?? fee.maxFeePerGas); // for the cost estimate
  const opts = N.gasPrice ? { gasPrice: N.gasPrice } : { maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice) * 2n, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n };
  console.log(`  gas price now ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  const steps = [];
  // 0. the official Uniswap v4 PoolManager, only where the chain has none (HyperEVM); owner = protocol owner
  if (!N.poolManager) {
    const pmJ = JSON.parse(fs.readFileSync(path.join(__dirname, "build/pool-manager.sourcify.json"), "utf8"));
    const pmInit = pmJ.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner]).slice(2);
    if (send) { const tx = await w.sendTransaction({ data: pmInit, ...opts }); const rc = await tx.wait(); N.poolManager = rc.contractAddress; steps.push(["PoolManager", rc.gasUsed]); console.log(`  PoolManager ${N.poolManager}`); }
    else { steps.push(["PoolManager", await P.estimateGas({ from: me, data: pmInit }).catch(() => 0n)]); N.poolManager = ethers.ZeroAddress; }
  }
  // gas measured on the HyperEVM fork test, used by the dry run where an estimate with placeholder addresses reverts
  const MEASURED = { PonsV2FeeEscrow: 498_619n, PonsV2MemeHook: 3_535_004n, PonsV2BuybackVault: 1_102_306n, PonsV2LaunchLocker: 509_171n, PonsV2LaunchFactory: 6_086_347n, PonsV2GraduationExecutor: 1_008_558n, PonsV2LaunchDeployer: 4_554_362n, PonsV2LaunchAndBuy: 1_061_012n, wiring: 620_000n };
  const deploy = async (name, args, extra = {}) => {
    const a = art(name); const f = new ethers.ContractFactory(a.abi, a.bytecode, w);
    if (!send) { const g = await P.estimateGas({ from: me, data: f.interface.encodeDeploy(args).replace(/^0x/, a.bytecode) }).catch(() => MEASURED[name]); steps.push([name, g]); return new ethers.Contract(ethers.ZeroAddress, a.abi, w); }
    const c = await f.deploy(...args, { ...opts, ...extra }); const rc = await c.deploymentTransaction().wait(); steps.push([name, rc.gasUsed]); console.log(`  ${name} ${c.target}`); return c;
  };
  const call = async (label, p) => { if (!send) { steps.push([label, 50_000n]); return; } const tx = await p; const rc = await tx.wait(); steps.push([label, rc.gasUsed]); };
  // 1. the chain's official v4 PositionManager, or our deployment of the official build where there is none
  //    (descriptor left unset there: the locker only needs ownerOf)
  let posm = N.positionManager || ethers.ZeroAddress;
  if (!N.positionManager) {
    const posmJ = JSON.parse(fs.readFileSync(path.join(__dirname, "build/position-manager.sourcify.json"), "utf8"));
    const posmInit = posmJ.creationBytecode.recompiledBytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint256", "address", "address"], [N.poolManager, N.permit2, 300000, ethers.ZeroAddress, N.weth9]).slice(2);
    if (send) { const tx = await w.sendTransaction({ data: posmInit, ...opts }); const rc = await tx.wait(); posm = rc.contractAddress; steps.push(["PositionManager", rc.gasUsed]); console.log(`  PositionManager ${posm}`); }
    else steps.push(["PositionManager", await P.estimateGas({ from: me, data: posmInit })]);
  }
  // 2. the stack
  const escrow = await deploy("PonsV2FeeEscrow", []);
  const hookA = art("PonsV2MemeHook");
  const hookInit = hookA.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address", "address"], [N.poolManager, escrow.target, owner, owner]).slice(2);
  const initHash = ethers.keccak256(hookInit); let salt, hookAddr;
  for (let i = 0; ; i++) { salt = ethers.zeroPadValue(ethers.toBeHex(i), 32); hookAddr = ethers.getCreate2Address(N.create2, salt, initHash); if ((BigInt(hookAddr) & FLAG_MASK) === HOOK_FLAGS) break; }
  console.log(`  hook address ${hookAddr} (salt ${salt})`);
  if (send) { const tx = await w.sendTransaction({ to: N.create2, data: salt + hookInit.slice(2), gasLimit: 6_000_000n, ...opts }); const rc = await tx.wait(); steps.push(["PonsV2MemeHook", rc.gasUsed]); if ((await P.getCode(hookAddr)) === "0x") throw new Error("hook not deployed"); }
  else steps.push(["PonsV2MemeHook", await P.estimateGas({ from: me, to: N.create2, data: salt + hookInit.slice(2) }).catch(() => MEASURED.PonsV2MemeHook)]);
  const hook = new ethers.Contract(hookAddr, hookA.abi, w);
  const vault = await deploy("PonsV2BuybackVault", [owner, hookAddr, escrow.target]);
  const locker = await deploy("PonsV2LaunchLocker", [owner, posm]);
  const factory = await deploy("PonsV2LaunchFactory", [owner, N.poolManager, posm, N.permit2, locker.target, hookAddr, escrow.target, vault.target, N.launchFee]);
  const executor = await deploy("PonsV2GraduationExecutor", [posm, N.permit2, locker.target, factory.target]);
  const ldeployer = await deploy("PonsV2LaunchDeployer", [factory.target]);
  const lab = await deploy("PonsV2LaunchAndBuy", [factory.target, owner]);
  // 3. wiring (owner-only: the deployer must be the owner for these; otherwise print the calls for the owner)
  if (owner.toLowerCase() === me.toLowerCase()) {
    await call("hook.setFactory", hook.setFactory(factory.target, opts));
    await call("hook.setBuybackVault", hook.setBuybackVault(vault.target, opts));
    await call("vault.setFactory", vault.setFactory(factory.target, opts));
    await call("locker.setFactory", locker.setFactory(factory.target, opts));
    await call("factory.setGraduationExecutor", factory.setGraduationExecutor(executor.target, opts));
    await call("factory.setLaunchDeployer", factory.setLaunchDeployer(ldeployer.target, opts));
    await call("factory.setLaunchForwarder", factory.setLaunchForwarder(lab.target, opts));
    await call("factory.addLaunchConfig", factory.addLaunchConfig(N.config, opts));
    await call("factory.setSnipeTaxSeconds", factory.setSnipeTaxSeconds(N.snipeTaxSeconds, opts));
    await call("factory.setLaunchEnabled", factory.setLaunchEnabled(true, opts));
  } else console.log("  owner is not the deployer: the owner must send the 10 wiring calls (see README)");
  const total = steps.reduce((s, [, g]) => s + g, 0n);
  for (const [l, g] of steps) console.log(`  ${l.padEnd(32)} ${g.toString().padStart(9)} gas`);
  console.log(`  total ${total} gas = ${ethers.formatEther(total * gasPrice)} ${N.native} at ${ethers.formatUnits(gasPrice, "gwei")} gwei`);
  if (send) {
    const out = { network: netName, chainId: N.chainId, deployer: me, owner, positionManager: posm, feeEscrow: escrow.target, memeHook: hookAddr, hookSalt: salt, buybackVault: vault.target, locker: locker.target, factory: factory.target, graduationExecutor: executor.target, launchDeployer: ldeployer.target, launchAndBuy: lab.target, poolManager: N.poolManager, permit2: N.permit2, config: Object.fromEntries(Object.entries(N.config).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), launchFee: N.launchFee.toString(), snipeTaxSeconds: N.snipeTaxSeconds, deployedAt: new Date().toISOString() };
    fs.mkdirSync(path.join(__dirname, "deployments"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "deployments", netName + ".json"), JSON.stringify(out, null, 2) + "\n");
    console.log("written deployments/" + netName + ".json");
  } else console.log("dry run: add --send");
})().catch((e) => { console.error("FAILED", e.shortMessage || e.message); process.exit(1); });
