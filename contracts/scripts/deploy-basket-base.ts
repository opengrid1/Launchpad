import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// Deploy the Basket launchpad to Base mainnet: "coins that pay holders".
//
//   - BasketFeeHook      2% trade fee before graduation, 1.25% after, always in the pair token
//   - BasketFactory      launches, locked liquidity, required opening buy, 2% creator cap
//   - BasketRewardVault  one per coin (deployed at launch), pays holders by Merkle proof
//   - BasketRevenueSplitter  protocol revenue: 25% NFT pot / 7.5% airdrops / 67.5% treasury
//   - BasketNFT + BasketPot  1,000 Baskets, hourly distributions to each NFT's vault
//   - BasketAirdrop      trader airdrop pot
//   - StockTradeRouter   the existing ETH/pair trade router, pointed at the Basket factory
//
// ADMIN is the BuzzPad admin wallet by default. Every contract is deployed with
// the deployer as temporary owner for wiring, then ownership is handed to ADMIN.
// The handover is two-step: ADMIN must call acceptOwnership() on each contract
// (the script prints the list). Until then the deployer is still the owner.
//
// Run (needs a funded deployer key in .env.deployer):
//   HARDHAT_CONFIG=hardhat.config.min.ts \
//   ROBINHOOD_RPC_URL=https://mainnet.base.org ROBINHOOD_CHAIN_ID=8453 \
//   npx hardhat run scripts/deploy-basket-base.ts --network robinhood
//
// Optional env (ETH amounts as decimal strings):
//   ADMIN, KEEPER, TREASURY           default: ADMIN = BuzzPad admin, others = ADMIN
//   START_MCAP_ETH (5.5)              market cap a WETH-paired coin opens at
//   GRAD_MCAP_ETH (41)                market cap at which it graduates
//   MIN_OPENING_BUY_ETH (0.005)       smallest creator opening buy
//   LAUNCH_FEE_ETH (0.0005)           launch fee, max 0.05
//   MINT_PRICE_ETH (0.03)             Basket NFT mint price
// The ETH-denominated caps are fixed numbers, not oracle-fed. The defaults
// target roughly $9,300 / $70,000 at about $1,700 per ETH (the WETH/USDC
// Slipstream price on 2026-11-26); set them for the current price at deploy
// and retune later with factory.setPairConfig.

// The BuzzPad admin: owner() of the BuzzPad factory, hook and locker on
// Ethereum, and the admin/keeper of this repo's Base deployments.
const BUZZPAD_ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";

// Base mainnet
const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b";
const WETH = "0x4200000000000000000000000000000000000006";
const B20_FACTORY = "0xB20f000000000000000000000000000000000000";
const SLIPSTREAM_ROUTER = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";

// Tokenized stocks on Base that coins may pay their holders in
// (web/src/lib/base/stocks.ts). The admin can change this list later.
const REWARD_TOKENS: Record<string, string> = {
  META: "0xb2000000000000000000008bC8786B856E61707C",
  GOOGL: "0xb2000000000000000000002D0BA3164cc74f58B7",
  AAPL: "0xb200000000000000000000C2e324d24d7eEcd1fb",
  NVDA: "0xb20000000000000000000078ee7ce2fE4908108C",
  QQQ: "0x823FF7Bbde2869aAe73A6CD53e7f614442836757",
  AMZN: "0x997baE3EC193a249596d3708C3fAB7C501Bb8a53",
  COIN: "0x5cDa0E1CA4ce2af96315f7F8963C85399c172204",
  MSTR: "0xFF05E1bD696900dc6A52CA35Ca61Bb1024eDa8e2",
  SPY: "0x31C2C14134e6E3B7ef9478297F199331133Fc2d8",
};
// The NFT pot's daily rotation: SPY -> NVDA -> QQQ -> WETH.
const POT_ROTATION = [REWARD_TOKENS.SPY, REWARD_TOKENS.NVDA, REWARD_TOKENS.QQQ, WETH];

