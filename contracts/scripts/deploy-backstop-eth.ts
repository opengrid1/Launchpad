/* eslint-disable no-console */
// Deploys Backstop to Ethereum mainnet (or a fork of it), resumable: every
// address is written to deployments/eth-backstop.json as it lands, and a rerun
// skips what is already there.
//
//   fork rehearsal:  FORK=1 npx hardhat --config hardhat.config.backstop.ts run scripts/deploy-backstop-eth.ts
//   mainnet:         ADMIN=0x... npx hardhat --config hardhat.config.backstop.ts run scripts/deploy-backstop-eth.ts --network mainnet
//   then verify:     VERIFY=1 ... same command
//
// Setup rights (the factory's `owner`) are renounced at the end; the admin keeps
// its own functions.
import { ethers, network, run } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const UNI_V2_FACTORY = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const UNI_V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const USDC_USD_FEED = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
// Backing tokens priced from their deepest Uniswap pool at deploy, so they can be used right away.
const SOURCES: { name: string; dex: number; pool: string }[] = [
  { name: "PEPE", dex: 1, pool: "0xA43fe16908251ee70EF74718545e4FE6C5cCEc9f" },
  { name: "NEIRO", dex: 1, pool: "0xc555d55279023e732ccd32d812114caf5838fd46" },
  { name: "WBTC", dex: 2, pool: "0xCBCdF9626bC03E24f779434178A73a0B4bad62eD" },
];
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };

const FILE = path.join(__dirname, "..", "deployments", network.name === "mainnet" ? "eth-backstop.json" : "eth-backstop-fork.json");

async function main() {
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const [me] = await ethers.getSigners();
  const admin = process.env.ADMIN ?? "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
  const dep: any = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { chainId: 1, admin, contracts: {}, gas: {} };
  const c = dep.contracts;
  const save = () => fs.writeFileSync(FILE, JSON.stringify(dep, null, 2));
  let total = 0n;
  const track = async (label: string, p: any) => { const tx = await p; const rc = await (tx.wait ? tx.wait() : tx.deploymentTransaction().wait()); dep.gas[label] = rc.gasUsed.toString(); total += rc.gasUsed; console.log(`  ${label}: ${rc.gasUsed} gas`); return tx; };
  console.log("network", network.name, "deployer", me.address, "balance", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH, admin", admin);

  if (process.env.VERIFY === "1") return verify(dep);

  if (!c.hookDeployer) { const d = await track("hookDeployer", (await ethers.getContractFactory("HookDeployer")).deploy()); c.hookDeployer = await d.getAddress(); save(); }
  if (!c.hook) {
    const Hook = await ethers.getContractFactory("BackstopHook");
    const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [POOL_MANAGER])]);
    const hash = ethers.keccak256(init);
    let salt = "", addr = "";
    for (let i = 0n; i < 5_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c.hookDeployer, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; addr = a; break; }
    }
    if (!addr) throw new Error("no hook salt");
    await track("hook", (await ethers.getContractAt("HookDeployer", c.hookDeployer)).deploy(salt, init));
    c.hook = addr; c.hookSalt = salt; save();
  }
  if (!c.oracle) {
    const feed = await ethers.getContractAt(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], ETH_USD_FEED);
    const [, answer] = await feed.latestRoundData();
    const o = await track("oracle", (await ethers.getContractFactory("BackstopOracle")).deploy({
      admin, weth: WETH, poolManager: POOL_MANAGER, uniV2Factory: UNI_V2_FACTORY, uniV3Factory: UNI_V3_FACTORY,
      ethUsdFeed: ETH_USD_FEED, ethUsd8: answer, usdc: USDC, usdcUsdFeed: USDC_USD_FEED,
    }));
    c.oracle = await o.getAddress(); dep.oracleArgs = { ethUsd8: answer.toString() }; save();
  }
  if (!c.tokenDeployer) { const d = await track("tokenDeployer", (await ethers.getContractFactory("BackstopTokenDeployer")).deploy()); c.tokenDeployer = await d.getAddress(); save(); }
  if (!c.strategyDeployer) { const d = await track("strategyDeployer", (await ethers.getContractFactory("BackstopStrategyDeployer")).deploy()); c.strategyDeployer = await d.getAddress(); save(); }
  if (!c.factory) {
    const f = await track("factory", (await ethers.getContractFactory("BackstopFactory")).deploy(me.address, admin, POOL_MANAGER, c.hook, c.tokenDeployer, c.strategyDeployer, WETH, c.oracle, admin));
    c.factory = await f.getAddress(); dep.deployer = me.address; dep.deployBlock = await ethers.provider.getBlockNumber(); save();
  }
  if (!c.router) { const r = await track("router", (await ethers.getContractFactory("BackstopRouter")).deploy(POOL_MANAGER, c.factory, WETH)); c.router = await r.getAddress(); save(); }

  // one-time wiring (each checks state first, so a rerun is safe)
  const td = await ethers.getContractAt("BackstopTokenDeployer", c.tokenDeployer);
  if ((await td.factory()) === ethers.ZeroAddress) await track("tokenDeployer.setFactory", td.setFactory(c.factory));
  const sd = await ethers.getContractAt("BackstopStrategyDeployer", c.strategyDeployer);
  if ((await sd.factory()) === ethers.ZeroAddress) await track("strategyDeployer.setFactory", sd.setFactory(c.factory));
  const hook = await ethers.getContractAt("BackstopHook", c.hook);
  if ((await hook.factory()) === ethers.ZeroAddress) await track("hook.setFactory", hook.setFactory(c.factory));
  const factory = await ethers.getContractAt("BackstopFactory", c.factory);
  if ((await factory.converter()) === ethers.ZeroAddress) await track("factory.setConverter", factory.setConverter(c.router));

  // price the common backing tokens now (anyone can register more later)
  const oracle = await ethers.getContractAt("BackstopOracle", c.oracle);
  dep.sources = dep.sources ?? {};
  for (const s of SOURCES) {
    if (dep.sources[s.name]) continue;
    try { await track(`oracle.register ${s.name}`, oracle.register({ dex: s.dex, pool: s.pool, key: EMPTY_KEY })); dep.sources[s.name] = s.pool; save(); }
    catch (e: any) { console.log(`  ${s.name}: not registered (${e.shortMessage ?? e.message})`); }
  }

  if ((await factory.owner()) !== ethers.ZeroAddress && process.env.KEEP_OWNER !== "1") { await track("factory.renounceOwnership", factory.renounceOwnership()); dep.renounced = true; save(); }

  const gp = (await ethers.provider.getFeeData()).gasPrice ?? 0n;
  console.log(`total ${total} gas this run (~${ethers.formatEther(total * gp)} ETH at ${ethers.formatUnits(gp, "gwei")} gwei)`);
  console.log(JSON.stringify(c, null, 2));
}

