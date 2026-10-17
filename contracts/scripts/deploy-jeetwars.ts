import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy Jeet Wars on BNB Chain (PancakeSwap Infinity).
 *
 *   HARDHAT_CONFIG=hardhat.config.size.ts ROBINHOOD_RPC_URL=https://bsc-dataseed.bnbchain.org ROBINHOOD_CHAIN_ID=56 \
 *   PRIVATE_KEY=... ADMIN=0x... [GENESIS=<unix>] [START_TICK=191000] [TIP_BNB=0.001] [FUND_TIPS_BNB=0] \
 *   npx hardhat run scripts/deploy-jeetwars.ts --network robinhood
 *
 * GENESIS defaults to the next whole 5 minutes; round 0 starts then.
 * START_TICK 191000 starts every pool at ~5 BNB market cap.
 */
const VAULT = "0x238a358808379702088667322f80aC48bAd5e6c4";
const CLPM = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const SMART_ROUTER = "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4";
const ARMIES: [string, string][] = [
  ["NVDA", "0x02fca66c1d1afb4e2a7884261eb00f63598a7436"],
  ["QQQ", "0x205812cdbed920aff76c6580abd681a46d11efc7"],
  ["TSLA", "0x5b1910eaad6450e50f816082aa078c41f10c292f"],
  ["GOOGL", "0x3f53de71c126bdabae20f9cd64848d317f6c3238"],
  ["BABA", "0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec"],
  ["AAPL", "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a"],
  ["CRCL", "0x80f3d493ebce97e343c53d29a137942416b4ffc0"],
  ["SPY", "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8"],
];

async function main() {
  const [me] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 56 && network.name !== "hardhat") throw new Error(`expected BNB Chain (56), got ${chainId}`);
  const admin = process.env.ADMIN;
  if (!admin || !ethers.isAddress(admin)) throw new Error("set ADMIN to the admin wallet");
  const latest = (await ethers.provider.getBlock("latest"))!.timestamp;
  const genesis = Number(process.env.GENESIS ?? Math.ceil((latest + 60) / 300) * 300);
  const startTick = Number(process.env.START_TICK ?? 191_000);
  const tip = ethers.parseEther(process.env.TIP_BNB ?? "0.001");
  console.log("deployer", me.address, "BNB", ethers.formatEther(await ethers.provider.getBalance(me.address)));
  console.log("admin", admin, "| genesis", new Date(genesis * 1000).toISOString(), "| start tick", startTick);

  const codehash = ethers.keccak256(await ethers.provider.getCode(ARMIES[0][1]));
  for (const [name, a] of ARMIES) {
    if (ethers.keccak256(await ethers.provider.getCode(a)) !== codehash) throw new Error(`${name} is not a bStock proxy`);
  }

  const deploy = async (name: string, ...args: any[]) => {
    const c = await (await ethers.getContractFactory(name, me)).deploy(...args);
    await c.waitForDeployment();
    console.log(name.padEnd(22), await c.getAddress());
    return c as any;
  };
  const hook = await deploy("JeetWarsHook", VAULT, CLPM);
  const redeemer = await deploy("JeetWarsRedeemer");
  const tokenDeployer = await deploy("JeetWarsTokenDeployer");
  const arena = await deploy("JeetWarsArena", {
    owner: me.address, admin, vault: VAULT, poolManager: CLPM, hook: await hook.getAddress(),
    tokenDeployer: await tokenDeployer.getAddress(), redeemer: await redeemer.getAddress(),
    genesis, startTick, bstockCodehash: codehash, tip,
  });
  const arenaAddr = await arena.getAddress();
  for (const c of [hook, redeemer, tokenDeployer]) await (await c.setArena(arenaAddr)).wait();
  const router = await deploy("JeetWarsRouter", VAULT, CLPM, arenaAddr, ethers.getAddress(WBNB), SMART_ROUTER);
  await (await arena.setConverter(await router.getAddress())).wait();
  for (let i = 0; i < ARMIES.length; i++) {
    await (await arena.setArmy(i, ARMIES[i][1], true, ARMIES[i][0])).wait();
    console.log("army", i, ARMIES[i][0]);
  }
  const fund = ethers.parseEther(process.env.FUND_TIPS_BNB ?? "0");
  if (fund > 0n) await (await arena.fundTips({ value: fund })).wait();

  const out = {
    chainId,
    deployedAt: new Date().toISOString(),
    deployBlock: await ethers.provider.getBlockNumber(),
    admin,
    owner: me.address,
    genesis,
    startTick,
    tipWei: tip.toString(),
    infinity: { vault: VAULT, clPoolManager: CLPM, wbnb: ethers.getAddress(WBNB), v3SmartRouter: SMART_ROUTER },
    contracts: {
      arena: arenaAddr,
      hook: await hook.getAddress(),
      router: await router.getAddress(),
      redeemer: await redeemer.getAddress(),
      tokenDeployer: await tokenDeployer.getAddress(),
    },
    armies: ARMIES.map(([name, stock], id) => ({ id, name, stock: ethers.getAddress(stock) })),
  };
  const file = path.join(__dirname, "..", "deployments", network.name === "hardhat" ? "bsc-jeetwars.fork.json" : "bsc-jeetwars.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("wrote", file);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message ?? e);
  process.exit(1);
});
