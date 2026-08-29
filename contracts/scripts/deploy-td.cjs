const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadKey() {
  const env = fs.readFileSync(path.join(__dirname, "..", ".env.meow-deployer"), "utf8");
  return env.match(/PRIVATE_KEY=(0x[0-9a-fA-F]{64})/)[1];
}
function art(p) { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8")); }

async function main() {
  const p = new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm", 999);
  const w = new ethers.Wallet(loadKey(), p);
  const td = art("artifacts-size/contracts/stable/SquidTokenDeployer.sol/SquidTokenDeployer.json");
  const f = new ethers.ContractFactory(td.abi, td.bytecode, w);
  const fees = { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n };
  const c = await f.deploy({ gasLimit: 2_600_000n, ...fees }); // < 3M small block
  console.log("tx:", c.deploymentTransaction().hash);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log("SquidTokenDeployer:", addr);
  fs.writeFileSync(path.join(__dirname, "..", ".meow-tokendeployer"), addr + "\n");
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
