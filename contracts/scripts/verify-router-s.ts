import { run } from "hardhat";
async function main() {
  await run("verify:verify", {
    address: "0xb8aEcB596E56586c00dc73D6B00B6a16f72D4663",
    constructorArguments: [
      "0x8366a39cc670b4001a1121b8f6a443a643e40951",
      "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
      "0xf91f6e6C05CA0aBb519763770E2B417Bb788C044",
      "0x9b205b212b08D02Dd255a4C98404C61548414663",
      {
        currency0: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
        currency1: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
        fee: 500,
        tickSpacing: 10,
        hooks: "0x0000000000000000000000000000000000000000",
      },
    ],
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
