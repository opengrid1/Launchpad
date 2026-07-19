// Quiver harvest keeper.
//
// Walks every launched token on BOTH factories and calls the hook's
// permissionless `harvest` on the ones whose accrued trade tax has crossed a
// threshold — realising the 50/25/25 split. After each pass it auto-DELIVERS
// holder rewards via claimForMany, pushing every holder's accrued stock
// straight to their wallet, so holders never need to claim.
//
//   v4  (quiver-v4.json):  WETH-paired pools; fees accrue as wethFees/tokenFees
//   v4s (quiver-v4s.json): stock-paired pools; fees accrue as stockFees/tokenFees,
//                          rewards are a basket of up to 5 stocks
//
// Runs on a schedule from GitHub Actions; needs a funded keeper wallet.
//
// Env:
//   KEEPER_PRIVATE_KEY   (required) funded wallet that pays gas
//   ROBINHOOD_RPC_URL    (default: public RPC)
//   MIN_HARVEST_WETH     (default 0.0002e18) min WETH-side fees to harvest (v4)
//   MIN_HARVEST_STOCK    (default 0.0005e18) min stock-side fees to harvest (v4s)
//   MIN_HARVEST_TOKEN    (default 1000e18)   min token-side fees to harvest
//   MIN_CLAIM_REWARD     (default 1e12)      min pending reward to deliver
import { ethers } from "ethers";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const RPC = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const KEY = process.env.KEEPER_PRIVATE_KEY;
if (!KEY) {
  console.error("Set KEEPER_PRIVATE_KEY (a funded wallet that pays gas).");
  process.exit(1);
}
const MIN_WETH = BigInt(process.env.MIN_HARVEST_WETH ?? "200000000000000"); // 0.0002 WETH
const MIN_STOCK = BigInt(process.env.MIN_HARVEST_STOCK ?? "500000000000000"); // 0.0005 stock
const MIN_TOKEN = BigInt(process.env.MIN_HARVEST_TOKEN ?? "1000000000000000000000"); // 1000 tokens
const MIN_CLAIM = BigInt(process.env.MIN_CLAIM_REWARD ?? "1000000000000"); // dust floor

const FACTORY_ABI = [
  "function totalTokens() view returns (uint256)",
  "function allTokens(uint256) view returns (address)",
];
const TOKEN_ABI = [
  "function pendingRewards(address) view returns (uint256)",
  "function claimForMany(address[])",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

const provider = new ethers.JsonRpcProvider(RPC);
const keeper = new ethers.Wallet(KEY, provider);

const bal = await provider.getBalance(keeper.address);
console.log(`keeper ${keeper.address} · gas ${ethers.formatEther(bal)} ETH`);
if (bal === 0n) {
  console.error("Keeper wallet has no gas — fund it and retry.");
  process.exit(1);
}

// Push every holder's accrued reward stock to their wallet. Holder set comes
// from Transfer logs; only holders above the dust floor are delivered.
async function deliverRewards(tokenAddr, startBlock) {
  const token = new ethers.Contract(tokenAddr, TOKEN_ABI, keeper);
  try {
    await token.claimForMany.staticCall([]); // v1 tokens revert here
  } catch {
    return;
  }
  const latest = BigInt(await provider.getBlockNumber());
  const holders = new Set();
  const step = 1_000_000n;
  for (let from = startBlock; from <= latest; from += step) {
    const to = from + step - 1n > latest ? latest : from + step - 1n;
    const logs = await token.queryFilter(token.filters.Transfer(), from, to);
    for (const l of logs) holders.add(l.args.to.toLowerCase());
  }
  holders.delete(ethers.ZeroAddress.toLowerCase());
  const list = [...holders];
  const due = [];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const pends = await Promise.all(chunk.map((h) => token.pendingRewards(h).catch(() => 0n)));
    for (let j = 0; j < chunk.length; j++) if (pends[j] >= MIN_CLAIM) due.push(chunk[j]);
  }
  if (!due.length) return;
  for (let i = 0; i < due.length; i += 50) {
    const batch = due.slice(i, i + 50);
    try {
      // Explicit gas: claimForMany swallows inner reverts, so a short gas
      // estimate would silently deliver nothing. Budget per holder; basket
      // tokens move up to 5 ERC20s per holder.
      const tx = await token.claimForMany(batch, { gasLimit: 300_000n + 400_000n * BigInt(batch.length) });
      await tx.wait();
      console.log(`📬 ${tokenAddr} delivered rewards to ${batch.length} holder(s) ${tx.hash}`);
    } catch (e) {
      console.log(`⚠️ ${tokenAddr} delivery failed: ${e.shortMessage ?? e.message}`);
    }
  }
}

// One pass over a deployment: harvest crossed-threshold tokens, then deliver.
async function runDeployment(label, depPath, quoteFeesFn, minQuote) {
  if (!existsSync(depPath)) return { harvested: 0, skipped: 0 };
  const dep = JSON.parse(readFileSync(depPath, "utf8"));
  const factory = new ethers.Contract(dep.contracts.factory, FACTORY_ABI, keeper);
  const hook = new ethers.Contract(dep.contracts.hook, [
    `function ${quoteFeesFn}(address) view returns (uint256)`,
    "function tokenFees(address) view returns (uint256)",
    "function harvest(address)",
  ], keeper);
  const startBlock = BigInt(dep.startBlock ?? 0);
  const total = Number(await factory.totalTokens());
  console.log(`[${label}] scanning ${total} tokens (factory ${dep.contracts.factory})`);

  let harvested = 0;
  let skipped = 0;
  for (let i = 0; i < total; i++) {
    const token = await factory.allTokens(i);
    const [qf, tf] = await Promise.all([hook[quoteFeesFn](token), hook.tokenFees(token)]);
    if (qf >= minQuote || tf >= MIN_TOKEN) {
      try {
        const tx = await hook.harvest(token);
        await tx.wait();
        console.log(`✅ [${label}] ${token} harvested (quote=${ethers.formatEther(qf)} token=${ethers.formatEther(tf)}) ${tx.hash}`);
        harvested++;
      } catch (e) {
        console.log(`⚠️ [${label}] ${token} harvest failed: ${e.shortMessage ?? e.message}`);
      }
    } else {
      skipped++;
    }
    // Deliver even when nothing was harvested this pass — pending from earlier
    // harvests still gets swept to wallets.
    try {
      await deliverRewards(token, startBlock);
    } catch (e) {
      console.log(`⚠️ [${label}] ${token} delivery scan failed: ${e.shortMessage ?? e.message}`);
    }
  }
  return { harvested, skipped };
}

// One bad deployment must not block the other's harvests.
async function safeRun(label, file, fn, min) {
  try {
    return await runDeployment(label, join(here, `../contracts/deployments/${file}`), fn, min);
  } catch (e) {
    console.log(`⚠️ [${label}] pass failed: ${e.shortMessage ?? e.message}`);
    return { harvested: 0, skipped: 0 };
  }
}

const a = await safeRun("v4", "quiver-v4.json", "wethFees", MIN_WETH);
const b = await safeRun("v4s", "quiver-v4s.json", "stockFees", MIN_STOCK);
console.log(`done — harvested ${a.harvested + b.harvested}, skipped ${a.skipped + b.skipped} below threshold`);
