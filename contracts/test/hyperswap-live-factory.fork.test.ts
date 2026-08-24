import { expect } from "chai";
import { ethers, network } from "hardhat";

// Launches a coin PAIRED WITH A TOKENIZED STOCK against the LIVE deployed
// liquidstock rewards factory on a HyperEVM fork - the exact production path:
// live factory + reward token deployer, the live quote registry (5 Backed
// xStocks approved on-chain), live HyperSwap V3 core + NPM. Proves a user
// clicking "Launch" with a stock pair gets a real listed pool at the right
// starting price.
const FACTORY = "0x96e4e6718D78D0483Eb363dE34001CbF2eCa29C6";
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
// Backed NVDAx, approved on the live factory at $215.16 (usdPrice8 21516000000).
const NVDA = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5";
const SUPPLY = ethers.parseEther("1000000000");
const SWAP_ROUTER = "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77";

const ROUTER02_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
];
const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

// NVDAx's HyperCore spot-bridge escrow: the deepest EVM holder (thousands of
// tokens parked for Core<->EVM transfers) — the natural whale to borrow from
// on a fork. The address is the Core system address for the linked token.
const NVDA_BRIDGE = "0x200000000000000000000000000000000000034d";

/** Credit `amount` of a live ERC20 on the fork by impersonating a whale. */
async function dealFrom(token: string, whale: string, to: string, amount: bigint) {
  await network.provider.send("hardhat_impersonateAccount", [whale]);
  await network.provider.send("hardhat_setBalance", [whale, ethers.toBeHex(ethers.parseEther("1"))]);
  const signer = await ethers.getSigner(whale);
  await (await new ethers.Contract(token, ["function transfer(address,uint256) returns (bool)"], signer).transfer(to, amount)).wait();
  await network.provider.send("hardhat_stopImpersonatingAccount", [whale]);
}

describe("Stock-pair launch on the LIVE factory (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }

  it("createToken({quote: NVDAx}) opens a live NVDAx-paired pool; trade, harvest 50/40/10, claim", async () => {
    // Advance past the fork point so reads execute on a locally mined block
    // (EDR refuses to execute at the exact remote fork block).
    await network.provider.send("evm_mine");
    // A fresh user wallet, funded with gas only - launching needs no stock.
    const user = (await ethers.getSigners())[7];
    const factory = await ethers.getContractAt("StableLaunchpadFactory", FACTORY, user);

    // The live registry entry written by the owner's setQuoteAsset batch.
    const qa = await factory.quoteAssets(NVDA);
    expect(qa.approved, "NVDAx approved on the live factory").to.equal(true);
    expect(qa.usdPrice8).to.equal(21516000000n);
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
    const erc20 = await ethers.getContractAt("LaunchpadRewardToken", token);
    expect(await erc20.balanceOf(listing.pool)).to.be.greaterThan((SUPPLY * 990_000n) / 1_000_000n);

    // Starting market cap ~= $3,000 => ~13.97 NVDAon at $214.72, derived
    // from the pool's live sqrtPrice.
    const pool = new ethers.Contract(listing.pool, ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"], user);
    const [sp] = await pool.slot0();
    const Q96 = 2n ** 96n;
    const mcapQuote = listing.tokenIsToken0
      ? (((SUPPLY * BigInt(sp)) / Q96) * BigInt(sp)) / Q96
      : (((SUPPLY * Q96) / BigInt(sp)) * Q96) / BigInt(sp);
    const nvdaExpected = (3_000n * 10n ** 18n * 10n ** 8n) / 21516000000n;
    expect(mcapQuote).to.be.closeTo(nvdaExpected, nvdaExpected / 20n);

    // ---- Trade the coin IN THE STOCK, then harvest 50/40/10 and claim ----
    const trader = (await ethers.getSigners())[8];
    const nvda = new ethers.Contract(NVDA, ERC20_ABI, trader);
    await dealFrom(NVDA, NVDA_BRIDGE, trader.address, ethers.parseEther("1"));

    const router = new ethers.Contract(SWAP_ROUTER, ROUTER02_ABI, trader);
    await (await nvda.approve(SWAP_ROUTER, ethers.parseEther("0.5"))).wait();
    await (await router.exactInputSingle({
      tokenIn: NVDA, tokenOut: token, fee: 10_000, recipient: trader.address,
      amountIn: ethers.parseEther("0.5"), amountOutMinimum: 0, sqrtPriceLimitX96: 0,
    })).wait();
    const coins = (await erc20.balanceOf(trader.address)) as bigint;
    expect(coins, "coins bought with the stock").to.be.greaterThan(0n);

    // Harvest: 50% of the NVDAx fee to the holder tracker, 40% creator, 10% platform.
    const creatorBefore = (await nvda.balanceOf(user.address)) as bigint;
    await (await factory.harvestFees(token)).wait();
    const creatorGain = ((await nvda.balanceOf(user.address)) as bigint) - creatorBefore;
    const holderPot = (await nvda.balanceOf(token)) as bigint;
    expect(creatorGain, "creator paid in the stock").to.be.greaterThan(0n);
    expect(holderPot, "holder pot funded in the stock").to.be.greaterThan(0n);

    // Manual claim: the trader pulls their share of the stock.
    const rt = await ethers.getContractAt("LaunchpadRewardToken", token);
    const pending = await rt.pendingRewards(trader.address);
    expect(pending, "trader accrued stock rewards").to.be.greaterThan(0n);
    const balBefore = (await nvda.balanceOf(trader.address)) as bigint;
    await (await rt.connect(trader).claim()).wait();
    expect(((await nvda.balanceOf(trader.address)) as bigint) - balBefore).to.equal(pending);
  });
});
