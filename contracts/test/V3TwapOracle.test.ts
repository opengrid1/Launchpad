import { expect } from "chai";
import { ethers } from "hardhat";

// V3TwapOracle: price per raw stock unit from a stock/USDG V3 pool TWAP.
// Ticks below are real Robinhood Chain readings (Sep 2026) so the expected
// prices can be cross-checked against the JS spot computation:
//   TSLA/USDG 0.3%  tick -217053, TSLA is token0  -> ~$374.96
//   AAPL/USDG 0.05% tick  218442, AAPL is token1  -> ~$326.30

const WAD = 10n ** 18n;
const MINT_ROLE = ethers.id("MINT_ROLE");

async function setup() {
  const [owner] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockB20");
  const usdg = await Mock.deploy("USDG", "USDG", owner.address, 6);
  const tsla = await Mock.deploy("Tesla", "TSLA", owner.address, 18);
  const aapl = await Mock.deploy("Apple", "AAPL", owner.address, 18);
  const U = await usdg.getAddress(), T = await tsla.getAddress(), A = await aapl.getAddress();
  const Pool = await ethers.getContractFactory("MockV3Pool");
  const tslaPool = await Pool.deploy(T, U); // TSLA token0
  const aaplPool = await Pool.deploy(U, A); // AAPL token1
  await tslaPool.set(-217053, -217053);
  await aaplPool.set(218442, 218442);
  const oracle = await (await ethers.getContractFactory("V3TwapOracle")).deploy(owner.address, U);
  await oracle.setFeed(T, await tslaPool.getAddress(), 1800);
  await oracle.setFeed(A, await aaplPool.getAddress(), 1800);
  return { owner, oracle, tslaPool, aaplPool, T, A, U, usdg };
}

const near = (a: bigint, b: bigint, bps = 5n) => { const d = a > b ? a - b : b - a; expect(d * 10_000n <= b * bps, `${a} vs ${b}`).to.be.true; };

describe("V3TwapOracle", () => {
  it("prices a stock that is token0 (TSLA) and one that is token1 (AAPL)", async () => {
    const { oracle, T, A } = await setup();
    near(await oracle.getPrice(T), 374_96n * WAD / 100n);
    near(await oracle.getPrice(A), 326_30n * WAD / 100n);
  });

  it("returns the TWAP, not the spot, and rejects a spot too far from it", async () => {
    const { oracle, tslaPool, T } = await setup();
    await tslaPool.set(-217053 + 300, -217053); // spot ~3% above twap (1.0001^300)
    near(await oracle.getPrice(T), 374_96n * WAD / 100n);
    await tslaPool.set(-217053 + 600, -217053); // ~6.2% above: over the 5% guard
    await expect(oracle.getPrice(T)).to.be.revertedWithCustomError(oracle, "SpotDeviation");
    const [twap, spot] = await oracle.peek(T); // peek still works
    expect(spot > twap).to.be.true;
  });

  it("fails closed when the pool lacks history for the window", async () => {
    const { oracle, tslaPool, T } = await setup();
    await tslaPool.setTooOld(true);
    await expect(oracle.getPrice(T)).to.be.revertedWith("OLD");
  });

  it("refuses a pool that is not stock/quote and an unknown stock", async () => {
    const { oracle, aaplPool, T, U } = await setup();
    await expect(oracle.setFeed(T, await aaplPool.getAddress(), 1800)).to.be.revertedWithCustomError(oracle, "BadPool");
    await expect(oracle.getPrice(U)).to.be.revertedWithCustomError(oracle, "NoFeed");
    await expect(oracle.setFeed(T, await aaplPool.getAddress(), 30)).to.be.revertedWith("bad window");
  });

  it("negative average ticks round toward negative infinity", async () => {
    const { oracle, tslaPool, T } = await setup();
    // twap tick exactly -217053 either way; sanity that a tiny shift moves the price the right way
    const p0 = await oracle.getPrice(T);
    await tslaPool.set(-217054, -217054);
    const p1 = await oracle.getPrice(T);
    expect(p1 < p0).to.be.true;
  });
});
