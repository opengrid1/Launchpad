import { ethers, network } from "hardhat";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

// Deploys the v4s STOCK-PAIRED launchpad: QuiverHookS (mined flag address),
// QuiverFactoryS + QuiverRouterS (mined ...4663 vanity), lists every stock
// against its verified-liquid USDG pool (listStock reverts on dead pools),
// then renounces with RENOUNCE=1.

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const HOOK_FLAGS = (1n << 6n) | (1n << 2n); // afterSwap | afterSwapReturnDelta
const FLAG_MASK = (1n << 14n) - 1n;

type Stock = { symbol: string; name: string; address: string; fee: number; tickSpacing: number };
type Cfg = { weth: string; usdg: string; wethUsdgPool: { fee: number; tickSpacing: number }; stocks: Stock[] };

function mine(deployer: string, initCodeHash: string, match: (addr: string) => boolean, max = 6_000_000n): string {
  for (let i = 0n; i < max; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    if (match(ethers.getCreate2Address(deployer, salt, initCodeHash))) return salt;
  }
  throw new Error("salt not found");
}

async function main() {
  const [signer] = await ethers.getSigners();
  const cfg: Cfg = JSON.parse(readFileSync(join(__dirname, "../config/v4s-stocks.json"), "utf8"));

  const protocolAdmin = process.env.PROTOCOL_ADMIN;
  if (!protocolAdmin) throw new Error("Set PROTOCOL_ADMIN");
  const treasury = process.env.TREASURY ?? protocolAdmin;
  const renounce = process.env.RENOUNCE === "1";

  console.log("deployer:", signer.address, "| protocolAdmin:", protocolAdmin, "| treasury:", treasury);
  console.log("renounce after setup:", renounce);

  // 1. CREATE2 deployer.
  const Deployer = await ethers.getContractFactory("HookDeployer");
  const c2 = await Deployer.deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();

  // 2. HookS — flag-matched address.
  const Hook = await ethers.getContractFactory("QuiverHookS");
  const hookArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address"],
    [POOL_MANAGER, signer.address, treasury, cfg.usdg],
  );
  const hookInit = ethers.concat([Hook.bytecode, hookArgs]);
  console.log("mining hook flags…");
  const hookSalt = mine(c2Addr, ethers.keccak256(hookInit), (a) => (BigInt(a) & FLAG_MASK) === HOOK_FLAGS);
  const hookAddr = ethers.getCreate2Address(c2Addr, hookSalt, ethers.keccak256(hookInit));
  await (await c2.deploy(hookSalt, hookInit)).wait();
  const hook = await ethers.getContractAt("QuiverHookS", hookAddr);
  console.log("hookS:", hookAddr);

  // 3. FactoryS — ...4663 vanity.
  const Factory = await ethers.getContractFactory("QuiverFactoryS");
  const facArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address", "address"],
    [signer.address, protocolAdmin, POOL_MANAGER, hookAddr, cfg.usdg],
  );
  const facInit = ethers.concat([Factory.bytecode, facArgs]);
  console.log("mining factory vanity …4663…");
  const facSalt = mine(c2Addr, ethers.keccak256(facInit), (a) => a.toLowerCase().endsWith("4663"));
  const facAddr = ethers.getCreate2Address(c2Addr, facSalt, ethers.keccak256(facInit));
  await (await c2.deploy(facSalt, facInit)).wait();
  const factory = await ethers.getContractAt("QuiverFactoryS", facAddr);
  console.log("factoryS:", facAddr);

  const sortedKey = (a: string, b: string, fee: number, tickSpacing: number) => {
    const [currency0, currency1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return { currency0, currency1, fee, tickSpacing, hooks: ethers.ZeroAddress };
  };

  // 4. RouterS — ...4663 vanity too.
  const wethUsdgKey = sortedKey(cfg.weth, cfg.usdg, cfg.wethUsdgPool.fee, cfg.wethUsdgPool.tickSpacing);
  const Router = await ethers.getContractFactory("QuiverRouterS");
  const rArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "address", "address", "address", "address", "address",
      "tuple(address,address,uint24,int24,address)",
    ],
    [
      POOL_MANAGER, cfg.weth, cfg.usdg, hookAddr, facAddr,
      [wethUsdgKey.currency0, wethUsdgKey.currency1, wethUsdgKey.fee, wethUsdgKey.tickSpacing, wethUsdgKey.hooks],
    ],
  );
  const rInit = ethers.concat([Router.bytecode, rArgs]);
  console.log("mining router vanity …4663…");
  const rSalt = mine(c2Addr, ethers.keccak256(rInit), (a) => a.toLowerCase().endsWith("4663"));
  const routerAddr = ethers.getCreate2Address(c2Addr, rSalt, ethers.keccak256(rInit));
  await (await c2.deploy(rSalt, rInit)).wait();
  console.log("routerS:", routerAddr);

  // 5. Wire + list stocks (factory verifies each pricing pool is alive; a
  //    stock whose pool died since the scan is skipped, not fatal).
  await (await hook.setFactory(facAddr)).wait();
  const listed: Stock[] = [];
  for (const s of cfg.stocks) {
    const key = sortedKey(cfg.usdg, s.address, s.fee, s.tickSpacing);
    try {
      await (await factory.listStock(s.address, key)).wait();
      const usd8 = await factory.stockUsd8(s.address);
      console.log(`listed ${s.symbol} @ $${(Number(usd8) / 1e8).toFixed(2)}`);
      listed.push(s);
    } catch (e: any) {
      console.log(`SKIPPED ${s.symbol}: ${e.shortMessage ?? e.message}`);
    }
  }

  // 6. Renounce.
  if (renounce) {
    await (await hook.renounceOwnership()).wait();
    await (await factory.renounceOwnership()).wait();
    console.log("ownership renounced");
  } else {
    console.log("ownership NOT renounced; set RENOUNCE=1");
  }

  const out = {
    network: network.name,
    chainId: 4663,
    startBlock: await ethers.provider.getBlockNumber(),
    deployer: signer.address,
    protocolAdmin,
    treasury,
    renounced: renounce,
    v4: { poolManager: POOL_MANAGER, weth: cfg.weth, usdg: cfg.usdg },
    contracts: { create2Deployer: c2Addr, hook: hookAddr, factory: facAddr, router: routerAddr },
    stocks: listed.map((s) => ({ symbol: s.symbol, name: s.name, address: s.address, fee: s.fee, tickSpacing: s.tickSpacing })),
  };
  const path = join(__dirname, "../deployments/quiver-v4s.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log("saved", path);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
