/* eslint-disable no-console */
// Deploys cntrl-z to Ethereum mainnet (or a fork of it), resumable: every address
// is written to deployments/eth-cntrlz.json as it lands, and a rerun skips what is
// already there. The price oracle is the Etherhook one already on mainnet.
//
//   fork rehearsal:  FORK=1 npx hardhat --config hardhat.config.cntrlz.ts run scripts/deploy-cntrlz-eth.ts
//   mainnet:         GAS_PRICE_GWEI=0.2 npx hardhat --config hardhat.config.cntrlz.ts run scripts/deploy-cntrlz-eth.ts --network mainnet
//   then verify:     VERIFY=1 ... same command
//
// Setup rights (the factory's `owner`) are renounced at the end; the admin keeps
// its own functions.
import { ethers, network, run } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ORACLE = "0xD1Ca49bd44A447c48d2a1FAC5F35cF583D8a7b1b";
// beforeInitialize, beforeAddLiquidity, beforeRemoveLiquidity, beforeSwap, afterSwap, beforeDonate, beforeSwapReturnDelta, afterSwapReturnDelta
const HOOK_FLAGS = (1n << 13n) | (1n << 11n) | (1n << 9n) | (1n << 7n) | (1n << 6n) | (1n << 5n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

const FILE = path.join(__dirname, "..", "deployments", network.name === "mainnet" ? "eth-cntrlz.json" : "eth-cntrlz-fork.json");

async function main() {
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const [me] = await ethers.getSigners();
  const admin = process.env.ADMIN ?? "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
  const dep: any = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { chainId: 1, admin, oracle: ORACLE, contracts: {}, gas: {} };
  const c = dep.contracts;
  const save = () => fs.writeFileSync(FILE, JSON.stringify(dep, null, 2));
  let total = 0n;
  const track = async (label: string, p: any) => { const tx = await p; const rc = await (tx.wait ? tx.wait() : tx.deploymentTransaction().wait()); dep.gas[label] = rc.gasUsed.toString(); total += rc.gasUsed; console.log(`  ${label}: ${rc.gasUsed} gas`); return tx; };
  console.log("network", network.name, "deployer", me.address, "balance", ethers.formatEther(await ethers.provider.getBalance(me.address)), "ETH, admin", admin);

  if (process.env.VERIFY === "1") return verify(dep);

  if (!c.hookDeployer) { const d = await track("hookDeployer", (await ethers.getContractFactory("HookDeployer")).deploy()); c.hookDeployer = await d.getAddress(); save(); }
  if (!c.hook) {
    const Hook = await ethers.getContractFactory("CtrlzHook");
    const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "address"], [POOL_MANAGER, WETH, ORACLE])]);
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
  if (!c.tokenDeployer) { const d = await track("tokenDeployer", (await ethers.getContractFactory("CtrlzTokenDeployer")).deploy()); c.tokenDeployer = await d.getAddress(); save(); }
  if (!c.factory) {
    const f = await track("factory", (await ethers.getContractFactory("CtrlzFactory")).deploy(me.address, admin, POOL_MANAGER, c.hook, c.tokenDeployer, WETH, ORACLE, admin));
    c.factory = await f.getAddress(); dep.deployer = me.address; dep.deployBlock = await ethers.provider.getBlockNumber(); save();
  }
  if (!c.router) { const r = await track("router", (await ethers.getContractFactory("CtrlzRouter")).deploy(POOL_MANAGER, c.factory, WETH)); c.router = await r.getAddress(); save(); }

  // one-time wiring (each checks state first, so a rerun is safe)
  const td = await ethers.getContractAt("CtrlzTokenDeployer", c.tokenDeployer);
  if ((await td.factory()) === ethers.ZeroAddress) await track("tokenDeployer.setFactory", td.setFactory(c.factory));
  const hook = await ethers.getContractAt("CtrlzHook", c.hook);
  if ((await hook.factory()) === ethers.ZeroAddress) await track("hook.setFactory", hook.setFactory(c.factory));
  const factory = await ethers.getContractAt("CtrlzFactory", c.factory);
  if ((await factory.converter()) === ethers.ZeroAddress) await track("factory.setConverter", factory.setConverter(c.router));
  if ((await factory.owner()) !== ethers.ZeroAddress && process.env.KEEP_OWNER !== "1") { await track("factory.renounceOwnership", factory.renounceOwnership()); dep.renounced = true; save(); }

  const gp = (await ethers.provider.getFeeData()).gasPrice ?? 0n;
  console.log(`total ${total} gas this run (~${ethers.formatEther(total * gp)} ETH at ${ethers.formatUnits(gp, "gwei")} gwei)`);
  console.log(JSON.stringify(c, null, 2));
}

async function verify(dep: any) {
  const c = dep.contracts;
  const jobs: [string, string, any[]][] = [
    ["contracts/v4/cntrlz/test/HookDeployer.sol:HookDeployer", c.hookDeployer, []],
    ["contracts/v4/cntrlz/CtrlzHook.sol:CtrlzHook", c.hook, [POOL_MANAGER, WETH, ORACLE]],
    ["contracts/v4/cntrlz/CtrlzTokenDeployer.sol:CtrlzTokenDeployer", c.tokenDeployer, []],
    ["contracts/v4/cntrlz/CtrlzFactory.sol:CtrlzFactory", c.factory, [dep.deployer ?? (await ethers.getSigners())[0].address, dep.admin, POOL_MANAGER, c.hook, c.tokenDeployer, WETH, ORACLE, dep.admin]],
    ["contracts/v4/cntrlz/CtrlzRouter.sol:CtrlzRouter", c.router, [POOL_MANAGER, c.factory, WETH]],
  ];
  for (const [contract, address, args] of jobs) {
    try { await run("verify:verify", { address, constructorArguments: args, contract }); console.log("verified", contract); }
    catch (e: any) { console.log("verify", contract, ":", (e.message ?? "").split("\n")[0]); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
