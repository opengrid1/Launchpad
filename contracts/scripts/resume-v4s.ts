import { ethers, network } from "hardhat";
import { writeFileSync, readFileSync } from "fs";
import { join } from "path";

// Resumes the interrupted v4s mainnet deploy: contracts are live, only some
// stocks were listed and ownership was not yet renounced. Lists the missing
// stocks, renounces with RENOUNCE=1, and writes the deployment file.

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const HOOK = "0xf91f6e6C05CA0aBb519763770E2B417Bb788C044";
const FACTORY = "0x9b205b212b08D02Dd255a4C98404C61548414663";
const ROUTER = "0xb8aEcB596E56586c00dc73D6B00B6a16f72D4663";
const CREATE2 = "0x56D9d0E52172d4723926A4F0b9adC4E75B5b959b";
const START_BLOCK = 14043218;

type Stock = { symbol: string; name: string; address: string; fee: number; tickSpacing: number };
type Cfg = { weth: string; usdg: string; wethUsdgPool: { fee: number; tickSpacing: number }; stocks: Stock[] };

async function main() {
  const [signer] = await ethers.getSigners();
  const cfg: Cfg = JSON.parse(readFileSync(join(__dirname, "../config/v4s-stocks.json"), "utf8"));
  const protocolAdmin = process.env.PROTOCOL_ADMIN;
  if (!protocolAdmin) throw new Error("Set PROTOCOL_ADMIN");
  const treasury = process.env.TREASURY ?? protocolAdmin;
  const renounce = process.env.RENOUNCE === "1";

  const factory = await ethers.getContractAt("QuiverFactoryS", FACTORY, signer);
  const hook = await ethers.getContractAt("QuiverHookS", HOOK, signer);

  if ((await hook.factory()).toLowerCase() !== FACTORY.toLowerCase()) {
    await (await hook.setFactory(FACTORY)).wait();
    console.log("hook factory wired");
  }

  const sortedKey = (a: string, b: string, fee: number, tickSpacing: number) => {
    const [currency0, currency1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
    return { currency0, currency1, fee, tickSpacing, hooks: ethers.ZeroAddress };
  };

  const listed: Stock[] = [];
  for (const s of cfg.stocks) {
    try {
      if (await factory.stockListed(s.address)) {
        console.log(`already listed ${s.symbol}`);
        listed.push(s);
        continue;
      }
      const key = sortedKey(cfg.usdg, s.address, s.fee, s.tickSpacing);
      await (await factory.listStock(s.address, key)).wait();
      const usd8 = await factory.stockUsd8(s.address);
      console.log(`listed ${s.symbol} @ $${(Number(usd8) / 1e8).toFixed(2)}`);
      listed.push(s);
    } catch (e: any) {
      console.log(`SKIPPED ${s.symbol}: ${(e.shortMessage ?? e.message).slice(0, 80)}`);
    }
  }

  if (renounce) {
    if ((await hook.owner()) !== ethers.ZeroAddress) {
      await (await hook.renounceOwnership()).wait();
      console.log("hook ownership renounced");
    }
    if ((await factory.owner()) !== ethers.ZeroAddress) {
      await (await factory.renounceOwnership()).wait();
      console.log("factory ownership renounced");
    }
  }

  const out = {
    network: network.name,
    chainId: 4663,
    startBlock: START_BLOCK,
    deployer: signer.address,
    protocolAdmin,
    treasury,
    renounced: renounce,
    v4: { poolManager: POOL_MANAGER, weth: cfg.weth, usdg: cfg.usdg },
    contracts: { create2Deployer: CREATE2, hook: HOOK, factory: FACTORY, router: ROUTER },
    stocks: listed.map((s) => ({ symbol: s.symbol, name: s.name, address: s.address, fee: s.fee, tickSpacing: s.tickSpacing })),
  };
  const path = join(__dirname, "../deployments/quiver-v4s.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log("saved", path, "with", listed.length, "stocks");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
