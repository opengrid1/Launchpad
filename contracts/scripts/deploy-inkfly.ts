import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Deploy the Ink-chain memecoin launchpad (same shape as the Base launchpad,
// minus holder rewards):
//   - every coin is a plain, immutable InkToken (fixed 1B supply, no admin)
//   - coins pair against WETH and seed full supply single-sided into a V4 pool
//   - flat 1% trade tax, routed entirely to the creator's fee recipient
//   - atomic dev buy, protocolAdmin collect/unwind retained
//   - NO vault, NO keeper, NO platform cut
//
// Run (needs a funded deployer key in .env.deployer):
//   HARDHAT_CONFIG=hardhat.config.min.ts \
//   ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com ROBINHOOD_CHAIN_ID=57073 \
//   ADMIN=0x... START_MCAP_ETH=1 \
//   npx hardhat run scripts/deploy-inkfly.ts --network robinhood
//
// Ink mainnet (Kraken OP-Stack L2, chainId 57073)
const POOL_MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
const WETH = "0x4200000000000000000000000000000000000006";
// beforeInitialize (1<<13) + afterSwap (1<<6) + afterSwapReturnDelta (1<<2)
const HOOK_FLAGS = (1n << 13n) | (1n << 6n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

async function main() {
  const [signer] = await ethers.getSigners();
  const admin = process.env.ADMIN ?? signer.address; // platform admin (pause + collect)
  const startMcapWei = ethers.parseEther(process.env.START_MCAP_ETH ?? "1");
  console.log("deployer:", signer.address, "admin:", admin, "startMcapWei:", startMcapWei.toString());

  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  console.log("hookDeployer:", c2Addr);

  // hook -> factory circular edge. Pin exact nonces to remove any RPC-lag
  // ambiguity: c2.deploy(salt) uses `base`, the factory uses `base + 1`.
  const base = await ethers.provider.getTransactionCount(signer.address, "pending");
  const predictedFactory = ethers.getCreateAddress({ from: signer.address, nonce: base + 1 });

  const Hook = await ethers.getContractFactory("StockFeeHookV3");
  const hookArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "address", "address"],
    [POOL_MANAGER, admin, predictedFactory, admin], // poolManager, treasury, launcher, platformAdmin
  );
  const hookInit = ethers.concat([Hook.bytecode, hookArgs]);
  const hookHash = ethers.keccak256(hookInit);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 3_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hookHash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  if (!hookAddr) throw new Error("no hook salt");
  await (await c2.deploy(salt, hookInit, { nonce: base })).wait();
  console.log("hook:", hookAddr);

  const factory = await (await ethers.getContractFactory("InkFlyFactory")).deploy(
    signer.address, admin, POOL_MANAGER, hookAddr, WETH, startMcapWei, { nonce: base + 1 },
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  if (factoryAddr.toLowerCase() !== predictedFactory.toLowerCase())
    throw new Error(`factory mismatch: got ${factoryAddr}, hook expects ${predictedFactory}`);
  console.log("factory:", factoryAddr);

  const router = await (await ethers.getContractFactory("StockTradeRouter")).deploy(POOL_MANAGER, factoryAddr, WETH);
  await router.waitForDeployment();
  const routerAddr = await router.getAddress();
  console.log("router:", routerAddr);

  // The factory owner has no privileged runtime powers (protocolAdmin holds
  // pause/collect); renounce so the launchpad is fully hands-off.
  await (await factory.renounceOwnership()).wait();
  console.log("factory ownership renounced (protocolAdmin retains pause/collect)");

  const startBlock = await ethers.provider.getBlockNumber();
  const out = {
    chainId: 57073,
    model: "ink: fixed 1% tax, 100% creator, WETH-paired, no rewards/keeper/platform cut",
    admin,
    startBlock,
    startMcapWei: startMcapWei.toString(),
    contracts: {
      hookDeployer: c2Addr, hook: hookAddr, factory: factoryAddr, router: routerAddr,
      poolManager: POOL_MANAGER, weth: WETH,
    },
  };
  mkdirSync(join(__dirname, "../deployments"), { recursive: true });
  writeFileSync(join(__dirname, "../deployments/ink-inkfly.json"), JSON.stringify(out, null, 2));
  console.log("saved deployments/ink-inkfly.json  startBlock:", startBlock);
}
main().catch((e) => { console.error(e); process.exit(1); });
