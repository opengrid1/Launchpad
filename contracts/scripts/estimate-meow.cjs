const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const DEPLOYER = "0x70263ae0b3b7C5b62f5A93b7893d86Ed986aD0aD";
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const NPM = "0x6eda206207c09e5428f281761ddc0d300851fbc8";
const ROUTER = "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77";
const WHYPE = "0x5555555555555555555555555555555555555555";

function art(p) { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8")); }

async function main() {
  const p = new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm", 999);
  const td = art("artifacts-size/contracts/stable/SquidTokenDeployer.sol/SquidTokenDeployer.json");
  const fac = art("artifacts-size/contracts/stable/StableLaunchpadFactory.sol/StableLaunchpadFactory.json");

  // SquidTokenDeployer deploy (no constructor args)
  const tdFactory = new ethers.ContractFactory(td.abi, td.bytecode);
  const tdTx = await tdFactory.getDeployTransaction();
  const tdGas = await p.estimateGas({ from: DEPLOYER, data: tdTx.data });
  console.log("SquidTokenDeployer deploy gas:", tdGas.toString());

  // Factory deploy (dummy tokenDeployer addr for estimate)
  const dummyTd = "0x000000000000000000000000000000000000dEaD";
  const facFactory = new ethers.ContractFactory(fac.abi, fac.bytecode);
  const facTx = await facFactory.getDeployTransaction(DEPLOYER, DEPLOYER, dummyTd, V3_FACTORY, NPM, ROUTER, WHYPE, 5000, 4000, 10000);
  try {
    const facGas = await p.estimateGas({ from: DEPLOYER, data: facTx.data });
    console.log("StableLaunchpadFactory deploy gas:", facGas.toString());
    console.log("fits small block (<3M)?", facGas < 3_000_000n);
  } catch (e) {
    console.log("factory estimate error:", e.shortMessage || e.message);
  }
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
