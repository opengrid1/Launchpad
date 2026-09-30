/* eslint-disable no-console */
// Deploys Estonks v2 on Ethereum: EstonksHook (CREATE2 at a flag-encoding
// address), token deployer, factory and router; wires them; approves WETH
// (Chainlink-priced) plus the stocks in deployments/estonks-v2-pairs.json;
// renounces the deployer's setup rights so only the immutable ADMIN keeps
// control. With MAIN_TOKEN (a coin launched on this factory) it also deploys
// the distributor. Resumable: every step is skipped when the record already
// has it. QUOTES=0 skips pair approvals, RENOUNCE=0 keeps setup rights.
// SMOKE=1 (local fork only) launches a basket coin and trades it afterwards.
//
//   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://ethereum-rpc.publicnode.com \
//   ROBINHOOD_CHAIN_ID=1 PRIVATE_KEY=... ADMIN=0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b \
//     npx hardhat run scripts/deploy-estonks-v2.ts --network robinhood
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const ROUTER02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const ETH_USD_FEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"; // Chainlink ETH/USD
const TAX_BPS = 200; // 2% of the pair side on every swap, fixed per pool
const CREATOR_BPS = 3500; // 0.7% of the 2%
const HOLDER_BPS = 1500; // 0.3% of the 2%; platform (STONK holders) gets the remaining 50% = 1.0%

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
  const depFile = process.env.DEPLOY_FILE ?? path.join(__dirname, "..", "deployments", "ethereum-estonks-v2.json");
  const dep = fs.existsSync(depFile) ? JSON.parse(fs.readFileSync(depFile, "utf8")) : { contracts: {}, quotes: [] };
  const save = () => fs.writeFileSync(depFile, JSON.stringify(dep, null, 2));
  const price = await ethUsd8();
  const bal0 = await ethers.provider.getBalance(deployer.address);
  console.log("chain", net.chainId.toString(), "deployer", deployer.address, "bal", ethers.formatEther(bal0), "ETH usd8", price.toString(), "admin", admin);

  // 1. Hook at a flag-encoding address. Its deployer (tx.origin) wires the factory once.
  if (!dep.contracts.hook) {
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    await c2.waitForDeployment();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EstonksHook");
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
  const hook = await ethers.getContractAt("EstonksHook", dep.contracts.hook);

  // 2. Token deployer and factory (the deployer holds setup rights until renounce; admin is immutable).
  if (!dep.contracts.tokenDeployer) {
    const td = await (await ethers.getContractFactory("EstonksTokenDeployer")).deploy();
    await td.waitForDeployment();
    dep.contracts.tokenDeployer = await td.getAddress();
    save();
  }
  console.log("tokenDeployer", dep.contracts.tokenDeployer);
  if (!dep.contracts.factory) {
    const f = await (await ethers.getContractFactory("EstonksFactory")).deploy(
      deployer.address, admin, POOL_MANAGER, dep.contracts.hook, dep.contracts.tokenDeployer, WETH, price, TAX_BPS, CREATOR_BPS, HOLDER_BPS,
    );
    await f.waitForDeployment();
    dep.contracts.factory = await f.getAddress();
    dep.factoryOwner = deployer.address; // constructor arg, for verification
    dep.deployBlock = await ethers.provider.getBlockNumber();
    save();
  }
  const factoryAddr: string = dep.contracts.factory;
  console.log("factory", factoryAddr);
  const td = await ethers.getContractAt("EstonksTokenDeployer", dep.contracts.tokenDeployer);
  if ((await td.factory()) === ethers.ZeroAddress) { await (await td.setFactory(factoryAddr)).wait(); console.log("token deployer wired"); }
  if ((await hook.factory()) === ethers.ZeroAddress) { await (await hook.setFactory(factoryAddr)).wait(); console.log("hook wired"); }
  const factory = await ethers.getContractAt("EstonksFactory", factoryAddr);

  // 3. Router (ETH routing, claims as ETH or basket), wired once as the factory's converter.
  if (!dep.contracts.router) {
    const r = await (await ethers.getContractFactory("EstonksRouter")).deploy(POOL_MANAGER, factoryAddr, WETH, ROUTER02);
    await r.waitForDeployment();
    dep.contracts.router = await r.getAddress();
    save();
  }
  console.log("router", dep.contracts.router);
  if ((await factory.converter()) === ethers.ZeroAddress) { await (await factory.setConverter(dep.contracts.router)).wait(); console.log("converter wired"); }

  // 4. Pair assets: WETH on the Chainlink feed, then the liquid, routed stocks.
  if (process.env.QUOTES !== "0") {
    const w = await factory.quoteAssets(WETH);
    if ((w.feed as string).toLowerCase() !== ETH_USD_FEED.toLowerCase()) {
      await (await factory.setQuoteAsset(WETH, true, price, ETH_USD_FEED)).wait();
      console.log("WETH priced by Chainlink");
    }
    const stocks = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", "estonks-v2-pairs.json"), "utf8")).stocks as { symbol: string; address: string; usd: number }[];
    dep.quotes ??= [];
    const done = new Set(dep.quotes.map((q: any) => q.address.toLowerCase()));
    for (const q of stocks) {
      if (!(q.usd > 0) || done.has(q.address.toLowerCase())) continue;
      const usd8 = BigInt(Math.round(q.usd * 1e8));
      try {
        const tx = await factory.setQuoteAsset(ethers.getAddress(q.address), true, usd8, ethers.ZeroAddress);
        await tx.wait();
        dep.quotes.push({ symbol: q.symbol, address: ethers.getAddress(q.address), usd: q.usd, usd8: usd8.toString() });
        save();
        console.log("  +", q.symbol, "$" + q.usd, tx.hash);
      } catch (e: any) {
        console.log("  !", q.symbol, (e.shortMessage ?? e.message ?? String(e)).slice(0, 120));
      }
    }
  }

  // 5. The distributor: the fee recipient that pays the main coin's holders.
  //    Needs MAIN_TOKEN, a WETH coin launched on this factory. The admin then
  //    points factory.setFeeRecipient at it.
  if (process.env.MAIN_TOKEN && !dep.contracts.distributor) {
    const main = ethers.getAddress(process.env.MAIN_TOKEN);
    if ((await factory.listings(main)).createdAt === 0n) throw new Error("MAIN_TOKEN was not launched on this factory");
    const d = await (await ethers.getContractFactory("EstonksDistributor")).deploy(main, WETH, dep.contracts.router);
    await d.waitForDeployment();
    dep.contracts.distributor = await d.getAddress();
    dep.mainToken = main;
    save();
    console.log("distributor", dep.contracts.distributor, "-> admin must call factory.setFeeRecipient(distributor)");
  }

  // 6. Renounce: only the immutable admin keeps control.
  if (process.env.RENOUNCE !== "0" && (await factory.owner()).toLowerCase() === deployer.address.toLowerCase()) {
    await (await factory.renounceOwnership()).wait();
    console.log("setup rights renounced; admin", await factory.admin());
  }

  Object.assign(dep, {
    chainId: Number(net.chainId), admin, feeRecipient: await factory.feeRecipient(), ethUsd8: price.toString(),
    uniswap: { poolManager: POOL_MANAGER, weth: WETH, swapRouter02: ROUTER02, ethUsdFeed: ETH_USD_FEED },
    fees: { taxBps: TAX_BPS, creatorBps: CREATOR_BPS, holderBps: HOLDER_BPS, platformBps: 10000 - CREATOR_BPS - HOLDER_BPS },
    deployedAt: dep.deployedAt ?? new Date().toISOString(),
  });
  save();
  const bal1 = await ethers.provider.getBalance(deployer.address);
  console.log("gas price gwei", ethers.formatUnits((await ethers.provider.getFeeData()).gasPrice ?? 0n, "gwei"));
  console.log("wrote", depFile, "| spent", ethers.formatEther(bal0 - bal1), "ETH | left", ethers.formatEther(bal1));

  // 7. Fork smoke test: a WETH coin with an NVDA + SPY basket, a trade, and a basket claim.
  if (process.env.SMOKE === "1") {
    if (network.name !== "hardhat") throw new Error("SMOKE runs on a local fork only");
    const [, creator, trader, other] = await ethers.getSigners();
    const NVDA = ethers.getAddress("0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee");
    const SPY = ethers.getAddress("0xfedc5f4a6c38211c1338aa411018dfaf26612c08");
    const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
    const Z = ethers.ZeroAddress;
    const route = (stock: string) => ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [
      ethers.solidityPacked(["address", "uint24", "address", "uint24", "address"], [WETH, 500, USDC, 3000, stock]),
      { currency0: Z, currency1: Z, fee: 0, tickSpacing: 0, hooks: Z },
    ]);
    const n = Number(await factory.totalTokens());
    await (await factory.connect(creator).launch({ name: "Smoke", symbol: "SMK", metadataURI: "", pair: WETH, minPairOut: 0, basket: [NVDA, SPY] }, ethers.id("smoke"), "0x", { value: ethers.parseEther("0.02") })).wait();
    const coin = await ethers.getContractAt("EstonksToken", await factory.allTokens(n));
    const router = await ethers.getContractAt("EstonksRouter", dep.contracts.router);
    await ethers.provider.send("evm_increaseTime", [30]);
    for (let i = 0; i < 3; i++) await ethers.provider.send("evm_mine", []);
    await (await router.connect(trader).buy(await coin.getAddress(), "0x", 0, { value: ethers.parseEther("0.5") })).wait();
    await (await router.connect(other).buy(await coin.getAddress(), "0x", 0, { value: ethers.parseEther("0.5") })).wait();
    const pending = await coin.pendingRewards(trader.address);
    const rc = await (await coin.connect(trader).claimRewardsAsBasket("0x", [route(NVDA), route(SPY)], [1, 1])).wait();
    const erc = (a: string) => ethers.getContractAt(["function balanceOf(address) view returns (uint256)"], a);
    console.log("smoke:", await coin.symbol(), "basket", await coin.basketAssets(), "| claimed", ethers.formatEther(pending), "WETH as",
      ethers.formatEther(await (await erc(NVDA)).balanceOf(trader.address)), "NVDAon +", ethers.formatEther(await (await erc(SPY)).balanceOf(trader.address)), "SPYon | gas", rc!.gasUsed.toString());
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
