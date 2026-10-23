import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Deploy Liqio (Equo on HyperEVM: clone coins, HyperCore oracle, the Equo factory with its admin collect) to HyperEVM.
 *
 *   npx hardhat run scripts/deploy-liqio.ts --network hyperevm   (needs LIQIO_CONFIRM_DEPLOY=1)
 *   DRY_RUN=1 npx hardhat run scripts/deploy-liqio.ts            (local rehearsal: own PoolManager, WHYPE, mocked precompile)
 *
 * Before a live run the deployer must have big blocks on (contract deployments need more than the 3M-gas
 * small block): `python scripts/liqio-big-blocks.py on`, and `off` afterwards. Every transaction of the
 * deployer then lands in the once-a-minute big block, so the run takes a few minutes.
 *
 * Env:
 *   PRIVATE_KEY            deployer (pays gas; keeps setup rights only until RENOUNCE)
 *   ONEHOOK_ADMIN          immutable admin of factory and oracle: pause, listings, metadata, fee recipient, collect, price sources
 *   ONEHOOK_FEE_RECIPIENT  platform fee sink (default: admin)
 *   LIQIO_POOL_MANAGER     Uniswap v4 PoolManager (default: HyperEVM's)
 *   LIQIO_WETH             WHYPE (default: 0x5555…5555)
 *   RENOUNCE=1             renounce the deployer's setup rights at the end (factory owner)
 *   EQUO_CASHBACK_BPS      cashback share of the platform part, bps (owner step, before RENOUNCE)
 *   EQUO_REFERRAL_BPS      referral share of the platform part, bps (same)
 *   EQUO_CAP_PRESETS       start cap presets in whole USD, comma separated, e.g. 3000,10000,25000 (same)
 *
 * The deployer holds a setup right on the factory, oracle and token deployer (wiring, price sources, presets,
 * reward split) and gives it up with RENOUNCE=1; the admin keeps its rights. Each HyperCore market is checked
 * against the precompile before it is listed (setCore reverts when the market has no price).
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const E18 = 10n ** 18n;
const ORACLE_PX = "0x0000000000000000000000000000000000000807";

// HyperCore markets behind each pair token. Index as the precompile numbers them: perps on the main book by
// their index, HIP-3 markets at 10000 * dex + index (xyz is dex 1). szDecimals from the `meta` endpoint.
// Verified on chain 2026-10-23: 159 → HYPE, 10002 → xyz:NVDA, 10052 → xyz:SP500, 10076 → xyz:SPCX.
type Src = { symbol: string; token: string; kind: "core" | "fixed"; index?: number; sz?: number; mult?: bigint; erc4626?: boolean; usd18?: bigint };
export const HYPEREVM_SOURCES: Src[] = [
  { symbol: "WHYPE", token: "0x5555555555555555555555555555555555555555", kind: "core", index: 159, sz: 2, mult: E18, erc4626: false },
  { symbol: "USDC", token: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", kind: "fixed", usd18: 10n ** 30n },
  { symbol: "wNVDAx", token: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", kind: "core", index: 10002, sz: 3, mult: E18, erc4626: true },
  { symbol: "wSPYx", token: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540", kind: "core", index: 10052, sz: 3, mult: E18 / 10n, erc4626: true },
  { symbol: "wSPCXx", token: "0x8e2eeD8b8B5E13Ea7BF38e50d7821d2C57309072", kind: "core", index: 10076, sz: 2, mult: E18, erc4626: true },
  { symbol: "wGMEx", token: "0x459D3ae62B86cC6125e06260DddFd3AFED24A877", kind: "core", index: 10041, sz: 2, mult: E18, erc4626: true },
  { symbol: "wMUx", token: "0xe2047ee3bdDb5C99ae428AB83df63f8730698e30", kind: "core", index: 10015, sz: 3, mult: E18, erc4626: true },
  { symbol: "wSKHYx", token: "0x6215a58ed045d71F2561AaAbe54f4C885C522998", kind: "core", index: 10099, sz: 2, mult: E18, erc4626: true },
];

function mine(deployer: string, initCodeHash: string): { addr: string; salt: string } {
  for (let i = 0n; i < 20_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployer, salt, initCodeHash);
    if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) return { addr, salt };
  }
  throw new Error("hook salt not found");
}

/// mining the hook salt can outlast the node's idle keep-alive, so the first call after it may hit a closed socket
async function retry<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  let last: any;
  for (let i = 0; i < tries; i++) { try { return await f(); } catch (e: any) { last = e; if (!/socket|ECONNRESET|other side closed|fetch failed/i.test(String(e?.message ?? e))) throw e; await new Promise((r) => setTimeout(r, 1000)); } }
  throw last;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return ethers.getAddress(v);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const dry = process.env.DRY_RUN === "1";
  if (!dry && network.name !== "hardhat" && process.env.LIQIO_CONFIRM_DEPLOY !== "1") throw new Error("set LIQIO_CONFIRM_DEPLOY=1 to deploy to a live chain");
  if (dry && network.name !== "hardhat") throw new Error("DRY_RUN only runs on the in-process hardhat network");
  const startBalance = await ethers.provider.getBalance(deployer.address);
  let admin: string, poolManager: string, weth: string;
  let sources: Src[] = HYPEREVM_SOURCES;
  if (dry) {
    admin = deployer.address;
    const w = await (await ethers.getContractFactory("WETH9")).deploy();
    weth = await w.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, deployer).deploy(deployer.address);
    poolManager = await pm.getAddress();
    const core = await (await ethers.getContractFactory("MockHyperCore")).deploy();
    await network.provider.send("hardhat_setCode", [ORACLE_PX, await ethers.provider.getCode(await core.getAddress())]);
    const px = await ethers.getContractAt("MockHyperCore", ORACLE_PX);
    await (await px.set(159, 780_510n)).wait();
    const usdc = await (await ethers.getContractFactory("LiqioMockERC20")).deploy("USD Coin", "USDC", 6);
    sources = [{ symbol: "WHYPE", token: weth, kind: "core", index: 159, sz: 2, mult: E18, erc4626: false }, { symbol: "USDC", token: await usdc.getAddress(), kind: "fixed", usd18: 10n ** 30n }];
  } else {
    admin = need("ONEHOOK_ADMIN");
    // LIQIO_* names on purpose: contracts/.env carries POOL_MANAGER and WETH_ADDRESS for the Ethereum deployments
    poolManager = ethers.getAddress(process.env.LIQIO_POOL_MANAGER ?? "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F");
    weth = ethers.getAddress(process.env.LIQIO_WETH ?? "0x5555555555555555555555555555555555555555");
    const net = await ethers.provider.getNetwork();
    if (net.chainId !== 999n) throw new Error(`expected HyperEVM (999), connected to ${net.chainId}`);
    for (const [name, a] of [["PoolManager", poolManager], ["WHYPE", weth]]) if ((await ethers.provider.getCode(a)).length <= 2) throw new Error(`${name} ${a} has no code on this chain`);
    // sanity: the precompile answers for HYPE, so this really is HyperEVM and the market index is right
    const raw = await ethers.provider.call({ to: ORACLE_PX, data: ethers.zeroPadValue(ethers.toBeHex(159), 32) });
    if (raw.length !== 66 || BigInt(raw) === 0n) throw new Error("HyperCore price precompile did not answer for HYPE");
    console.log(`HYPE oracle price from the precompile: $${Number(BigInt(raw)) / 1e4}`);
  }
  const feeRecipient = !dry && process.env.ONEHOOK_FEE_RECIPIENT ? ethers.getAddress(process.env.ONEHOOK_FEE_RECIPIENT) : admin;
  console.log(`network ${network.name}, deployer ${deployer.address}, admin ${admin}, fee recipient ${feeRecipient}`);

  // 1. CREATE2 deployer so the hook lands on a flag-encoded address.
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  console.log("HookDeployer:", c2Addr);

  // 2. The hook (the Equo swap-only hook, unchanged). Its `deployer` is tx.origin, so the same EOA wires the factory below.
  const Hook = await ethers.getContractFactory("EquoHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [poolManager, weth])]);
  console.log("mining hook flags 0x..CC …");
  const { addr: hookAddr, salt } = mine(c2Addr, ethers.keccak256(hookInit));
  await (await retry(() => c2.deploy(salt, hookInit))).wait();
  const hook = await ethers.getContractAt("EquoHook", hookAddr);
  console.log("EquoHook:", hookAddr);

  // 3. Oracle, token deployer (clone implementations are created in its constructor), factory, router.
  const oracle = await (await ethers.getContractFactory("LiqioOracle")).deploy(admin);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("LiqioOracle:", oracleAddr);
  const tokenDeployer = await (await ethers.getContractFactory("LiqioTokenDeployer")).deploy(admin);
  await tokenDeployer.waitForDeployment();
  const tokenDeployerAddr = await tokenDeployer.getAddress();
  console.log("LiqioTokenDeployer:", tokenDeployerAddr, " token impl:", await tokenDeployer.tokenImpl(), " rewards impl:", await tokenDeployer.divTokenImpl());
  const factory = await (await ethers.getContractFactory("LiqioFactory")).deploy(deployer.address, admin, poolManager, hookAddr, tokenDeployerAddr, weth, oracleAddr, feeRecipient);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("LiqioFactory:", factoryAddr);
  const router = await (await ethers.getContractFactory("EquoRouter")).deploy(poolManager, factoryAddr, weth);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("EquoRouter:", routerAddr);

  // 4. Wiring (each one-time). The token deployer's setFactory is admin-only.
  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  await (await hook.setFactory(factoryAddr)).wait();
  await (await factory.setConverter(routerAddr)).wait();
  console.log("wired: tokenDeployer.factory, hook.factory, factory.converter (+ hook.router)");

  // 5. Price sources (the deployer holds the oracle's setup right until it renounces below).
  const calls: string[] = [];
  for (const s of sources) {
    if (s.kind === "fixed") {
      await (await oracle.setFixed(s.token, s.usd18!)).wait();
    } else {
      const raw = await ethers.provider.call({ to: ORACLE_PX, data: ethers.zeroPadValue(ethers.toBeHex(s.index!), 32) });
      const px = raw.length === 66 ? BigInt(raw) : 0n;
      if (px === 0n) { console.log(`skip ${s.symbol}: market ${s.index} has no oracle price`); continue; }
      console.log(`${s.symbol}: market ${s.index} at $${Number(px) / 10 ** (6 - s.sz!)}${s.mult !== E18 ? ` × ${Number(s.mult) / 1e18}` : ""}${s.erc4626 ? " × share ratio" : ""}`);
      await (await oracle.setCore(s.token, s.index!, s.sz!, s.mult!, s.erc4626!)).wait();
    }
  }
  if (calls.length) { console.log("admin steps on the oracle:"); for (const c of calls) console.log("  " + c); }
  else for (const s of sources) console.log(`  ${s.symbol} priced at $${ethers.formatUnits(await oracle.price(s.token), 18)} per 1e18 base units`);

  // 6. Owner settings (the deployer is the factory owner until RENOUNCE).
  const cb = Number(process.env.EQUO_CASHBACK_BPS ?? 0), rf = Number(process.env.EQUO_REFERRAL_BPS ?? 0);
  const presets = (process.env.EQUO_CAP_PRESETS ?? "").split(",").map((v) => v.trim()).filter(Boolean).map((v) => BigInt(v) * 10n ** 8n);
  if (cb || rf) { await (await factory.setRewardSplit(cb, rf)).wait(); console.log(`reward split: cashback ${cb} bps, referral ${rf} bps of the platform part`); }
  if (presets.length) { await (await factory.setCapPresets(presets)).wait(); console.log("cap presets:", presets.map((p) => `$${p / 10n ** 8n}`).join(", ")); }
  if (process.env.RENOUNCE === "1") {
    await (await factory.renounceOwnership()).wait();
    await (await oracle.renounceOwnership()).wait();
    await (await tokenDeployer.renounceOwnership()).wait();
    console.log("setup rights renounced on factory, oracle and token deployer; the admin keeps its own");
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    model: "liqio-v1: equo hook + router + factory (admin collect), clone coins, HyperCore oracle (flags 0xCC)",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    feeRecipient,
    contracts: { hookDeployer: c2Addr, hook: hookAddr, hookSalt: salt, oracle: oracleAddr, tokenDeployer: tokenDeployerAddr, tokenImpl: await tokenDeployer.tokenImpl(), divTokenImpl: await tokenDeployer.divTokenImpl(), factory: factoryAddr, router: routerAddr, poolManager, weth },
    sources: sources.map((s) => ({ ...s, mult: s.mult?.toString(), usd18: s.usd18?.toString() })),
  };
  if (dry) { console.log("dry run: nothing written"); return; }
  mkdirSync(join(__dirname, "../deployments"), { recursive: true });
  const file = join(__dirname, `../deployments/liqio-${network.name}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", file);
  const spent = startBalance - (await ethers.provider.getBalance(deployer.address));
  console.log(`deployer spent ${ethers.formatEther(spent)} HYPE on gas`);

  console.log("\nVerify (HyperEVMScan through the Etherscan v2 API, ETHERSCAN_API_KEY in contracts/.env; Sourcify is on):");
  console.log(`  npx hardhat verify --network ${network.name} ${c2Addr}`);
  console.log(`  npx hardhat verify --network ${network.name} ${hookAddr} ${poolManager} ${weth}`);
  console.log(`  npx hardhat verify --network ${network.name} ${oracleAddr} ${admin}`);
  console.log(`  npx hardhat verify --network ${network.name} ${tokenDeployerAddr} ${admin}`);
  console.log(`  npx hardhat verify --network ${network.name} ${await tokenDeployer.tokenImpl()}`);
  console.log(`  npx hardhat verify --network ${network.name} ${await tokenDeployer.divTokenImpl()}`);
  console.log(`  npx hardhat verify --network ${network.name} ${factoryAddr} ${deployer.address} ${admin} ${poolManager} ${hookAddr} ${tokenDeployerAddr} ${weth} ${oracleAddr} ${feeRecipient}`);
  console.log(`  npx hardhat verify --network ${network.name} ${routerAddr} ${poolManager} ${factoryAddr} ${weth}`);
  console.log("\nThen: python scripts/liqio-big-blocks.py off");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
