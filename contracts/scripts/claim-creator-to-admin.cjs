/* eslint-disable no-console */
// Claims the deployer's creator fees on STONKREUM (ETH pair) and STEST (NVDAon,
// swapped to ETH via the router), then forwards the ETH to the admin wallet.
const fs = require("fs"); const path = require("path");
const { ethers } = require("ethers");
const T = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts-size/contracts/v4/eth/StockPadToken.sol/StockPadToken.json"), "utf8")).abi;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", NVDA = "0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE";
const KEY_T = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const NVDA_ROUTE = ethers.AbiCoder.defaultAbiCoder().encode(["bytes", KEY_T], [ethers.solidityPacked(["address", "uint24", "address"], [WETH, 500, USDC]), { currency0: NVDA, currency1: USDC, fee: 9000, tickSpacing: 90, hooks: ethers.ZeroAddress }]);
const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
(async () => {
  const p = new ethers.JsonRpcProvider("https://ethereum-rpc.publicnode.com", 1, { staticNetwork: true, batchMaxCount: 1 });
  const w = new ethers.Wallet(process.env.PRIVATE_KEY, p);
  const fee = await p.getFeeData();
  const opts = { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: 50_000_000n };
  console.log("deployer", w.address, "ETH before", ethers.formatEther(await p.getBalance(w.address)));
  for (const [sym, addr, asEth, route] of [["STONKREUM", "0x89587D36065CB81b49b783bd3CD3C210C4ccd210", true, "0x"], ["STEST", "0x7d1f2A2a5897DeEA34A3F96f48CA16f9DFf23306", true, NVDA_ROUTE]]) {
    const t = new ethers.Contract(addr, T, w);
    const owed = await t.creatorFees();
    if (owed === 0n) { console.log(sym, "nothing to claim"); continue; }
    const tx = await t.claimCreatorFees(asEth, 0, route, opts);
    const rc = await tx.wait();
    console.log(sym, "claimed", ethers.formatEther(owed), asEth ? "(as ETH)" : "", "tx", tx.hash, "status", rc.status);
  }
  const bal = await p.getBalance(w.address);
  const keep = ethers.parseEther("0.0004"); // gas reserve for future claims
  const send = bal - keep;
  if (send <= 0n) { console.log("nothing left to forward; balance", ethers.formatEther(bal)); return; }
  const tx = await w.sendTransaction({ to: ADMIN, value: send, gasLimit: 21000n, ...opts });
  const rc = await tx.wait();
  console.log("forwarded", ethers.formatEther(send), "ETH to admin", ADMIN, "tx", tx.hash, "status", rc.status, "| deployer left", ethers.formatEther(await p.getBalance(w.address)));
})().catch((e) => { console.error("FAILED", e.shortMessage || e.message); process.exit(1); });
