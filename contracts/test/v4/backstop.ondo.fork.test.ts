import { expect } from "chai";
import { ethers, network } from "hardhat";
import fs from "node:fs";
import path from "node:path";

// Ondo tokenized stocks as Etherhook backing, against the LIVE mainnet deployment on a fork:
// a pool-priced stock (AAPLon), an admin-priced one (AMZNon) and a Chainlink-fed one (IAUon).
// Proves Ondo's transfer compliance lets the PoolManager, the strategy and holders move them.
//   FORK=1 ETH_RPC_URL=https://ethereum-rpc.publicnode.com \
//   npx hardhat --config hardhat.config.backstop.ts test test/v4/backstop.ondo.fork.test.ts
const DEP = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments", "eth-backstop.json"), "utf8"));
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "deployments", "ondo-sources.json"), "utf8")).sources;
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH_USDC_V3 = "0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640";
const AAPLon = "0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c";
const AMZNon = "0xbb8774FB97436d23d74C1b882E8E9A69322cFD31";
const IAUon = "0x4f0CA3df1c2e6b943cf82E649d576ffe7B2fABCF";
const IAU_FEED = "0x1f09475Fe4D212fC24611bAE180201869956c238";
const AMZN_HOLDERS = ["0xef81741dbd6f0845b843bf185a08106e8510456e", "0x113dfa13c38090c4afc61210cd8ea0dbf961f4e0", "0x2c158bc456e027b2affccadf1bdbd9f5fc4c5c8c", "0x82de3fae1dabe0d6826e4deeca138c5d3047f397", "0x7cfd98500ec866b7df3dac37c98847e4a80a3467"];
const V3 = 2;
const EMPTY_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const route = (hops: any[]) => ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [hops]);
const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)"];
const E = ethers.parseEther;
const mins = async (m: number) => { await network.provider.send("evm_increaseTime", [Math.round(m * 60)]); await network.provider.send("evm_mine", []); };
let saltN = 9000n;

