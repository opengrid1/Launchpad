import { ethers } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

async function main() {
  const dep = JSON.parse(readFileSync(join(__dirname, "../deployments/quiver-v4.json"), "utf8"));
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("QuiverFactory", dep.contracts.factory);

  const stock = process.env.STOCK ?? "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"; // NVDA
  const params = {
    name: process.env.NAME ?? "Quiver Test",
    symbol: process.env.SYMBOL ?? "QTEST",
    metadataURI: process.env.META ?? "",
    stock,
    taxBps: Number(process.env.TAX ?? 500),
  };
  console.log("launching from", signer.address, params);

  const tx = await factory.launch(params);
  const rcpt = await tx.wait();
  const count = await factory.totalTokens();
  const token = await factory.allTokens(count - 1n);
  const listing = await factory.listings(token);

  const erc20 = await ethers.getContractAt("QuiverToken", token);
  console.log("\n✅ launched");
  console.log("  token:      ", token);
  console.log("  symbol:     ", await erc20.symbol());
  console.log("  totalSupply:", (await erc20.totalSupply()).toString());
  console.log("  reward stock:", listing.stock);
  console.log("  taxBps:     ", listing.taxBps.toString());
  console.log("  poolId:     ", listing.poolId);
  console.log("  tx:         ", rcpt?.hash);
  console.log("  gas used:   ", rcpt?.gasUsed?.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
