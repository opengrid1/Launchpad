import { ethers } from "ethers";
const p = new ethers.JsonRpcProvider("https://rpc-gel.inkonchain.com", 57073);
const ERC = ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const iface = new ethers.Interface(ERC);
async function probe(name, token, holder, amt) {
  try {
    const bal = await new ethers.Contract(token, ERC, p).balanceOf(holder);
    if (bal < amt) return console.log(`${name}: holder bal ${bal} < amt, skip`);
    const data = iface.encodeFunctionData("transfer", ["0x000000000000000000000000000000000000dEaD", amt]);
    const res = await p.call({ from: holder, to: token, data });
    const ok = res === "0x" || BigInt(res) === 1n;
    console.log(`${name}: ${ok ? "TRANSFER OK" : `returned ${res}`}`);
  } catch (e) {
    console.log(`${name}: REVERTS -> ${String(e.shortMessage || e.message).slice(0, 100)}`);
  }
}
const NVDAX = "0xc845b2894dBddd03858fd2D643B4eF725fE0849d";
const wNVDAx = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5";
const wSPYx = "0xE7E553Cd128F0011777323A0b44a7b96EA1CB540";
await probe("NVDAX native", NVDAX, wNVDAx, 10n ** 15n);
await probe("wNVDAx", wNVDAx, "0x01951DDb43A451500bfAF652d40C07309fAD4727", 10n ** 15n);
await probe("wSPYx", wSPYx, "0x06fB000Fe9C6505Eb3b2CdF52445d8C7d5690F47", 10n ** 15n);
