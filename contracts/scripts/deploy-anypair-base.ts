/* eslint-disable no-console */
// Deploys Anypair on Base: AnypairHook (CREATE2 at a flag-encoding address),
// AnypairOracle, token deployer, factory and router; wires them; lists USDC
// (Chainlink) as a price anchor; renounces the deployer's setup rights.
// Platform fees go to the admin wallet. Resumable: every step is skipped when
// the deployment record already has it.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://mainnet.base.org \
//   ROBINHOOD_CHAIN_ID=8453 ADMIN=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b \
//     npx hardhat run scripts/deploy-anypair-base.ts --network robinhood
//
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
const WETH = "0x4200000000000000000000000000000000000006";
const UNI_V3_FACTORY = "0x33128a8fC17869897dcE68Ed026d694621f6FDfD";
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865";
const SLIPSTREAM_FACTORY = "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A";
const SLIPSTREAM_FACTORY2 = "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a";
const SLIPSTREAM_FACTORY3 = "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef"; // newer Aerodrome CL factory (Coinbase stock pools live here)
const AERO_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
const ETH_USD_FEED = "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_USD_FEED = "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B";
const TAX_BPS = 200; // 2% of the pair side on every swap, fixed per pool
const CREATOR_BPS = 3500; // 0.7%
const HOLDER_BPS = 2500; // 0.5%; platform gets the remaining 40% = 0.8%
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

async function main() {
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const admin = ethers.getAddress(process.env.ADMIN ?? deployer.address);
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "base-anypair.json");
  const dep = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : { contracts: {} };
  const save = () => fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  const feed = await ethers.getContractAt(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], ETH_USD_FEED);
  const ethUsd8: bigint = (await feed.latestRoundData())[1];
  const bal0 = await ethers.provider.getBalance(deployer.address);
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(bal0), "ETH $" + (Number(ethUsd8) / 1e8).toFixed(2), "admin", admin);
  if (!dep.deployBlock) { dep.deployBlock = await ethers.provider.getBlockNumber(); save(); }

  // 1. Hook at a flag-encoding address; its deployer (tx.origin) wires the factory once.
  if (!dep.contracts.hook) {
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("AnypairHook");
    const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [POOL_MANAGER])]);
    const hash = ethers.keccak256(init);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 5_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
    }
    if (!hookAddr) throw new Error("no hook salt");
    await (await c2.deploy(salt, init)).wait();
    Object.assign(dep.contracts, { hookDeployer: c2Addr, hookSalt: salt, hook: hookAddr });
    save();
  }
  console.log("hook", dep.contracts.hook);
  const hook = await ethers.getContractAt("AnypairHook", dep.contracts.hook);

  // 2. Oracle (prices pairs and basket assets from Uniswap V3/V4, Aerodrome and PancakeSwap pools).
  if (!dep.contracts.oracle) {
    const o = await (await ethers.getContractFactory("AnypairOracle")).deploy({
      admin, weth: WETH, poolManager: POOL_MANAGER, uniV3Factory: UNI_V3_FACTORY, pancakeV3Factory: PANCAKE_V3_FACTORY,
      slipstreamFactories: [SLIPSTREAM_FACTORY, SLIPSTREAM_FACTORY2, SLIPSTREAM_FACTORY3], aeroFactory: AERO_FACTORY, ethUsdFeed: ETH_USD_FEED, ethUsd8,
      usdc: USDC, usdcUsdFeed: USDC_USD_FEED, // USDC anchors pools from the first block: no admin step after deploy
    });
    await o.waitForDeployment();
    dep.contracts.oracle = await o.getAddress();
    save();
  }
  console.log("oracle", dep.contracts.oracle);
  const oracle = await ethers.getContractAt("AnypairOracle", dep.contracts.oracle);

  // 3. Token deployer and factory (platform fees to the admin wallet).
  if (!dep.contracts.tokenDeployer) {
    const td = await (await ethers.getContractFactory("AnypairTokenDeployer")).deploy();
    await td.waitForDeployment();
    dep.contracts.tokenDeployer = await td.getAddress();
    save();
  }
  console.log("tokenDeployer", dep.contracts.tokenDeployer);
  if (!dep.contracts.factory) {
    const f = await (await ethers.getContractFactory("AnypairFactory")).deploy(
      deployer.address, admin, POOL_MANAGER, dep.contracts.hook, dep.contracts.tokenDeployer, WETH, dep.contracts.oracle, TAX_BPS, CREATOR_BPS, HOLDER_BPS, admin,
    );
    await f.waitForDeployment();
    dep.contracts.factory = await f.getAddress();
    dep.factoryOwner = deployer.address;
    save();
  }
  const factoryAddr: string = dep.contracts.factory;
  console.log("factory", factoryAddr);
  const td = await ethers.getContractAt("AnypairTokenDeployer", dep.contracts.tokenDeployer);
  if ((await td.factory()) === ethers.ZeroAddress) { await (await td.setFactory(factoryAddr)).wait(); console.log("token deployer wired"); }
  if ((await hook.factory()) === ethers.ZeroAddress) { await (await hook.setFactory(factoryAddr)).wait(); console.log("hook -> factory wired"); }
  const factory = await ethers.getContractAt("AnypairFactory", factoryAddr);

  // 4. Router, wired once as the factory's converter.
  if (!dep.contracts.router) {
    const r = await (await ethers.getContractFactory("AnypairRouter")).deploy(POOL_MANAGER, factoryAddr, WETH);
    await r.waitForDeployment();
    dep.contracts.router = await r.getAddress();
    save();
  }
  console.log("router", dep.contracts.router);
  if ((await factory.converter()) === ethers.ZeroAddress) { await (await factory.setConverter(dep.contracts.router)).wait(); console.log("converter wired"); }

  // 5. USDC is listed by the oracle's constructor (Chainlink USDC/USD): check it.
  console.log("USDC anchor listed:", (await oracle.listed(USDC)).listed);

  // 6. Renounce setup rights.
  if (process.env.RENOUNCE !== "0" && (await factory.owner()).toLowerCase() === deployer.address.toLowerCase()) {
    await (await factory.renounceOwnership()).wait();
    console.log("setup rights renounced; admin", await factory.admin());
  }

  Object.assign(dep, {
    network: "base", chainId: Number(net.chainId), admin, feeRecipient: await factory.feeRecipient(),
    uniswap: { poolManager: POOL_MANAGER, weth: WETH, v3Factory: UNI_V3_FACTORY },
    dexes: { pancakeV3Factory: PANCAKE_V3_FACTORY, slipstreamFactories: [SLIPSTREAM_FACTORY, SLIPSTREAM_FACTORY2, SLIPSTREAM_FACTORY3], aeroFactory: AERO_FACTORY },
    feeds: { ethUsd: ETH_USD_FEED, usdcUsd: USDC_USD_FEED }, usdc: USDC,
    fees: { taxBps: TAX_BPS, creatorBps: CREATOR_BPS, holderBps: HOLDER_BPS, platformBps: 10000 - CREATOR_BPS - HOLDER_BPS },
    deployedAt: dep.deployedAt ?? new Date().toISOString(),
  });
  save();
  const bal1 = await ethers.provider.getBalance(deployer.address);
  console.log("wrote", depFile, "| spent", ethers.formatEther(bal0 - bal1), "ETH | left", ethers.formatEther(bal1));
}

main().catch((e) => { console.error(e); process.exit(1); });
