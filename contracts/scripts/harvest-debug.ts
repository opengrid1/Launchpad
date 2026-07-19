import { ethers, network } from "hardhat";

// Replays each internal harvest swap leg from the hook's own address on a
// fork, to find which leg throws "ERC20: transfer amount exceeds balance".
async function main() {
  const HOOK = "0x1E8fd8f01C44084E514d872AD27455De5c994044";
  const PM = ethers.getAddress("0x8366a39cc670b4001a1121b8f6a443a643e40951");
  // Mine one local block so eth_call targets a locally-executed block; EDR
  // refuses static calls at the remote fork block without hardfork history.
  await network.provider.send("hardhat_mine", ["0x1"]);
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [HOOK] });
  await network.provider.send("hardhat_setBalance", [HOOK, "0x1000000000000000000"]);
  const hookSigner = await ethers.getSigner(HOOK);
  const pm = new ethers.Contract(PM, ["function unlock(bytes) returns (bytes)"], hookSigner);

  const hook = await ethers.getContractAt("QuiverHook", HOOK);
  const quoteKey = await hook.quoteKey();
  console.log("quoteKey:", quoteKey.map((x: any) => x.toString()));

  const factory = await ethers.getContractAt("QuiverFactory", "0x7684E116F10DD7B6634E17cba9A3767CD7B84663");
  const stockKey = await factory.stockPool("0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa");
  console.log("stockKey:", stockKey.map((x: any) => x.toString()));

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const enc = (key: any, zeroForOne: boolean, amountIn: bigint) =>
    coder.encode(
      ["tuple(tuple(address,address,uint24,int24,address) key, bool zeroForOne, uint256 amountIn)"],
      [{ key: [key[0], key[1], key[2], key[3], key[4]], zeroForOne, amountIn }],
    );

  const WETH = ethers.getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  // Leg A: WETH -> USDG on the quote pool (toHolders ≈ half of wethFees)
  const toHolders = (await hook.wethFees("0x600478629dd470fbf2a4145a24899458aab34663")) / 2n;
  const wethIsC0 = quoteKey[0].toLowerCase() === WETH.toLowerCase();
  try {
    await (await pm.unlock(enc(quoteKey, wethIsC0, toHolders), { gasLimit: 2_000_000 })).wait();
    console.log("leg A (WETH->USDG) OK");
  } catch (e: any) {
    console.log("leg A (WETH->USDG) REVERTED:", e.message?.slice(0, 200));
    return;
  }
  // Leg B: USDG -> SPCX on the stock pool
  const USDG = ethers.getAddress("0x5fc5360d0400a0fd4f2af552add042d716f1d168");
  const usdg = new ethers.Contract(USDG, ["function balanceOf(address) view returns (uint256)"], ethers.provider);
  const usdgBal = await usdg.balanceOf(HOOK);
  console.log("hook USDG after leg A:", usdgBal.toString());
  const usdgIsC0 = stockKey[0].toLowerCase() === USDG.toLowerCase();
  try {
    await (await pm.unlock(enc(stockKey, usdgIsC0, usdgBal), { gasLimit: 2_000_000 })).wait();
    console.log("leg B (USDG->SPCX) OK");
    const spcx = new ethers.Contract("0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", ["function balanceOf(address) view returns (uint256)"], ethers.provider);
    console.log("hook SPCX out:", (await spcx.balanceOf(HOOK)).toString());
  } catch (e: any) {
    console.log("leg B (USDG->SPCX) REVERTED:", e.message?.slice(0, 200));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
