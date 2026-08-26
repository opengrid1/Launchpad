import { ethers } from "hardhat";

/** One-off: launch inkinu (INKINU) on the live Ink factory, paired wNVDAx. */
async function main() {
  const [signer] = await ethers.getSigners();
  const factory = await ethers.getContractAt("StableLaunchpadFactory", "0xA99D56AD2b56e5fA0e0B300951F60eDBA0C3e995");
  console.log("signer:", signer.address, "balance:", ethers.formatEther(await ethers.provider.getBalance(signer.address)));

  const metadataURI = JSON.stringify({
    description: "The first inu of the deep. Launched on squidpad, trading against NVIDIA.",
    logo: "", website: "", twitter: "", telegram: "", links: [],
  });

  const tx = await factory.createToken({
    name: "inkinu",
    symbol: "INKINU",
    metadataURI,
    quote: "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5", // wNVDAx
    marketCapUsd8: 0n, // default $3,000
    devBuyQuote: 0n,
  });
  console.log("submitted:", tx.hash);
  const rc = await tx.wait();
  const ev = rc!.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
    .find((l) => l && (l.name === "TokenCreated" || l.name === "TokenLaunched"));
  console.log("event:", ev?.name, JSON.stringify(ev?.args?.map ? [...ev.args].map(String) : ev?.args));
}
main().catch((e) => { console.error(e); process.exit(1); });
