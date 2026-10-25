import { ethers, network } from "hardhat";
import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

/**
 * Deploy Equo (v3 of the OneHook design: cashback, start cap presets,
 * creator transfer and community takeover; coins are LayerZero OFTs that live on
 * every Equo chain) to one chain. Run it once per chain.
 *
 *   npx hardhat run scripts/deploy-equo.ts --network <chain>   (needs EQUO_CONFIRM_DEPLOY=1; mainnet also EQUO_CONFIRM_MAINNET=1)
 *   DRY_RUN=1 npx hardhat run scripts/deploy-equo.ts            (local: deploys its own PoolManager, WETH, oracle and endpoint)
 *
 * Env:
 *   PRIVATE_KEY            deployer (pays gas; keeps setup rights only until RENOUNCE)
 *   ONEHOOK_ADMIN          immutable admin: pause, listings, metadata, fee recipient, collect
 *   ONEHOOK_FEE_RECIPIENT  platform fee sink (default: admin)
 *   ONEHOOK_ORACLE         the chain's price oracle (IOneOracle); or
 *   EQUO_PRICE_BOOK=1      deploy an EquoPriceBook as the oracle (admin = ONEHOOK_ADMIN; the admin adds updaters)
 *   LZ_ENDPOINT            LayerZero EndpointV2 on this chain (default: Ethereum's)
 *   POOL_MANAGER           Uniswap V4 PoolManager (default: mainnet canonical; required elsewhere)
 *   WETH_ADDRESS           wrapped native token (default: mainnet WETH; required elsewhere)
 *   EQUO_LAUNCHER          launch service allowed to call launchFor (admin step; applied here only if deployer is admin)
 *   RENOUNCE=1             renounce the deployer's setup rights at the end (factory owner + token deployer setup)
 *   EQUO_CASHBACK_BPS      cashback share of the platform part, bps (admin step; applied here only if deployer is admin)
 *   EQUO_CAP_PRESETS       start cap presets in whole USD, comma separated, e.g. 5000,12500,25000 (same)
 *   EQUO_MIN_FIRST_BUY     minimum first buy per launch in the chain's native coin (factory immutable; default 0.001)
 *
 * The hook address must encode exactly beforeSwap | afterSwap |
 * beforeSwapReturnDelta | afterSwapReturnDelta (0x..CC): the hook has no
 * initialize, liquidity or donate permissions, so it can never gate, hold or
 * move liquidity. The launch position lives in the factory; only the admin's
 * disclosed `collect` can touch it.
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

function mine(deployer: string, initCodeHash: string): { addr: string; salt: string } {
  for (let i = 0n; i < 20_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployer, salt, initCodeHash);
    if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) return { addr, salt };
  }
  throw new Error("hook salt not found");
}

/// The deterministic CREATE2 deployer (present on every Equo chain; checked 2026-10-25). Calldata is the 32-byte salt
/// followed by the init code; the contract lands at create2(proxy, salt, keccak(initCode)).
const CREATE2_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const CREATE2_PROXY_RUNTIME =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

/// Deploy `name` through the CREATE2 deployer, or reuse it if it is already there (the same address on every chain).
async function create2Deploy(name: string, argTypes: string[], args: any[], saltLabel: string): Promise<string> {
  const f = await ethers.getContractFactory(name);
  const initCode = ethers.concat([f.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(argTypes, args)]);
  const salt = ethers.id(saltLabel);
  const addr = ethers.getCreate2Address(CREATE2_PROXY, salt, ethers.keccak256(initCode));
  if ((await ethers.provider.getCode(addr)).length > 2) { console.log(`${name}: already at ${addr}`); return addr; }
  const [signer] = await ethers.getSigners();
  await (await signer.sendTransaction({ to: CREATE2_PROXY, data: ethers.concat([salt, initCode]) })).wait();
  if ((await ethers.provider.getCode(addr)).length <= 2) throw new Error(`${name}: CREATE2 deploy did not land at ${addr}`);
  return addr;
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return ethers.getAddress(v);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const dry = process.env.DRY_RUN === "1";
  if (network.name === "mainnet" && process.env.EQUO_CONFIRM_MAINNET !== "1") throw new Error("set EQUO_CONFIRM_MAINNET=1 to deploy to mainnet");
  if (!dry && network.name !== "hardhat" && process.env.EQUO_CONFIRM_DEPLOY !== "1") throw new Error("set EQUO_CONFIRM_DEPLOY=1 to deploy to a live chain");
  if (dry && network.name !== "hardhat") throw new Error("DRY_RUN only runs on the in-process hardhat network");
  const startBalance = await ethers.provider.getBalance(deployer.address);
  const mainnet = network.name === "mainnet";
  let admin: string, oracle: string, poolManager: string, weth: string, endpoint: string;
  if (dry) {
    // a self-contained local stack so the exact deploy steps can be rehearsed
    admin = deployer.address;
    let w = await (await ethers.getContractFactory("WETH9")).deploy();
    while (BigInt(await w.getAddress()) < 2n ** 156n) w = await (await ethers.getContractFactory("WETH9")).deploy(); // above the coin address ceiling, like every real wrapped native
    weth = await w.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, deployer).deploy(deployer.address);
    poolManager = await pm.getAddress();
    const o = await (await ethers.getContractFactory("MockOneOracle")).deploy();
    await (await o.set(weth, 3000n * 10n ** 18n)).wait();
    oracle = await o.getAddress();
    const ep = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(30101);
    endpoint = await ep.getAddress();
    // the local chain has no CREATE2 deployer: put the standard one at its usual address
    await network.provider.send("hardhat_setCode", [CREATE2_PROXY, CREATE2_PROXY_RUNTIME]);
  } else {
    if ((await ethers.provider.getCode(CREATE2_PROXY)).length <= 2) throw new Error(`no CREATE2 deployer at ${CREATE2_PROXY} on this chain`);
    admin = need("ONEHOOK_ADMIN");
    oracle = process.env.EQUO_PRICE_BOOK === "1" ? "" : need("ONEHOOK_ORACLE");
    poolManager = mainnet ? ethers.getAddress(process.env.POOL_MANAGER ?? "0x000000000004444c5dc75cB358380D2e3dE08A90") : need("POOL_MANAGER");
    weth = mainnet ? ethers.getAddress(process.env.WETH_ADDRESS ?? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2") : need("WETH_ADDRESS");
    endpoint = mainnet ? ethers.getAddress(process.env.LZ_ENDPOINT ?? "0x1a44076050125825900e736c501f859c50fE728c") : need("LZ_ENDPOINT");
  }
  const feeRecipient = !dry && process.env.ONEHOOK_FEE_RECIPIENT ? ethers.getAddress(process.env.ONEHOOK_FEE_RECIPIENT) : admin;
  // every launch on this chain opens with at least this much native in its pool (factory immutable); per chain
  const minFirstBuy = ethers.parseEther(process.env.EQUO_MIN_FIRST_BUY ?? "0.001");

  console.log(`network ${network.name}, deployer ${deployer.address}, admin ${admin}`);

  // 1. CREATE2 deployer so the hook lands on a flag-encoded address.
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  console.log("HookDeployer:", c2Addr);

  // 2. The hook. Its `deployer` is tx.origin, so the same EOA wires the factory below.
  const Hook = await ethers.getContractFactory("EquoHook");
  const hookInit = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [poolManager, weth])]);
  console.log("mining hook flags 0x..CC …");
  const { addr: hookAddr, salt } = mine(c2Addr, ethers.keccak256(hookInit));
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("EquoHook", hookAddr);
  console.log("EquoHook:", hookAddr);

  // 3. Price book (when this chain has no oracle of its own), token deployer and its two creators, factory, router.
  if (!oracle) {
    const book = await (await ethers.getContractFactory("EquoPriceBook")).deploy(admin);
    await book.waitForDeployment();
    oracle = await book.getAddress();
    console.log("EquoPriceBook:", oracle);
  }
  // The token deployer and the two creators go through the deterministic CREATE2 deployer with fixed salts and
  // constructor arguments that are the same on every chain (admin, deployer), so they sit at the same addresses
  // everywhere, and with them every coin. The deployer key must be the same on every chain.
  const TD_ADDR = await create2Deploy("EquoTokenDeployer", ["address", "address"], [admin, deployer.address], "equo.tokenDeployer.v1");
  const tokenDeployer = await ethers.getContractAt("EquoTokenDeployer", TD_ADDR);
  const tokenDeployerAddr = TD_ADDR;
  console.log("EquoTokenDeployer:", tokenDeployerAddr, "(same address on every chain)");
  if ((await tokenDeployer.endpoint()) === ethers.ZeroAddress) await (await tokenDeployer.setEndpoint(endpoint)).wait();
  const plainCreatorAddr = await create2Deploy("EquoTokenCreator", ["address"], [tokenDeployerAddr], "equo.tokenCreator.v1");
  const divCreatorAddr = await create2Deploy("EquoDivTokenCreator", ["address"], [tokenDeployerAddr], "equo.divTokenCreator.v1");
  console.log("EquoTokenCreator:", plainCreatorAddr, " EquoDivTokenCreator:", divCreatorAddr, "(same on every chain)");

  const rules = await (await ethers.getContractFactory("EquoLaunchRules")).deploy();
  await rules.waitForDeployment();
  const rulesAddr = await rules.getAddress();
  console.log("EquoLaunchRules (linked library):", rulesAddr);
  const factory = await (await ethers.getContractFactory("EquoFactory", { libraries: { EquoLaunchRules: rulesAddr } })).deploy(
    deployer.address, admin, poolManager, hookAddr, tokenDeployerAddr, weth, oracle, feeRecipient, minFirstBuy,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("EquoFactory:", factoryAddr);

  const router = await (await ethers.getContractFactory("EquoRouter")).deploy(poolManager, factoryAddr, weth);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("EquoRouter:", routerAddr);

  // 4. Wiring (each one-time).
  if ((await tokenDeployer.tokenCreator()) === ethers.ZeroAddress) await (await tokenDeployer.setCreators(plainCreatorAddr, divCreatorAddr)).wait();
  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  await (await hook.setFactory(factoryAddr)).wait();
  await (await factory.setConverter(routerAddr)).wait();
  console.log("wired: tokenDeployer.creators, tokenDeployer.factory, hook.factory, factory.converter (+ hook.router)");

  // 5. Admin settings (only when the deployer is the admin; otherwise print them for the admin to send).
  const cb = Number(process.env.EQUO_CASHBACK_BPS ?? 0);
  const presets = (process.env.EQUO_CAP_PRESETS ?? "").split(",").map((v) => v.trim()).filter(Boolean).map((v) => BigInt(v) * 10n ** 8n);
  // the deployer is still the factory owner here, so it can set the launch values before renouncing
  {
    if (cb) { await (await factory.setCashback(cb)).wait(); console.log(`cashback: ${cb} bps of the platform part`); }
    if (presets.length) { await (await factory.setCapPresets(presets)).wait(); console.log("cap presets:", presets.map((p) => `$${p / 10n ** 8n}`).join(", ")); }
  }
  const launcher = process.env.EQUO_LAUNCHER ? ethers.getAddress(process.env.EQUO_LAUNCHER) : "";
  if (launcher) {
    if (admin === deployer.address) { await (await factory.setLauncher(launcher, true)).wait(); console.log("launcher allowed:", launcher); }
    else console.log(`admin step: factory.setLauncher(${launcher}, true)${process.env.EQUO_PRICE_BOOK === "1" ? ` and priceBook.setUpdater(${launcher}, true)` : ""}`);
  }

  if (process.env.RENOUNCE === "1") {
    await (await factory.renounceOwnership()).wait();
    if (admin !== deployer.address) await (await tokenDeployer.endSetup()).wait();
    console.log("factory and token deployer setup rights renounced; admin keeps its own");
  }

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    model: "equo-v3-omni: onehook-v2 + cashback (no referrals), 70/30 split, cap presets, creator transfer, takeover (flags 0xCC); OFT coins, 0.2% bridge fee",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    admin,
    feeRecipient,
    contracts: { hookDeployer: c2Addr, hook: hookAddr, hookSalt: salt, tokenDeployer: tokenDeployerAddr, tokenCreator: plainCreatorAddr, divTokenCreator: divCreatorAddr, launchRules: rulesAddr, factory: factoryAddr, router: routerAddr, poolManager, weth, oracle, lzEndpoint: endpoint },
    minFirstBuy: minFirstBuy.toString(),
  };
  if (dry) { console.log("dry run: nothing written"); return; }
  mkdirSync(join(__dirname, "../deployments"), { recursive: true });
  const file = join(__dirname, `../deployments/equo-${network.name}${dry ? "-dryrun" : ""}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote", file);

  const spent = startBalance - (await ethers.provider.getBalance(deployer.address));
  console.log(`deployer spent ${ethers.formatEther(spent)} ETH on gas`);

  console.log("\nVerify (full config, ETHERSCAN_API_KEY in contracts/.env):");
  console.log(`  npx hardhat verify --network ${network.name} ${c2Addr}`);
  console.log(`  npx hardhat verify --network ${network.name} ${hookAddr} ${poolManager} ${weth}`);
  if (process.env.EQUO_PRICE_BOOK === "1") console.log(`  npx hardhat verify --network ${network.name} ${oracle} ${admin}`);
  console.log(`  npx hardhat verify --network ${network.name} ${tokenDeployerAddr} ${admin} ${deployer.address}`);
  console.log(`  npx hardhat verify --network ${network.name} ${plainCreatorAddr} ${tokenDeployerAddr}`);
  console.log(`  npx hardhat verify --network ${network.name} ${divCreatorAddr} ${tokenDeployerAddr}`);
  console.log(`  npx hardhat verify --network ${network.name} ${rulesAddr}`);
  // the factory links EquoLaunchRules; hardhat-verify detects the linked address from the deployed bytecode
  console.log(`  npx hardhat verify --network ${network.name} ${factoryAddr} ${deployer.address} ${admin} ${poolManager} ${hookAddr} ${tokenDeployerAddr} ${weth} ${oracle} ${feeRecipient} ${minFirstBuy}`);
  console.log(`  npx hardhat verify --network ${network.name} ${routerAddr} ${poolManager} ${factoryAddr} ${weth}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
