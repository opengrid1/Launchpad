/* eslint-disable no-console */
// Deploys the mainnet stockpad on Ethereum: hook (CREATE2 at a flag-encoding
// address), factory, router; wires them; approves every priced pair asset from
// deployments/ethereum-stock-quotes.json; renounces factory ownership so only
// the immutable ADMIN keeps control. Resumable: set HOOK/FACTORY/ROUTER to
// skip deploys already done, QUOTES=0 to skip approvals, RENOUNCE=0 to keep
// ownership for now.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com \
//   ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... ADMIN=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b \
//     npx hardhat run scripts/deploy-stockpad-eth.ts --network robinhood
import { ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ROUTER02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // Chainlink ETH/USD
const TAX_BPS = 400; // 4% of the pair side on every swap
const CREATOR_BPS = 5000;
const HOLDER_BPS = 3000;

// beforeSwap | afterSwap | beforeSwapReturnDelta | afterSwapReturnDelta
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

async function ethUsd8(): Promise<bigint> {
  if (process.env.ETH_USD8) return BigInt(process.env.ETH_USD8);
  const feed = await ethers.getContractAt(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], ETH_USD_FEED);
  const [, answer] = await feed.latestRoundData();
  return BigInt(answer);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  const admin = ethers.getAddress(process.env.ADMIN ?? deployer.address);
  // DEPLOY_FILE redirects the record (e.g. a local fork run) away from the mainnet file.
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-stockpad.json");
  const dep = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : { contracts: {}, quotes: [] };
  const price = await ethUsd8();
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH usd8", price.toString(), "admin", admin);

  // 1. Hook at a flag-encoding address.
  let hookAddr: string = process.env.HOOK ?? dep.contracts.hook ?? "";
  if (!hookAddr) {
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("StockPadHook");
    const init = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, admin])]);
    const hash = ethers.keccak256(init);
    let salt = "";
    for (let i = 0n; i < 5_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
    }
    if (!hookAddr) throw new Error("no hook salt");
    await (await c2.deploy(salt, init)).wait();
    dep.contracts.hookDeployer = c2Addr;
    dep.contracts.hookSalt = salt;
    dep.contracts.hook = hookAddr;
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  }
  console.log("hook", hookAddr);
  const hook = await ethers.getContractAt("StockPadHook", hookAddr);

  // 2. Factory (deployer owns it until renounce; admin is immutable).
  let factoryAddr: string = process.env.FACTORY ?? dep.contracts.factory ?? "";
  if (!factoryAddr) {
    const f = await (await ethers.getContractFactory("StockPadFactory")).deploy(deployer.address, admin, POOL_MANAGER, hookAddr, WETH, price, TAX_BPS, CREATOR_BPS, HOLDER_BPS);
    await f.waitForDeployment();
    factoryAddr = await f.getAddress();
    dep.contracts.factory = factoryAddr;
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  }
  console.log("factory", factoryAddr);
  const factory = await ethers.getContractAt("StockPadFactory", factoryAddr);
  if ((await hook.factory()) === ethers.ZeroAddress) { await (await hook.setFactory(factoryAddr)).wait(); console.log("hook wired"); }

  // 3. Router (ETH routing + fee conversion), wired as the factory's converter.
  let routerAddr: string = process.env.ROUTER ?? dep.contracts.router ?? "";
  if (!routerAddr) {
    const r = await (await ethers.getContractFactory("StockPadRouter")).deploy(POOL_MANAGER, factoryAddr, WETH, ROUTER02);
    await r.waitForDeployment();
    routerAddr = await r.getAddress();
    dep.contracts.router = routerAddr;
    fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  }
  console.log("router", routerAddr);
  if ((await factory.converter()) === ethers.ZeroAddress) { await (await factory.setConverter(routerAddr)).wait(); console.log("converter wired"); }

  // 4. Pair assets. WETH gets the Chainlink ETH/USD feed so every dollar
  //    figure tracks the live price.
  if (process.env.QUOTES !== "0") {
    const w = await factory.quoteAssets(WETH);
    if ((w.feed as string).toLowerCase() !== ETH_USD_FEED.toLowerCase()) {
      await (await factory.setQuoteAsset(WETH, true, price, ETH_USD_FEED)).wait();
      console.log("WETH priced by Chainlink");
    }
    const quotes = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "ethereum-stock-quotes.json"), "utf8")).quotes as { symbol: string; address: string; usd: number }[];
    const done = new Set((dep.quotes ?? []).map((q: any) => q.address.toLowerCase()));
    for (const q of quotes) {
      if (!(q.usd > 0) || done.has(q.address.toLowerCase())) continue;
      const usd8 = BigInt(Math.round(q.usd * 1e8));
      try {
        const tx = await factory.setQuoteAsset(q.address, true, usd8, ethers.ZeroAddress);
        await tx.wait();
        dep.quotes.push({ symbol: q.symbol, address: q.address, usd: q.usd, usd8: usd8.toString() });
        fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
        console.log("  +", q.symbol, "$" + q.usd, tx.hash);
      } catch (e: any) {
        console.log("  !", q.symbol, (e.shortMessage ?? e.message ?? String(e)).slice(0, 120));
      }
    }
  }

  // 5. Renounce: only the immutable admin keeps control.
  if (process.env.RENOUNCE !== "0" && (await factory.owner()).toLowerCase() === deployer.address.toLowerCase()) {
    await (await factory.renounceOwnership()).wait();
    console.log("ownership renounced; admin", await factory.admin());
  }

  Object.assign(dep, {
    chainId: Number(net.chainId), admin, feeRecipient: admin, ethUsd8: price.toString(),
    uniswap: { poolManager: POOL_MANAGER, weth: WETH, swapRouter02: ROUTER02 },
    fees: { taxBps: TAX_BPS, creatorBps: CREATOR_BPS, holderBps: HOLDER_BPS, platformBps: 10000 - CREATOR_BPS - HOLDER_BPS },
    deployBlock: dep.deployBlock ?? (await ethers.provider.getBlockNumber()), deployedAt: dep.deployedAt ?? new Date().toISOString(),
  });
  fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  console.log("wrote", depFile, "bal after", ethers.formatEther(await ethers.provider.getBalance(deployer.address)));
}

main().catch((e) => { console.error(e); process.exit(1); });
