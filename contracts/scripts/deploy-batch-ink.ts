/* eslint-disable no-console */
// Deploys Batch on Ink: BatchHook (CREATE2 at a flag-encoding address), token
// deployer, factory, ledger, router, payout and treasury; wires them; approves
// the wrapped xStocks as basket assets; points the fee recipient at the
// treasury (admin tx, so only when ADMIN is the deployer or ADMIN_TX=1 with
// the admin key); renounces the deployer's setup rights. Resumable: every
// step is skipped when the record already has it.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com \
//   ROBINHOOD_CHAIN_ID=57073 PRIVATE_KEY=... ADMIN=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b \
//     npx hardhat run scripts/deploy-batch-ink.ts --network robinhood
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER02 = "0x177778F19E89dD1012BdBe603F144088A95C4B53"; // Uniswap V3 SwapRouter02 on Ink
const USDG = "0xe343167631d89B6Ffc58B88d6b7fB0228795491D";
const TAX_BPS = 200; // 2% of the pair side on every swap, fixed per pool
const CREATOR_BPS = 3500; // 0.7%
const HOLDER_BPS = 2500; // 0.5% in the basket; platform gets the remaining 40% = 0.8%
// Official wrapped Backed xStocks on Ink (wrapper deployer 0x28b4…1Db2A) that
// have a funded USDG pool on the canonical Uniswap V3 factory; scanned 2026-10-01.
// `fee` is the deepest USDG pool's tier, used for pricing and as the basket route.
const STOCKS = [
  { symbol: "wNVDAx", address: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", fee: 500 },
  { symbol: "wSPYx", address: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540", fee: 3000 },
  { symbol: "wQQQx", address: "0x4C1AE29c159838fC1b224636E28E086EB69101f7", fee: 3000 },
  { symbol: "wTSLAx", address: "0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171", fee: 500 },
  { symbol: "wAAPLx", address: "0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f", fee: 500 },
  { symbol: "wMSTRx", address: "0x30987adF0B11dc698438a99BA04ec3a1AB2c7EaB", fee: 500 },
  { symbol: "wSPCXx", address: "0x8e2eed8b8b5e13ea7bf38e50d7821d2c57309072", fee: 500 },
  { symbol: "wPLTRx", address: "0x4A2df09536F62341C9f946427D16414C04e21342", fee: 500 },
  { symbol: "wNFLXx", address: "0x7d87fD6A379714194a797c0bBB8B40c30D250856", fee: 500 },
];
const V3_FACTORY = "0x640887a9ba3a9c53ed27d0f7e8246a4f933f3424";
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

/// USD per whole stock (8 dp) from its USDG 0.05% V3 pool spot price (USDG has 6 decimals).
async function stockUsd8(stock: string, fee: number): Promise<bigint> {
  const f = await ethers.getContractAt(["function getPool(address,address,uint24) view returns (address)"], V3_FACTORY);
  const pool: string = await f.getPool(stock, USDG, fee);
  if (pool === ethers.ZeroAddress) return 0n;
  const p = await ethers.getContractAt(["function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"], pool);
  const [sqrt] = await p.slot0();
  const t0: string = await p.token0();
  const q = (BigInt(sqrt) * BigInt(sqrt)); // price1/0 = q / 2^192
  // stock is token0: price = USDG per stock = q/2^192 * 1e18/1e6 ; else inverse.
  return t0.toLowerCase() === stock.toLowerCase()
    ? (q * 10n ** 12n * 10n ** 8n) / (1n << 192n)
    : ((1n << 192n) * 10n ** 12n * 10n ** 8n) / q;
}

async function ethUsd8(): Promise<bigint> {
  if (process.env.ETH_USD8) return BigInt(process.env.ETH_USD8);
  // WETH/USDT0 0.3% V3 pool spot price (USDT0 6 dp).
  const USDT0 = "0x0200C29006150606B650577BBE7B6248F58470c1";
  const f = await ethers.getContractAt(["function getPool(address,address,uint24) view returns (address)"], V3_FACTORY);
  const pool: string = await f.getPool(WETH, USDT0, 3000);
  const p = await ethers.getContractAt(["function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"], pool);
  const [sqrt] = await p.slot0();
  const t0: string = await p.token0();
  const q = BigInt(sqrt) * BigInt(sqrt);
  return t0.toLowerCase() === WETH.toLowerCase() ? (q * 10n ** 12n * 10n ** 8n) / (1n << 192n) : ((1n << 192n) * 10n ** 12n * 10n ** 8n) / q;
}

async function main() {
  // On a local fork the fork block itself is "historical" to EDR; mine one so reads work.
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const admin = ethers.getAddress(process.env.ADMIN ?? deployer.address);
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ink-batch.json");
  const dep = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : { contracts: {}, quotes: [] };
  const save = () => fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  const price = await ethUsd8();
  const bal0 = await ethers.provider.getBalance(deployer.address);
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(bal0), "ETH usd8", price.toString(), "admin", admin);

  // 1. Hook at a flag-encoding address. Its deployer (tx.origin) wires the factory and the ledger once each.
  if (!dep.contracts.hook) {
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("BatchHook");
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
  const hook = await ethers.getContractAt("BatchHook", dep.contracts.hook);

  // 3. Ledger, wired into the hook once.
  if (!dep.contracts.ledger) {
    const l = await (await ethers.getContractFactory("BatchLedger")).deploy(dep.contracts.hook, WETH);
    await l.waitForDeployment();
    dep.contracts.ledger = await l.getAddress();
    dep.ledgerGenesis = Number(await l.genesis());
    save();
  }
  console.log("ledger", dep.contracts.ledger, "genesis", dep.ledgerGenesis);
  if ((await hook.ledger()) === ethers.ZeroAddress) { await (await hook.setLedger(dep.contracts.ledger)).wait(); console.log("hook -> ledger wired"); }

  // 5. Payout (leaderboard pool) and treasury (fee recipient).
  if (!dep.contracts.payout) {
    const p = await (await ethers.getContractFactory("BatchPayout")).deploy(WETH, admin, dep.contracts.ledger);
    await p.waitForDeployment();
    dep.contracts.payout = await p.getAddress();
    save();
  }
  console.log("payout", dep.contracts.payout);
  if (!dep.contracts.treasury) {
    const t = await (await ethers.getContractFactory("BatchTreasury")).deploy(WETH, admin, dep.contracts.payout);
    await t.waitForDeployment();
    dep.contracts.treasury = await t.getAddress();
    save();
  }
  console.log("treasury", dep.contracts.treasury);

  // 2b. Token deployer and factory (fee recipient = treasury from the first block).
  if (!dep.contracts.tokenDeployer) {
    const td = await (await ethers.getContractFactory("BatchTokenDeployer")).deploy();
    await td.waitForDeployment();
    dep.contracts.tokenDeployer = await td.getAddress();
    save();
  }
  console.log("tokenDeployer", dep.contracts.tokenDeployer);
  if (!dep.contracts.factory) {
    const f = await (await ethers.getContractFactory("BatchFactory")).deploy(
      deployer.address, admin, POOL_MANAGER, dep.contracts.hook, dep.contracts.tokenDeployer, WETH, price, TAX_BPS, CREATOR_BPS, HOLDER_BPS, dep.contracts.treasury,
    );
    await f.waitForDeployment();
    dep.contracts.factory = await f.getAddress();
    dep.factoryOwner = deployer.address;
    dep.deployBlock = await ethers.provider.getBlockNumber();
    save();
  }
  const factoryAddr: string = dep.contracts.factory;
  console.log("factory", factoryAddr);
  const td = await ethers.getContractAt("BatchTokenDeployer", dep.contracts.tokenDeployer);
  if ((await td.factory()) === ethers.ZeroAddress) { await (await td.setFactory(factoryAddr)).wait(); console.log("token deployer wired"); }
  if ((await hook.factory()) === ethers.ZeroAddress) { await (await hook.setFactory(factoryAddr)).wait(); console.log("hook -> factory wired"); }
  const factory = await ethers.getContractAt("BatchFactory", factoryAddr);

  // 4. Router, wired once as the factory's converter.
  if (!dep.contracts.router) {
    const r = await (await ethers.getContractFactory("BatchRouter")).deploy(POOL_MANAGER, factoryAddr, WETH, ROUTER02);
    await r.waitForDeployment();
    dep.contracts.router = await r.getAddress();
    save();
  }
  console.log("router", dep.contracts.router);
  if ((await factory.converter()) === ethers.ZeroAddress) { await (await factory.setConverter(dep.contracts.router)).wait(); console.log("converter wired"); }

  // 6. Basket assets: the wrapped xStocks, priced from their USDG pools.
  if (process.env.QUOTES !== "0") {
    dep.quotes ??= [];
    const done = new Set(dep.quotes.map((q: any) => q.address.toLowerCase()));
    for (const raw of STOCKS) {
      const s = { ...raw, address: ethers.getAddress(raw.address) };
      if (done.has(s.address.toLowerCase())) continue;
      const usd8 = await stockUsd8(s.address, s.fee);
      if (usd8 === 0n) { console.log("  !", s.symbol, "no USDG pool"); continue; }
      const tx = await factory.setQuoteAsset(s.address, true, usd8, ethers.ZeroAddress);
      await tx.wait();
      dep.quotes.push({ symbol: s.symbol, address: s.address, usd8: usd8.toString(), usd: Number(usd8) / 1e8, usdgPoolFee: s.fee });
      save();
      console.log("  +", s.symbol, "$" + (Number(usd8) / 1e8).toFixed(2), tx.hash);
    }
  }

  // 8. Renounce setup rights.
  if (process.env.RENOUNCE !== "0" && (await factory.owner()).toLowerCase() === deployer.address.toLowerCase()) {
    await (await factory.renounceOwnership()).wait();
    console.log("setup rights renounced; admin", await factory.admin());
  }

  Object.assign(dep, {
    network: "ink", chainId: Number(net.chainId), admin, feeRecipient: await factory.feeRecipient(), ethUsd8: price.toString(),
    uniswap: { poolManager: POOL_MANAGER, weth: WETH, swapRouter02: ROUTER02, v3Factory: V3_FACTORY, usdg: USDG },
    fees: { taxBps: TAX_BPS, creatorBps: CREATOR_BPS, holderBps: HOLDER_BPS, platformBps: 10000 - CREATOR_BPS - HOLDER_BPS, payoutBpsOfPlatform: 1250 },
    leaderboard: { epochSeconds: 3 * 86400, winnersPerBoard: 5, tiersBps: [4000, 2500, 1500, 1200, 800] },
    basketRoute: "WETH -(1%)-> USDG -(usdgPoolFee)-> stock, Uniswap V3",
    deployedAt: dep.deployedAt ?? new Date().toISOString(),
  });
  save();
  const bal1 = await ethers.provider.getBalance(deployer.address);
  console.log("wrote", depFile, "| spent", ethers.formatEther(bal0 - bal1), "ETH | left", ethers.formatEther(bal1));
}

main().catch((e) => { console.error(e); process.exit(1); });
