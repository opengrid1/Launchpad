import { expect } from "chai";
import { ethers, network } from "hardhat";

/**
 * Liqio against the real HyperEVM: Uniswap v4 PoolManager, WHYPE, USDC, wNVDAx (Backed's wrapped xStock) and
 * the PRJX pools the router hops through. Only the HyperCore price precompile is mocked (a fork cannot run
 * native precompiles); it is seeded with the live values read from the RPC at the start of the run.
 *
 *   HYPEREVM_FORK=1 HYPEREVM_RPC_URL=https://… npx hardhat test test/v4/liqio.fork.test.ts
 */

const ON = process.env.HYPEREVM_FORK === "1";
const RPC = process.env.HYPEREVM_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";
const POOL_MANAGER = "0x12D4Fd9C5DeDd00ab8a0bCe2CF0167bbf94b6B1F";
const WHYPE = "0x5555555555555555555555555555555555555555";
const USDC = "0xb88339CB7199b77E23DB6E890353E22632Ba630f";
const WNVDA = "0xa8ddb5Cd96b5222AFe198316E9A57CAA642850D5";
const PRJX_USDC = "0x6c9A33E3b592C0d65B3Ba59355d5Be0d38259285"; // WHYPE/USDC 0.05%
const PRJX_NVDA = "0x4bc0C3C0947d968043762149EAa51aBbF35C2687"; // WHYPE/wNVDAx 1%
const ORACLE_PX = "0x0000000000000000000000000000000000000807";
const HYPE_IDX = 159, NVDA_IDX = 10_002;
const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const E18 = 10n ** 18n;
const SMALL_BLOCK_GAS = 3_000_000n;
const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };
const NO_KEY = { currency0: ethers.ZeroAddress, currency1: ethers.ZeroAddress, fee: 0, tickSpacing: 0, hooks: ethers.ZeroAddress };
const HOP_T = "tuple(uint8 dex,address pool,tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key)[]";
const route = (pool: string) => ethers.AbiCoder.defaultAbiCoder().encode([HOP_T], [[{ dex: 2, pool, key: NO_KEY }]]);

async function livePx(index: number): Promise<bigint> {
  let last = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    // public nodes drop precompile reads now and then; retry with a short backoff
    try {
      const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: ORACLE_PX, data: ethers.zeroPadValue(ethers.toBeHex(index), 32) }, "latest"] }) });
      const j: any = await res.json();
      if (j.result && j.result.length === 66 && BigInt(j.result) !== 0n) return BigInt(j.result);
      last = JSON.stringify(j);
    } catch (e: any) { last = String(e); }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`no live price for market ${index}: ${last}`);
}

