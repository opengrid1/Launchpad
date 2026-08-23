import { expect } from "chai";
import { ethers } from "hardhat";

// HyperEVM (chainId 999) — HyperSwap V3 live periphery. HyperSwap's pool
// contract rejects a direct pool.mint (canonical Uniswap V3 accepts the same
// call), so the launchpad seeds liquidity through HyperSwap's own
// NonfungiblePositionManager — which is exactly what StableLaunchpadFactory does.
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const WHYPE = "0x5555555555555555555555555555555555555555";
const SWAP_ROUTER = "0x4e2960a8cd19b467b82d26d83facb0fae26b094d";
// Filled from the verified periphery lookup:
const NPM = process.env.HS_NPM ?? "0x0000000000000000000000000000000000000000";

const SUPPLY = ethers.parseEther("1000000000");

describe("HyperSwap launchpad via NonfungiblePositionManager (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }
  if (NPM === "0x0000000000000000000000000000000000000000") { it.skip("requires HS_NPM", () => {}); return; }

  async function deploySystem(owner: any, feeRecipient: any) {
    const tokenDeployer = await (await ethers.getContractFactory("TokenDeployer")).deploy();
    await tokenDeployer.waitForDeployment();
    const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
      owner.address, feeRecipient.address, await tokenDeployer.getAddress(),
      V3_FACTORY, NPM, SWAP_ROUTER, WHYPE,
    );
    await factory.waitForDeployment();
    await (await tokenDeployer.setFactory(await factory.getAddress())).wait();
    return { tokenDeployer, factory };
  }

  async function createToken(factory: any, creator: any) {
    const p = { name: "Hyper Coin", symbol: "HYPC", metadataURI: "{}", quote: WHYPE, marketCapUsd8: 0n };
    const rc = await (await factory.connect(creator).createToken(p)).wait();
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    return ev.args.token as string;
  }

  it("launches a coin, seeding ~full supply into a HyperSwap V3 pool via the NPM", async () => {
    const [, owner, feeRecipient, creator] = await ethers.getSigners();
    const { factory } = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator);

    const listing = await factory.listings(token);
    expect(listing.creator).to.equal(creator.address);
    expect(listing.pool).to.not.equal(ethers.ZeroAddress);

    const erc20 = await ethers.getContractAt("LaunchpadERC20", token);
    const pooled = await erc20.balanceOf(listing.pool);
    expect(pooled, "most of supply seeded").to.be.greaterThan((SUPPLY * 990_000n) / 1_000_000n);

    // The 1% (10000) tier pool for token/WHYPE exists.
    const v3 = await ethers.getContractAt("IUniswapV3FactoryCore", V3_FACTORY);
    expect(await v3.getPool(token, WHYPE, 10_000)).to.equal(listing.pool);
  });
});