describe("Etherhook with Ondo stocks (live deployment, mainnet fork)", function () {
  this.timeout(1_800_000);
  let factory: any, router: any, oracle: any, admin: any, creator: any, alice: any, bob: any;
  const aaplRoute = route([
    { dex: V3, pool: WETH_USDC_V3, key: EMPTY_KEY },
    { dex: V3, pool: SRC.find((s: any) => s.symbol === "AAPLon").pool, key: EMPTY_KEY },
  ]);

  async function launch(pair: string, o: { ethIn?: bigint; route?: string } = {}) {
    const n = Number(await factory.totalTokens());
    await (await factory.connect(creator).launch({
      name: "Stock Test", symbol: "STK", metadataURI: "{}", pair, minPairOut: 0,
      rules: { taxBps: 500, dynMaxBps: 0, snipeBps: 0, snipeSecs: 0, maxTxBps: 0, mev: false },
      split: { creator: 60, holders: 40, vault: 150, buyback: 100, lp: 0, burn: 50 },
      options: { tpBps: 0, redeemable: true, vestSecs: 0, payout: 0 }, basket: [], sources: [],
    }, ethers.zeroPadValue(ethers.toBeHex(saltN++), 32), o.route ?? "0x", { value: o.ethIn ?? 0n })).wait();
    const token = await factory.allTokens(n);
    return { token, coin: await ethers.getContractAt("BackstopToken", token), strategy: await ethers.getContractAt("BackstopStrategy", await factory.strategyOf(token)) };
  }

  before(async () => {
    await network.provider.send("evm_mine", []);
    factory = await ethers.getContractAt("BackstopFactory", DEP.contracts.factory);
    router = await ethers.getContractAt("BackstopRouter", DEP.contracts.router);
    oracle = await ethers.getContractAt("BackstopOracle", DEP.contracts.oracle);
    [, creator, alice, bob] = await ethers.getSigners();
    for (const s of [creator, alice, bob]) await network.provider.send("hardhat_setBalance", [s.address, "0x" + E("100").toString(16)]);
    await network.provider.send("hardhat_impersonateAccount", [DEP.admin]);
    await network.provider.send("hardhat_setBalance", [DEP.admin, "0x" + E("10").toString(16)]);
    admin = await ethers.getSigner(DEP.admin);
  });

  it("AAPLon (pool-priced): buy it with ETH, launch, trade with ETH and with AAPLon, run the strategy, redeem", async () => {
    const aapl = await ethers.getContractAt(ERC20, AAPLon);
    expect(await oracle.settled(AAPLon)).to.equal(true);
    console.log(`      AAPLon oracle price $${(Number(await oracle.price(AAPLon)) / 1e18).toFixed(2)}`);
    // ETH -> USDC -> AAPLon through the router
    await (await router.connect(alice).ethToPair(AAPLon, aaplRoute, alice.address, 0, { value: E("1") })).wait();
    const got = await aapl.balanceOf(alice.address);
    console.log(`      1 ETH bought ${ethers.formatEther(got)} AAPLon`);
    expect(got).to.be.gt(0);

    const r = await launch(AAPLon, { ethIn: E("0.05"), route: aaplRoute });
    expect(await r.coin.balanceOf(creator.address)).to.be.gt(0);
    await mins(2);
    // buy with ETH (routed), buy with AAPLon directly, sell both ways
    await (await router.connect(bob).buy(r.token, aaplRoute, 0, { value: E("0.5") })).wait();
    await (await aapl.connect(alice).approve(await router.getAddress(), got)).wait();
    await (await router.connect(alice).buyWithPair(r.token, got / 2n, 0)).wait();
    await mins(1);
    const bal = await r.coin.balanceOf(alice.address);
    await (await r.coin.connect(alice).approve(await router.getAddress(), bal)).wait();
    await (await router.connect(alice).sellForPair(r.token, bal / 2n, 0)).wait();
    await mins(1);
    const bb = await r.coin.balanceOf(bob.address);
    await (await r.coin.connect(bob).approve(await router.getAddress(), bb)).wait();
    const ethBefore = await ethers.provider.getBalance(bob.address);
    await (await router.connect(bob).sell(r.token, bb / 2n, aaplRoute, 0)).wait();
    expect(await ethers.provider.getBalance(bob.address)).to.be.gt(ethBefore - E("0.01"));
    await (await r.strategy.execute()).wait();
    const vault = await r.strategy.vault();
    console.log(`      vault ${ethers.formatEther(vault)} AAPLon after trades`);
    expect(vault).to.be.gt(0);
    // redeem pays AAPLon out of the vault
    const left = await r.coin.balanceOf(alice.address);
    const pre = await aapl.balanceOf(alice.address);
    await (await r.coin.connect(alice).approve(await r.strategy.getAddress(), left)).wait();
    await (await r.strategy.connect(alice).redeem(left / 2n, 0, alice.address)).wait();
    expect(await aapl.balanceOf(alice.address)).to.be.gt(pre);
  });

  it("AMZNon (admin-priced, no pool): list, launch, trade with AMZNon, redeem", async () => {
    await (await oracle.connect(admin).setListed(AMZNon, true, 25992000000n, ethers.ZeroAddress)).wait(); // $259.92
    expect(Number(await oracle.price(AMZNon)) / 1e18).to.be.closeTo(259.92, 0.01);
    const amzn = await ethers.getContractAt(ERC20, AMZNon);
    let best = "", most = 0n;
    for (const h of AMZN_HOLDERS) { const b = await amzn.balanceOf(h); if (b > most) { most = b; best = h; } }
    expect(most, "no AMZNon holder found").to.be.gt(0n);
    await network.provider.send("hardhat_impersonateAccount", [best]);
    await network.provider.send("hardhat_setBalance", [best, "0x" + E("1").toString(16)]);
    const amt = most / 2n;
    await (await amzn.connect(await ethers.getSigner(best)).transfer(alice.address, amt)).wait();
    console.log(`      moved ${ethers.formatEther(amt)} AMZNon from a holder to alice`);
    const r = await launch(AMZNon);
    await mins(2);
    await (await amzn.connect(alice).approve(await router.getAddress(), amt)).wait();
    await (await router.connect(alice).buyWithPair(r.token, (amt * 4n) / 5n, 0)).wait();
    await mins(1);
    const bal = await r.coin.balanceOf(alice.address);
    await (await r.coin.connect(alice).approve(await router.getAddress(), bal)).wait();
    await (await router.connect(alice).sellForPair(r.token, bal / 3n, 0)).wait();
    await (await r.strategy.execute()).wait();
    const vault = await r.strategy.vault();
    console.log(`      vault ${ethers.formatEther(vault)} AMZNon`);
    expect(vault).to.be.gt(0);
    const pre = await amzn.balanceOf(alice.address);
    const left = await r.coin.balanceOf(alice.address);
    await (await r.coin.connect(alice).approve(await r.strategy.getAddress(), left)).wait();
    await (await r.strategy.connect(alice).redeem(left / 2n, 0, alice.address)).wait();
    expect(await amzn.balanceOf(alice.address)).to.be.gt(pre);
  });

  it("IAUon (Chainlink feed): list with the feed; the oracle follows the feed", async () => {
    await (await oracle.connect(admin).setListed(IAUon, true, 7706000000n, IAU_FEED)).wait();
    const feed = await ethers.getContractAt(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], IAU_FEED);
    const [, answer] = await feed.latestRoundData();
    const px = Number(await oracle.price(IAUon)) / 1e18;
    console.log(`      IAUon oracle $${px.toFixed(4)}, feed $${(Number(answer) / 1e8).toFixed(4)}`);
    expect(px).to.be.closeTo(Number(answer) / 1e8, 1e-6);
    const r = await launch(IAUon);
    expect(await r.coin.totalSupply()).to.be.gt(0);
  });
});
