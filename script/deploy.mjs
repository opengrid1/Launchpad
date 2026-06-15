/* ──────────────────────────────────────────────────────────────
   OFA one-shot deploy (Node + ethers, no Foundry needed)
   Deploys $OFA + bonding curve, puts ALL supply on the curve, and
   hands ownership of both contracts to your SECURE owner address.
   The deployer key only pays gas and ends with nothing.

   Run:
     npm install ethers solc
     export PRIVATE_KEY=0x...     # deployer (pays gas) — can be the burner
     export RPC_URL=https://...   # your mainnet RPC (Alchemy/Infura/publicnode)
     export OWNER=0x...           # YOUR secure wallet (owns contracts after)
     # optional: TOTAL_SUPPLY=100000000  VIRTUAL_ETH=1  REWARD_FEE_BPS=200
     node script/deploy.mjs
   ────────────────────────────────────────────────────────────── */
import { ethers } from "ethers";
import solc from "solc";
import fs from "fs";

const { PRIVATE_KEY, RPC_URL, OWNER } = process.env;
if (!PRIVATE_KEY || !RPC_URL || !OWNER) {
  console.error("Set PRIVATE_KEY, RPC_URL and OWNER env vars.");
  process.exit(1);
}
if (!ethers.isAddress(OWNER)) {
  console.error("OWNER is not a valid address:", OWNER);
  process.exit(1);
}

const SUPPLY = ethers.parseUnits(process.env.TOTAL_SUPPLY || "100000000", 18);
const VIRTUAL_ETH = ethers.parseEther(process.env.VIRTUAL_ETH || "1");
const REWARD_FEE_BPS = BigInt(process.env.REWARD_FEE_BPS || "200");
const FOR_SALE = SUPPLY; // ALL tokens on the curve

function compile() {
  const sources = {
    "OFAToken.sol": { content: fs.readFileSync(new URL("../src/OFAToken.sol", import.meta.url), "utf8") },
    "OFABondingCurve.sol": { content: fs.readFileSync(new URL("../src/OFABondingCurve.sol", import.meta.url), "utf8") },
  };
  const input = {
    language: "Solidity",
    sources,
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === "error");
  if (errs.length) { errs.forEach((e) => console.error(e.formattedMessage)); process.exit(1); }
  return out.contracts;
}

const c = compile();
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
console.log("deployer (gas):", wallet.address);
console.log("owner (secure):", OWNER);
console.log("balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH\n");

const T = c["OFAToken.sol"].OFAToken;
const B = c["OFABondingCurve.sol"].OFABondingCurve;
const TokenF = new ethers.ContractFactory(T.abi, T.evm.bytecode.object, wallet);
const CurveF = new ethers.ContractFactory(B.abi, B.evm.bytecode.object, wallet);

// 1. token — full supply to deployer (temporary), deployer is temp owner to run setup
const token = await TokenF.deploy("Order Flow Auction", "OFA", SUPPLY, wallet.address, wallet.address);
await token.waitForDeployment();
const tokenAddr = await token.getAddress();
console.log("OFAToken deployed:", tokenAddr);

// 2. curve — owner is the SECURE address from the start (controls pullLiquidity)
const curve = await CurveF.deploy(tokenAddr, FOR_SALE, VIRTUAL_ETH, REWARD_FEE_BPS, OWNER);
await curve.waitForDeployment();
const curveAddr = await curve.getAddress();
const deployBlock = (await provider.getTransactionReceipt(curve.deploymentTransaction().hash)).blockNumber;
console.log("OFABondingCurve deployed:", curveAddr, "(block", deployBlock + ")");

// 3. exclude deployer, curve, owner from rewards (so only buyers earn)
await (await token.setExcludedFromRewards(wallet.address, true)).wait();
await (await token.setExcludedFromRewards(curveAddr, true)).wait();
await (await token.setExcludedFromRewards(OWNER, true)).wait();
console.log("exclusions set");

// 4. put ALL tokens on the curve
await (await token.transfer(curveAddr, FOR_SALE)).wait();
console.log("curve funded with full supply");

// 5. hand token ownership to the secure address (curve owner already = OWNER)
await (await token.transferOwnership(OWNER)).wait();
console.log("ownership transferred to", OWNER);

console.log("\n=== DONE — paste into site/config.js ===");
console.log(`  curveAddress: "${curveAddr}",`);
console.log(`  tokenAddress: "${tokenAddr}",`);
console.log(`  deployBlock: ${deployBlock},`);
