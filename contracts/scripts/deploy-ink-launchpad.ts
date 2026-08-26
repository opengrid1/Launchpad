import { ethers, network } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * squidpad — Ink chain (Kraken L2, chainId 57073), canonical Uniswap V3.
 * Deploys SquidTokenDeployer + StableLaunchpadFactory: one tx per launch
 * opens a real Uniswap pool (0.05% tier) seeded with the full supply. Rewards
 * are automatic in the token itself: every buy skims 1% in coins on the
 * transfer (0.5% holders / 0.4% creator / 0.1% platform), no harvest step.
 *
 * Quote assets registered at deploy: WETH plus every wrapped Backed xStock
 * verified live on Ink's canonical Uniswap V3 (free transfer + funded pool).
 * USD prices are read on-chain at deploy time from each stock's USDG 0.05%
 * pool (WETH from the USDC.e 0.05% pool); override with ETH_USD8 or skip
 * stocks entirely with SKIP_STOCKS=1.
 *
 * Env:  FACTORY_OWNER (required), FEE_RECIPIENT (default owner),
 *       ETH_USD8 (optional override), TOKEN_DEPLOYER (reuse), SKIP_STOCKS.
 * Run:  set -a && source .env.ink-deployer && set +a && \
 *       ROBINHOOD_RPC_URL=https://rpc-gel.inkonchain.com ROBINHOOD_CHAIN_ID=57073 \
 *       HARDHAT_CONFIG=hardhat.config.size.ts FACTORY_OWNER=0x... \
 *       npx hardhat run scripts/deploy-ink-launchpad.ts --network robinhood
 */
const V3_FACTORY = "0x640887a9ba3a9c53ed27d0f7e8246a4f933f3424";
const POSITION_MANAGER = "0xC0836E5B058BBE22ae2266e1AC488A1A0fD8DCE8";
const SWAP_ROUTER = "0x177778F19E89Dd1012bdBE603F144088A95C4b53";
const WETH = "0x4200000000000000000000000000000000000006";
const USDG = "0xe343167631d89B6Ffc58B88d6b7fB0228795491D"; // 6 dec
const USDCE = "0xF1815bd50389c46847f0Bda824eC8da914045D14"; // 6 dec

// Wrapped Backed xStocks on Ink, verified 2026-08-26: contract live, transfers
// free, and a funded USDG 0.05% pool on the canonical Uniswap V3 factory.
const INK_STOCKS: { ticker: string; address: string }[] = [
  { ticker: "wNVDAx", address: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5" },
  { ticker: "wSPYx", address: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540" },
  { ticker: "wAAPLx", address: "0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f" },
  { ticker: "wTSLAx", address: "0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171" },
  { ticker: "wMSTRx", address: "0x30987adF0B11dc698438a99BA04ec3a1AB2c7EaB" },
  { ticker: "wNFLXx", address: "0x7d87fD6A379714194a797c0bBB8B40c30D250856" },
  { ticker: "wPLTRx", address: "0x4A2df09536F62341C9f946427D16414C04e21342" },
];

const FAB_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)",
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
];