(ON ? describe : describe.skip)("Liqio on a HyperEVM fork: real PoolManager, WHYPE, USDC, wNVDAx and PRJX routes", function () {
  this.timeout(900_000);
  const erc20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)", "function convertToAssets(uint256) view returns (uint256)", "function symbol() view returns (string)"];

  async function stack() {
    const [deployer, creator, trader] = await ethers.getSigners();
    expect((await ethers.provider.getNetwork()).chainId).to.equal(999n);
    const core = await (await ethers.getContractFactory("MockHyperCore")).deploy();
    await network.provider.send("hardhat_setCode", [ORACLE_PX, await ethers.provider.getCode(await core.getAddress())]);
    const px = await ethers.getContractAt("MockHyperCore", ORACLE_PX);
    const hypeRaw = await livePx(HYPE_IDX), nvdaRaw = await livePx(NVDA_IDX);
    await (await px.set(HYPE_IDX, hypeRaw)).wait();
    await (await px.set(NVDA_IDX, nvdaRaw)).wait();
    console.log(`      live: HYPE $${Number(hypeRaw) / 1e4}, NVDA $${Number(nvdaRaw) / 1e3}`);

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EquoHook");
    const initCode = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [POOL_MANAGER, WHYPE])]);
    const hash = ethers.keccak256(initCode);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 20_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
    }
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoHook", hookAddr);
    const oracle = await (await ethers.getContractFactory("LiqioOracle")).deploy(deployer.address);
    await (await oracle.setCore(WHYPE, HYPE_IDX, 2, E18, false)).wait();
    await (await oracle.setFixed(USDC, 10n ** 30n)).wait();
    await (await oracle.setCore(WNVDA, NVDA_IDX, 3, E18, true)).wait();
    const tokenDeployer = await (await ethers.getContractFactory("LiqioTokenDeployer")).deploy(deployer.address);
    const factory = await (await ethers.getContractFactory("LiqioFactory")).deploy(deployer.address, deployer.address, POOL_MANAGER, hookAddr, await tokenDeployer.getAddress(), WHYPE, await oracle.getAddress(), deployer.address);
    const FACTORY = await factory.getAddress();
    const router = await (await ethers.getContractFactory("EquoRouter")).deploy(POOL_MANAGER, FACTORY, WHYPE);
    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    await (await factory.setConverter(await router.getAddress())).wait();
    const whype = new ethers.Contract(WHYPE, erc20, deployer), usdc = new ethers.Contract(USDC, erc20, deployer), wnvda = new ethers.Contract(WNVDA, erc20, deployer);
    return { deployer, creator, trader, hook, hookAddr, oracle, factory, router, whype, usdc, wnvda, hypeRaw, nvdaRaw };
  }

  async function launch(factory: any, creator: any, value: bigint, tag: string, pair = ethers.ZeroAddress, r = "0x") {
    const p = { name: `Fork ${tag}`, symbol: `F${tag}`, metadataURI: "ipfs://x", pair, minPairOut: 0, capPreset: 0, genes: FLAT, stages: [] as any[] };
    const rc = await (await factory.connect(creator).launch(p, ethers.id(`fork-${tag}`), r, "0x", { value })).wait();
    const ev = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    return { token: ev!.args.token as string, pairUsd: ev!.args.pairUsdPrice as bigint, gas: rc!.gasUsed as bigint };
  }

  it("prices HYPE and wNVDAx from the precompile with the token's live share ratio", async () => {
    const { oracle, wnvda, hypeRaw, nvdaRaw } = await stack();
    expect(await oracle.price(WHYPE)).to.equal(hypeRaw * 10n ** 14n);
    const ratio = await wnvda.convertToAssets(E18);
    expect(ratio).to.be.gte(E18);
    expect(ratio).to.be.lt(2n * E18);
    expect(await oracle.price(WNVDA)).to.equal((nvdaRaw * 10n ** 15n * ratio) / E18);
    expect(await usdcDecimals()).to.equal(6n);
    async function usdcDecimals() { return new ethers.Contract(USDC, erc20, ethers.provider).decimals(); }
  });

  it("launches on HYPE against the real PoolManager inside a small block and trades through the router", async () => {
    const { factory, hook, creator, trader, router, whype } = await stack();
    const { token, gas } = await launch(factory, creator, ethers.parseEther("0.5"), "H");
    console.log(`      launch on HYPE with dev buy: ${gas} gas`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    const coin = await ethers.getContractAt("LiqioToken", token);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    expect(await whype.balanceOf(POOL_MANAGER)).to.be.gt(0n);
    const rc = await (await router.connect(trader).buy(token, "0x", 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).wait();
    console.log(`      buy: ${rc!.gasUsed} gas`);
    const got = await coin.balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    const b0 = await ethers.provider.getBalance(trader.address);
    const src = await (await router.connect(trader).sell(token, got, "0x", 0, ethers.ZeroAddress)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + src!.gasUsed * src!.gasPrice).to.be.gt(b0);
    const owed = await hook.creatorOwed(token);
    const c0 = await ethers.provider.getBalance(creator.address);
    await (await hook.connect(trader).payCreator(token)).wait();
    expect((await ethers.provider.getBalance(creator.address)) - c0).to.equal(owed); // real WHYPE unwrapped to HYPE
  });

  it("launches on USDC through the real PRJX WHYPE/USDC pool and sells back to HYPE", async () => {
    const { factory, hook, creator, trader, router, usdc } = await stack();
    const r = route(PRJX_USDC);
    const { token, pairUsd, gas } = await launch(factory, creator, ethers.parseEther("0.5"), "U", USDC, r);
    console.log(`      launch on USDC via PRJX with dev buy: ${gas} gas`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    expect(pairUsd).to.equal(10n ** 30n);
    const coin = await ethers.getContractAt("LiqioToken", token);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    const u0 = await usdc.balanceOf(POOL_MANAGER);
    const rc = await (await router.connect(trader).buy(token, r, 0, ethers.ZeroAddress, { value: ethers.parseEther("1") })).wait();
    console.log(`      routed buy: ${rc!.gasUsed} gas`);
    expect(await usdc.balanceOf(POOL_MANAGER)).to.be.gt(u0);
    const fee = rc!.logs.map((l: any) => { try { return hook.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "FeeTaken")!.args.fee as bigint;
    // 1% of about 1 HYPE in USDC: between $0.3 and $3 whatever HYPE does
    expect(fee).to.be.gt(300_000n);
    expect(fee).to.be.lt(3_000_000n);
    const got = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    const b0 = await ethers.provider.getBalance(trader.address);
    const src = await (await router.connect(trader).sell(token, got, r, 0, ethers.ZeroAddress)).wait();
    expect((await ethers.provider.getBalance(trader.address)) + src!.gasUsed * src!.gasPrice).to.be.gt(b0);
    await (await hook.payCreator(token)).wait();
    expect(await usdc.balanceOf(creator.address)).to.be.gt(0n);
  });

  it("launches on wNVDAx through the real PRJX WHYPE/wNVDAx pool at the share price", async () => {
    const { factory, creator, trader, router, wnvda, oracle } = await stack();
    const r = route(PRJX_NVDA);
    const { token, pairUsd, gas } = await launch(factory, creator, ethers.parseEther("0.5"), "N", WNVDA, r);
    console.log(`      launch on wNVDAx via PRJX with dev buy: ${gas} gas`);
    expect(gas).to.be.lt(SMALL_BLOCK_GAS);
    expect(pairUsd).to.equal(await oracle.price(WNVDA));
    const coin = await ethers.getContractAt("LiqioToken", token);
    expect(await coin.balanceOf(creator.address)).to.be.gt(0n);
    const n0 = await wnvda.balanceOf(POOL_MANAGER);
    await (await router.connect(trader).buy(token, r, 0, ethers.ZeroAddress, { value: ethers.parseEther("0.2") })).wait();
    expect(await wnvda.balanceOf(POOL_MANAGER)).to.be.gt(n0);
    const got = await coin.balanceOf(trader.address);
    await (await coin.connect(trader).approve(await router.getAddress(), got)).wait();
    await (await router.connect(trader).sellForPair(token, got / 2n, 0, ethers.ZeroAddress)).wait();
    expect(await wnvda.balanceOf(trader.address)).to.be.gt(0n);
    await (await router.connect(trader).sell(token, got / 2n, r, 0, ethers.ZeroAddress)).wait();
    expect(await coin.balanceOf(trader.address)).to.equal(0n);
  });
});