async function verify(dep: any) {
  const c = dep.contracts;
  const jobs: [string, string, any[]][] = [
    ["contracts/v4/backstop/test/HookDeployer.sol:HookDeployer", c.hookDeployer, []],
    ["contracts/v4/backstop/BackstopHook.sol:BackstopHook", c.hook, [POOL_MANAGER]],
    ["contracts/v4/backstop/BackstopOracle.sol:BackstopOracle", c.oracle, [{ admin: dep.admin, weth: WETH, poolManager: POOL_MANAGER, uniV2Factory: UNI_V2_FACTORY, uniV3Factory: UNI_V3_FACTORY, ethUsdFeed: ETH_USD_FEED, ethUsd8: dep.oracleArgs.ethUsd8, usdc: USDC, usdcUsdFeed: USDC_USD_FEED }]],
    ["contracts/v4/backstop/BackstopTokenDeployer.sol:BackstopTokenDeployer", c.tokenDeployer, []],
    ["contracts/v4/backstop/BackstopStrategyDeployer.sol:BackstopStrategyDeployer", c.strategyDeployer, []],
    ["contracts/v4/backstop/BackstopFactory.sol:BackstopFactory", c.factory, [dep.deployer ?? (await ethers.getSigners())[0].address, dep.admin, POOL_MANAGER, c.hook, c.tokenDeployer, c.strategyDeployer, WETH, c.oracle, dep.admin]],
    ["contracts/v4/backstop/BackstopRouter.sol:BackstopRouter", c.router, [POOL_MANAGER, c.factory, WETH]],
  ];
  for (const [contract, address, args] of jobs) {
    try { await run("verify:verify", { address, constructorArguments: args, contract }); console.log("verified", contract); }
    catch (e: any) { console.log("verify", contract, ":", (e.message ?? "").split("\n")[0]); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