// beforeInitialize | beforeSwap | afterSwap | beforeSwapReturnsDelta | afterSwapReturnsDelta
const HOOK_FLAGS = (1n << 13n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;

const eth = (name: string, fallback: string) => ethers.parseEther(process.env[name] ?? fallback);

async function main() {
  const [signer] = await ethers.getSigners();
  const admin = ethers.getAddress(process.env.ADMIN ?? BUZZPAD_ADMIN);
  const keeper = ethers.getAddress(process.env.KEEPER ?? admin);
  const treasury = ethers.getAddress(process.env.TREASURY ?? admin);
  const startMcap = eth("START_MCAP_ETH", "5.5");
  const gradMcap = eth("GRAD_MCAP_ETH", "41");
  const minOpeningBuy = eth("MIN_OPENING_BUY_ETH", "0.005");
  const launchFee = eth("LAUNCH_FEE_ETH", "0.0005");
  const mintPrice = eth("MINT_PRICE_ETH", "0.03");
  const me = signer.address;
  console.log("deployer:", me, "\nadmin:", admin, "\nkeeper:", keeper, "\ntreasury:", treasury);

  const deploy = async (name: string, ...args: unknown[]) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(`${name}:`, await c.getAddress());
    return c;
  };
  const send = async (label: string, tx: Promise<{ wait(): Promise<unknown> }>) => {
    await (await tx).wait();
    console.log("  ", label);
  };

  // NFT, pot, airdrop, then the splitter that feeds them.
  const nft: any = await deploy("BasketNFT", me, WETH, treasury, mintPrice, treasury);
  const pot: any = await deploy("BasketPot", me, await nft.getAddress(), WETH, SLIPSTREAM_ROUTER, keeper);
  await send("nft.setPot", nft.setPot(await pot.getAddress()));
  const airdrop: any = await deploy("BasketAirdrop", me, WETH, keeper);
  const splitter: any = await deploy("BasketRevenueSplitter", me, [
    { to: await pot.getAddress(), shareBps: 2500 },
    { to: await airdrop.getAddress(), shareBps: 750 },
    { to: treasury, shareBps: 6750 },
  ]);

  // Hook: mined to an address whose low bits carry its v4 permission flags.
  const c2: any = await deploy("HookDeployer");
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("BasketFeeHook");
  const hookInit = ethers.concat([
    Hook.bytecode,
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address"],
      [POOL_MANAGER, me, await splitter.getAddress()],
    ),
  ]);
  const hookHash = ethers.keccak256(hookInit);
  let hookAddr = "", salt = "";
  for (let i = 0n; i < 20_000_000n; i++) {
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hookHash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { hookAddr = a; salt = s; break; }
  }
  if (!hookAddr) throw new Error("no hook salt found");
  await send("hook deployed", c2.deploy(salt, hookInit));
  console.log("BasketFeeHook:", hookAddr);
  const hook: any = await ethers.getContractAt("BasketFeeHook", hookAddr);

  const vd: any = await deploy("BasketVaultDeployer");
  const factory: any = await deploy(
    "BasketFactory", me, POOL_MANAGER, hookAddr, await vd.getAddress(), B20_FACTORY, WETH, keeper, SLIPSTREAM_ROUTER,
  );
  const factoryAddr = await factory.getAddress();
  await send("hook.setFactory", hook.setFactory(factoryAddr));
  await send("factory.setPairConfig(WETH)", factory.setPairConfig(WETH, { enabled: true, startMcap, gradMcap, minOpeningBuy }));
  await send("factory.setLaunchFee", factory.setLaunchFee(launchFee));
  for (const [symbol, token] of Object.entries(REWARD_TOKENS)) {
    await send(`factory.setRewardTokenApproved(${symbol})`, factory.setRewardTokenApproved(token, true));
  }
  for (const token of POT_ROTATION) {
    if (token !== WETH) await send(`pot.addRewardToken(${token})`, pot.addRewardToken(token));
  }
  await send("pot.setRotation", pot.setRotation(POT_ROTATION));

  const router: any = await deploy("StockTradeRouter", POOL_MANAGER, factoryAddr, WETH);

  // Hand every contract to the admin. Two-step: the admin must accept.
  const owned: Record<string, any> = { factory, hook, nft, pot, airdrop, splitter };
  if (admin.toLowerCase() !== me.toLowerCase()) {
    for (const [name, c] of Object.entries(owned)) {
      await send(`${name}.transferOwnership(admin)`, c.transferOwnership(admin));
    }
    console.log(`\nOwnership is PENDING. ${admin} must call acceptOwnership() on:`);
    for (const [name, c] of Object.entries(owned)) console.log(`  ${name}: ${await c.getAddress()}`);
    console.log("Until then the deployer is still the owner of each.");
  }

  const startBlock = await ethers.provider.getBlockNumber();
  const out = {
    chainId: 8453,
    model: "basket: 2% fee before graduation, 1.25% after, always in the pair token; holders or creator mode",
    admin,
    ownershipAccepted: admin.toLowerCase() === me.toLowerCase(),
    startBlock,
    params: {
      startMcapWei: startMcap.toString(), gradMcapWei: gradMcap.toString(),
      minOpeningBuyWei: minOpeningBuy.toString(), launchFeeWei: launchFee.toString(), mintPriceWei: mintPrice.toString(),
    },
    contracts: {
      factory: factoryAddr, hook: hookAddr, hookDeployer: c2Addr, vaultDeployer: await vd.getAddress(),
      router: await router.getAddress(), splitter: await splitter.getAddress(),
      nft: await nft.getAddress(), pot: await pot.getAddress(), airdrop: await airdrop.getAddress(),
      poolManager: POOL_MANAGER, weth: WETH, b20Factory: B20_FACTORY, swapRouter: SLIPSTREAM_ROUTER,
      keeper, treasury,
    },
    rewardTokens: REWARD_TOKENS,
    potRotation: POT_ROTATION,
  };
  mkdirSync(join(__dirname, "../deployments"), { recursive: true });
  writeFileSync(join(__dirname, "../deployments/base-basket.json"), JSON.stringify(out, null, 2));
  console.log("\nsaved deployments/base-basket.json  startBlock:", startBlock);
}

main().catch((e) => { console.error(e); process.exit(1); });
