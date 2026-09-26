import { ethers } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

// Robinhood Chain (chainId 4663) Uniswap V4 singleton + canonical V3 router/WETH.
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const V3_ROUTER = "0xCaf681a66D020601342297493863E78C959E5cb2";

// StockRhHook permission flags: afterSwap (1<<6) + afterSwapReturnDelta (1<<2).
const HOOK_FLAGS = (1n << 6n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

function mineFlags(deployer: string, initCodeHash: string) {
  for (let i = 0n; i < 8_000_000n; i++) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const addr = ethers.getCreate2Address(deployer, salt, initCodeHash);
    if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) return { addr, salt };
  }
  throw new Error("hook salt not found");
}

async function main() {
  const [signer] = await ethers.getSigners();
  const admin = process.env.ADMIN ?? signer.address; // hardcoded admin, survives renounce
  const renounce = process.env.RENOUNCE !== "0";
  console.log("deployer:", signer.address, "| admin:", admin, "| renounce:", renounce);
  console.log("balance:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");

  // 1. CREATE2 factory to place the hook at a flag-encoding address.
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  console.log("HookDeployer:", c2Addr);

  // 2. Mine + deploy StockRhHook(poolManager, owner, admin).
  const Hook = await ethers.getContractFactory("StockRhHook");
  const hookArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address"],
    [POOL_MANAGER, signer.address, admin]
  );
  const hookInit = ethers.concat([Hook.bytecode, hookArgs]);
  console.log("mining hook flags…");
  const { addr: hookAddr, salt } = mineFlags(c2Addr, ethers.keccak256(hookInit));
  console.log("mined hook addr:", hookAddr, "salt:", salt);
  await (await c2.deploy(salt, hookInit)).wait();
  const hook = await ethers.getContractAt("StockRhHook", hookAddr);
  console.log("StockRhHook:", hookAddr);

  // 3. StockRhFactory(owner, admin, poolManager, hook, weth).
  const factory = await (await ethers.getContractFactory("StockRhFactory")).deploy(
    signer.address, admin, POOL_MANAGER, hookAddr, WETH
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("StockRhFactory:", factoryAddr);

  // 4. Wire the factory into the hook.
  await (await hook.setFactory(factoryAddr)).wait();

  // 5. StockRhRouter(poolManager, factory, weth, v3Router) for one-tap buy/sell.
  const router = await (await ethers.getContractFactory("StockRhRouter")).deploy(
    POOL_MANAGER, factoryAddr, WETH, V3_ROUTER
  );
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("StockRhRouter:", routerAddr);

  // 6. Renounce ownership; the immutable admin keeps pause/collect/setFactory.
  if (renounce) {
    await (await hook.renounceOwnership()).wait();
    await (await factory.renounceOwnership()).wait();
    console.log("ownership renounced (owner=0x0); admin retains control:", admin);
  }

  const out = {
    network: "robinhood",
    chainId: 4663,
    protocol: "stock-rh-v4",
    startBlock: await ethers.provider.getBlockNumber(),
    deployer: signer.address,
    admin,
    renounced: renounce,
    note: "stockpad on Uniswap V4: coins pair a tokenized stock (or WETH); the 1% buy tax accrues automatically (no harvest) and pays holders in the pair asset. Split 50/40/10 holders/creator/platform, anti-snipe + optional dev buy. Ownership renounced; immutable admin keeps pause/collect/setFactory.",
    v4: { poolManager: POOL_MANAGER, weth: WETH, v3Router: V3_ROUTER },
    contracts: { hookDeployer: c2Addr, hook: hookAddr, factory: factoryAddr, router: routerAddr, salt },
  };
  writeFileSync(join(__dirname, "../deployments/stockpad-v4.json"), JSON.stringify(out, null, 2));
  console.log("wrote deployments/stockpad-v4.json");
  console.log("balance after:", ethers.formatEther(await ethers.provider.getBalance(signer.address)), "ETH");
}
main().catch((e) => { console.error(e); process.exit(1); });