/** USD price (8 decimals) of an 18-dec token from its pool vs a 6-dec USD stable. */
async function poolUsd8(token: string, usdStable: string, tier: number): Promise<bigint> {
  const fab = new ethers.Contract(V3_FACTORY, FAB_ABI, ethers.provider);
  const poolAddr: string = await fab.getPool(token, usdStable, tier);
  if (poolAddr === ethers.ZeroAddress) throw new Error(`no pool for ${token} vs ${usdStable} @${tier}`);
  const pool = new ethers.Contract(poolAddr, POOL_ABI, ethers.provider);
  const [s0, t0, liq] = await Promise.all([pool.slot0(), pool.token0(), pool.liquidity()]);
  if (liq === 0n) throw new Error(`pool ${poolAddr} has zero liquidity`);
  const sp = Number(s0.sqrtPriceX96) / 2 ** 96;
  const raw = sp * sp; // token1 per token0 in raw units
  const tokenIs0 = String(t0).toLowerCase() === token.toLowerCase();
  const px = (tokenIs0 ? raw : 1 / raw) * 1e12; // stable(6d) per token(18d)
  if (!(px > 0) || !isFinite(px)) throw new Error(`bad price from ${poolAddr}`);
  return BigInt(Math.round(px * 1e8));
}

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = process.env.FACTORY_OWNER ?? signer.address;
  const feeRecipient = process.env.FEE_RECIPIENT ?? owner;
  const holderFeeBps = Number(process.env.HOLDER_FEE_BPS ?? 5000);
  const creatorFeeBps = Number(process.env.CREATOR_FEE_BPS ?? 4000);

  const ethUsd8 = process.env.ETH_USD8 ? BigInt(process.env.ETH_USD8) : await poolUsd8(WETH, USDCE, 500);
  console.log("network:", network.name, "| deployer:", signer.address);
  console.log("owner:", owner, "| feeRecipient:", feeRecipient, "| ETH usd8:", ethUsd8.toString());

  let tokenDeployer;
  if (process.env.TOKEN_DEPLOYER) {
    tokenDeployer = await ethers.getContractAt("SquidTokenDeployer", process.env.TOKEN_DEPLOYER);
    console.log("Reusing SquidTokenDeployer:", process.env.TOKEN_DEPLOYER);
  } else {
    tokenDeployer = await (await ethers.getContractFactory("SquidTokenDeployer")).deploy();
    await tokenDeployer.waitForDeployment();
    console.log("SquidTokenDeployer:", await tokenDeployer.getAddress());
  }

  const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
    owner, feeRecipient, await tokenDeployer.getAddress(), V3_FACTORY, POSITION_MANAGER, SWAP_ROUTER, WETH, holderFeeBps, creatorFeeBps, 500,
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log("StableLaunchpadFactory:", factoryAddr);

  await (await tokenDeployer.setFactory(factoryAddr)).wait();
  console.log("tokenDeployer.factory set");

  const quotes: { ticker: string; address: string; usd8: string }[] = [
    { ticker: "WETH", address: WETH, usd8: ethUsd8.toString() },
  ];
  if (!process.env.SKIP_STOCKS) {
    for (const s of INK_STOCKS) {
      try {
        const usd8 = await poolUsd8(s.address, USDG, 500);
        quotes.push({ ticker: s.ticker, address: s.address, usd8: usd8.toString() });
        console.log(`${s.ticker}: $${(Number(usd8) / 1e8).toFixed(2)}`);
      } catch (e) {
        console.log(`${s.ticker}: SKIPPED (${(e as Error).message})`);
      }
    }
  }

  const isOwner = signer.address.toLowerCase() === owner.toLowerCase();
  for (const q of quotes) {
    if (isOwner) {
      await (await factory.setQuoteAsset(q.address, true, BigInt(q.usd8))).wait();
      console.log(`quote approved: ${q.ticker} @ usd8 ${q.usd8}`);
    } else {
      console.log(`owner action needed: factory.setQuoteAsset(${q.address}, true, ${q.usd8}) // ${q.ticker}`);
    }
  }

  const out = {
    network: "ink", chainId: 57073,
    startBlock: await ethers.provider.getBlockNumber(),
    deployer: signer.address, owner, feeRecipient,
    uniswapV3: { factory: V3_FACTORY, positionManager: POSITION_MANAGER, swapRouter: SWAP_ROUTER, weth: WETH },
    contracts: { tokenDeployer: await tokenDeployer.getAddress(), factory: factoryAddr },
    quotes,
    config: { totalSupply: "1000000000e18", poolFeeTier: 500, holderFeeBps, creatorFeeBps, platformFeeBps: 10000 - holderFeeBps - creatorFeeBps, defaultMarketCapUsd: 3000 },
  };
  writeFileSync(join(__dirname, "../deployments/ink-launchpad.json"), JSON.stringify(out, null, 2));
  console.log("saved deployments/ink-launchpad.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
