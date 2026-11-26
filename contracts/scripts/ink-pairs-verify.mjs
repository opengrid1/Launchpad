import { ethers } from "ethers";
const p = new ethers.JsonRpcProvider("https://rpc-gel.inkonchain.com", 57073);
const FACTORY = "0x640887a9ba3a9c53ed27d0f7e8246a4f933f3424";
const USDG = "0xe343167631d89B6Ffc58B88d6b7fB0228795491D";
const WETH = "0x4200000000000000000000000000000000000006";
const USDT0 = "0x0200C29006150606B650577BBE7B6248F58470c1";
const FAB = ["function getPool(address,address,uint24) view returns (address)"];
const POOL = ["function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint8,bool)", "function token0() view returns (address)"];
const ERC = ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const fab = new ethers.Contract(FACTORY, FAB, p);
const W = {
  wNVDAx: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", wSPYx: "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540",
  wAAPLx: "0x943BF64D566c32A2Bcd41AC92FB63C111cC9De8f", wTSLAx: "0xc3FdBe3A68EE5dE461D30415a8165cf9Aefe1171",
  wMSTRx: "0x30987adF0B11dc698438a99BA04ec3a1AB2c7EaB", wNFLXx: "0x7d87fD6A379714194a797c0bBB8B40c30D250856",
  wPLTRx: "0x4A2df09536F62341C9f946427D16414C04e21342",
};
// USD price of each wrapped stock from its USDG (6d) 0.05% pool
for (const [name, addr] of Object.entries(W)) {
  const pool = await fab.getPool(addr, USDG, 500);
  const c = new ethers.Contract(pool, POOL, p);
  const [s0, t0] = await Promise.all([c.slot0(), c.token0()]);
  const sp = Number(s0.sqrtPriceX96) / 2 ** 96;
  const raw = sp * sp; // token1 per token0 (raw units)
  const stockIs0 = t0.toLowerCase() === addr.toLowerCase();
  const px = stockIs0 ? raw * 1e12 : (1 / raw) * 1e12; // USDG(6d) per stock(18d)
  console.log(`${name}: $${px.toFixed(2)} (pool ${pool})`);
}
// ETH price from USDC.e/WETH 0.05% pool (USDC.e 6d)
{
  const USDCE = "0xF1815bd50389c46847f0Bda824eC8da914045D14";
  const pool = await fab.getPool(WETH, USDCE, 500);
  const c = new ethers.Contract(pool, POOL, p);
  const [s0, t0] = await Promise.all([c.slot0(), c.token0()]);
  const sp = Number(s0.sqrtPriceX96) / 2 ** 96; const raw = sp * sp;
  const wethIs0 = t0.toLowerCase() === WETH.toLowerCase();
  const px = wethIs0 ? raw * 1e12 : (1 / raw) * 1e12;
  console.log(`WETH: $${px.toFixed(2)}`);
}
// Transferability probe: eth_call transfer(1 wei) impersonating a pool (a real holder)
async function probe(name, token, holder) {
  const iface = new ethers.Interface(ERC);
  try {
    const bal = await new ethers.Contract(token, ERC, p).balanceOf(holder);
    if (bal === 0n) return console.log(`${name}: holder has 0, skip`);
    const data = iface.encodeFunctionData("transfer", ["0x000000000000000000000000000000000000dEaD", 1n]);
    const res = await p.call({ from: holder, to: token, data });
    console.log(`${name}: transfer simulation OK (${res.slice(0, 10)}...)`);
  } catch (e) {
    console.log(`${name}: transfer REVERTS -> ${String(e.shortMessage || e.message).slice(0, 90)}`);
  }
}
// native NVDAX: use its top holder = the wrapper contract wNVDAx (holds the backing)
await probe("NVDAX native (from wrapper's balance)", "0xc845b2894dBddd03858fd2D643B4eF725fE0849d", "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5");
// wNVDAx: use its WETH pool as holder
{
  const pool = await fab.getPool(W.wNVDAx, WETH, 10000);
  await probe("wNVDAx (from its pool)", W.wNVDAx, pool);
}
