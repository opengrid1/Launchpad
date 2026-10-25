import { expect } from "chai";
import { ethers, network } from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * One coin, one address on every chain.
 *
 * Two "chains" are simulated one after the other on the same local node (snapshot, deploy chain A, revert, deploy
 * chain B), each with its own LayerZero endpoint id and its WETH, PoolManager and hook at different addresses. The
 * token deployer and the creators go through the standard CREATE2 deployer, as in deploy-equo.ts. The same creator
 * launching with the same salt must get the same coin address on both, plain and with holder rewards.
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const CREATE2_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const CREATE2_PROXY_RUNTIME = "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";
const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };
const DIVS = { ...FLAT, divShareBps: 3_000 };

describe("Equo: the same coin address on every chain (local)", function () {
  this.timeout(600_000);

  async function create2(name: string, types: string[], args: any[], label: string) {
    const f = await ethers.getContractFactory(name);
    const init = ethers.concat([f.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(types, args)]);
    const salt = ethers.id(label);
    const [s] = await ethers.getSigners();
    await (await s.sendTransaction({ to: CREATE2_PROXY, data: ethers.concat([salt, init]) })).wait();
    return ethers.getCreate2Address(CREATE2_PROXY, salt, ethers.keccak256(init));
  }

  /// Deploy one chain's Equo set. `shift` burns nonces first so WETH, PoolManager, endpoint and hook land at
  /// different addresses than on the other chain, as they do on real chains.
  async function deployChain(eid: number, shift: number) {
    const [admin] = await ethers.getSigners();
    for (let i = 0; i < shift; i++) await (await admin.sendTransaction({ to: admin.address, value: 0 })).wait();
    for (let i = 0; i < shift; i++) await (await ethers.getContractFactory("WETH9")).deploy();
    let weth = await (await ethers.getContractFactory("WETH9")).deploy();
    // like every real wrapped native, WETH must sit above the coin address ceiling (0x1000…)
    while (BigInt(await weth.getAddress()) < 2n ** 156n) weth = await (await ethers.getContractFactory("WETH9")).deploy();
    const WETH = await weth.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    const PM = await pm.getAddress();
    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EquoHook");
    const initCode = ethers.concat([Hook.bytecode, ethers.AbiCoder.defaultAbiCoder().encode(["address", "address"], [PM, WETH])]);
    const hash = ethers.keccak256(initCode);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
    }
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoHook", hookAddr);
    const endpoint = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(eid);

    // the same constructor arguments on every chain; the chain's endpoint comes after
    const TD = await create2("EquoTokenDeployer", ["address", "address"], [admin.address, admin.address], "equo.tokenDeployer.v1");
    const tokenDeployer = await ethers.getContractAt("EquoTokenDeployer", TD);
    await (await tokenDeployer.setEndpoint(await endpoint.getAddress())).wait();
    const plain = await create2("EquoTokenCreator", ["address"], [TD], "equo.tokenCreator.v1");
    const div = await create2("EquoDivTokenCreator", ["address"], [TD], "equo.divTokenCreator.v1");
    await (await tokenDeployer.setCreators(plain, div)).wait();

    const oracle = await (await ethers.getContractFactory("MockOneOracle")).deploy();
    await (await oracle.set(WETH, 3000n * 10n ** 18n)).wait();
    const rules = await (await ethers.getContractFactory("EquoLaunchRules")).deploy();
    const factory = await (await ethers.getContractFactory("EquoFactory", { libraries: { EquoLaunchRules: await rules.getAddress() } })).deploy(
      admin.address, admin.address, PM, hookAddr, TD, WETH, await oracle.getAddress(), admin.address, ethers.parseEther("0.001"),
    );
    const FACTORY = await factory.getAddress();
    const router = await (await ethers.getContractFactory("EquoRouter")).deploy(PM, FACTORY, WETH);
    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    await (await factory.setConverter(await router.getAddress())).wait();
    return { factory, tokenDeployer, TD, plain, div, WETH, PM, hookAddr, endpoint: await endpoint.getAddress() };
  }

  async function launch(chain: any, genes: any, salt: string) {
    const [, creator] = await ethers.getSigners();
    const p = { name: "Same Everywhere", symbol: "SAME", metadataURI: "", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [] as any[], split: 1 };
    const rc = await (await chain.factory.connect(creator).launch(p, ethers.id(salt), "0x", "0x", { value: ethers.parseEther("0.001") })).wait();
    const ev = rc!.logs.map((l: any) => { try { return chain.factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    return ev!.args.token as string;
  }

  it("gives a coin one address on two chains with different endpoints, WETH, PoolManagers and hooks", async () => {
    await network.provider.send("hardhat_setCode", [CREATE2_PROXY, CREATE2_PROXY_RUNTIME]);
    const snap = await network.provider.send("evm_snapshot", []);

    const a = await deployChain(30101, 0);
    const plainA = await launch(a, FLAT, "plain-1"), divA = await launch(a, DIVS, "divs-1");
    await network.provider.send("evm_revert", [snap]);

    const b = await deployChain(30184, 3);
    const plainB = await launch(b, FLAT, "plain-1"), divB = await launch(b, DIVS, "divs-1");

    // the chains really differ
    expect(a.endpoint).to.not.equal(b.endpoint);
    expect(a.WETH).to.not.equal(b.WETH);
    expect(a.PM).to.not.equal(b.PM);
    expect(a.hookAddr).to.not.equal(b.hookAddr);
    // the token deployer and creators do not
    expect(a.TD).to.equal(b.TD);
    expect(a.plain).to.equal(b.plain);
    expect(a.div).to.equal(b.div);
    // and so neither does the coin
    expect(plainA).to.equal(plainB);
    expect(divA).to.equal(divB);
    expect(plainA).to.not.equal(divA);
    // below the ceiling, so currency0 against any wrapped native
    for (const c of [plainA, divA]) expect(BigInt(c) < BigInt("0x1000000000000000000000000000000000000000")).to.equal(true);
    expect(BigInt(plainB) < BigInt(b.WETH)).to.equal(true);
    // and it is a live coin on chain B with its pool
    expect((await b.factory.listings(plainB)).createdAt).to.be.gt(0n);
    expect((await b.factory.positionOf(plainB)).liquidity).to.be.gt(0n);
    console.log(`      coin ${plainA} on both chains (endpoints ${a.endpoint.slice(0, 8)}… / ${b.endpoint.slice(0, 8)}…)`);
  });

  it("sets the chain's endpoint once, and only the setup account or admin can", async () => {
    await network.provider.send("hardhat_setCode", [CREATE2_PROXY, CREATE2_PROXY_RUNTIME]);
    const [admin, , outsider] = await ethers.getSigners();
    const td = await (await ethers.getContractFactory("EquoTokenDeployer")).deploy(admin.address, admin.address);
    await expect(td.connect(outsider).setEndpoint(admin.address)).to.be.revertedWithCustomError(td, "NotAdmin");
    await (await td.setEndpoint(outsider.address)).wait();
    await expect(td.setEndpoint(admin.address)).to.be.revertedWithCustomError(td, "AlreadySet");
    expect(await td.ADDRESS_CEILING()).to.equal("0x1000000000000000000000000000000000000000");
  });
});
