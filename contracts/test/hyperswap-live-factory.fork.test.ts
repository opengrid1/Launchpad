import { expect } from "chai";
import { ethers, network } from "hardhat";

// Launches a coin PAIRED WITH A TOKENIZED STOCK against the LIVE deployed
// liquidstock factory on a HyperEVM fork - the exact production path: live
// factory + token deployer, the live quote registry (35 Ondo stocks approved
// on-chain), live HyperSwap V3 core + NPM. Proves a user clicking "Launch"
// with a stock pair gets a real listed pool at the right starting price.
const FACTORY = "0xE1DF818afA3154B56D719D92e25A69686b7046d4";
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
// Ondo NVDAon, approved on the live factory at $214.72 (usdPrice8 21472000000).
const NVDA = "0xB989ad9b91886b1Aaed8DaADb26F028b29b40945";
const SUPPLY = ethers.parseEther("1000000000");

describe("Stock-pair launch on the LIVE factory (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }

  it("createToken({quote: NVDAon}) opens a live NVDAon-paired HyperSwap pool", async () => {
    // Advance past the fork point so reads execute on a locally mined block
    // (EDR refuses to execute at the exact remote fork block).
    await network.provider.send("evm_mine");
    // A fresh user wallet, funded with gas only - launching needs no stock.
    const user = (await ethers.getSigners())[7];
    const factory = await ethers.getContractAt("StableLaunchpadFactory", FACTORY, user);

    // The live registry entry written by the owner's setQuoteAsset batch.
    const qa = await factory.quoteAssets(NVDA);
    expect(qa.approved, "NVDAon approved on the live factory").to.equal(true);
    expect(qa.usdPrice8).to.equal(21472000000n);
    expect(qa.decimals).to.equal(18);

    const rc = await (await factory.createToken({
      name: "Nvidia Fan Coin", symbol: "NVFC",
      metadataURI: JSON.stringify({ pair: "NVDA", pairAddress: NVDA }),
      quote: NVDA, marketCapUsd8: 0n, devBuyQuote: 0n,
    })).wait();
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    const token = ev.args.token as string;

    const listing = await factory.listings(token);
    expect(listing.creator).to.equal(user.address);
    expect(listing.quote, "listing records the stock pair").to.equal(NVDA);
    expect(listing.pool).to.not.equal(ethers.ZeroAddress);

    // The pool is registered on HyperSwap's own V3 factory at the 1% tier.
    const v3 = await ethers.getContractAt("IUniswapV3FactoryCore", V3_FACTORY);
    expect(await v3.getPool(token, NVDA, 10_000)).to.equal(listing.pool);

    // Full supply seeded single-sided; the factory holds the LP NFT.
    const erc20 = await ethers.getContractAt("LaunchpadERC20", token);
    expect(await erc20.balanceOf(listing.pool)).to.be.greaterThan((SUPPLY * 990_000n) / 1_000_000n);

    // Starting market cap ~= $3,000 => ~13.97 NVDAon at $214.72, derived
    // from the pool's live sqrtPrice.
    const pool = new ethers.Contract(listing.pool, ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"], user);
    const [sp] = await pool.slot0();
    const Q96 = 2n ** 96n;
    const mcapQuote = listing.tokenIsToken0
      ? (((SUPPLY * BigInt(sp)) / Q96) * BigInt(sp)) / Q96
      : (((SUPPLY * Q96) / BigInt(sp)) * Q96) / BigInt(sp);
    const nvdaExpected = (3_000n * 10n ** 18n * 10n ** 8n) / 21472000000n;
    expect(mcapQuote).to.be.closeTo(nvdaExpected, nvdaExpected / 20n);
  });
});
