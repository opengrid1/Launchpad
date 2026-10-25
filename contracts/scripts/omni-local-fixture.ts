import { ethers, network } from "hardhat";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Builds three Equo "chains" on one local node (each with its own WETH, PoolManager, hook, factory, price book
 * and LayerZero endpoint mock), launches coins across them, trades and bridges, then writes what it did to
 * OUT (JSON): the chain configs for the indexer and the expected results read back from the contracts.
 *
 *   npx hardhat node &
 *   OUT=/tmp/omni.json npx hardhat run scripts/omni-local-fixture.ts --network localhost
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ETH_USD_18 = 3000n * 10n ** 18n;
const CHAINS = [{ key: "eth", eid: 30101 }, { key: "hyper", eid: 30367 }, { key: "bsc", eid: 30102 }];
const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };
const coder = ethers.AbiCoder.defaultAbiCoder();
const pad = (a: string) => ethers.zeroPadValue(a, 32);

async function step(secs = 300) {
  await network.provider.send("evm_increaseTime", [secs]);
  await network.provider.send("evm_mine", []);
}

async function deployChain(key: string, eid: number) {
  const [admin, , , feeWallet, launcher] = await ethers.getSigners();
  const startBlock = await ethers.provider.getBlockNumber();
  let weth = await (await ethers.getContractFactory("WETH9")).deploy();
    // like every real wrapped native, WETH must sit above the coin address ceiling (0x1000…)
    while (BigInt(await weth.getAddress()) < 2n ** 156n) weth = await (await ethers.getContractFactory("WETH9")).deploy();
  const WETH = await weth.getAddress();
  const art = JSON.parse(readFileSync(join(__dirname, "../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
  const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
  const POOL_MANAGER = await pm.getAddress();
  const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("EquoHook");
  const initCode = ethers.concat([Hook.bytecode, coder.encode(["address", "address"], [POOL_MANAGER, WETH])]);
  const hash = ethers.keccak256(initCode);
  let salt = "", hookAddr = "";
  let ping = Date.now();
  for (let i = 0n; i < 4_000_000n; i++) {
    // the node drops idle connections after a few seconds; keep this one busy while mining
    if (Date.now() - ping > 2000) { await ethers.provider.getBlockNumber(); ping = Date.now(); }
    const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const a = ethers.getCreate2Address(c2Addr, s, hash);
    if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
  }
  await (await c2.deploy(salt, initCode)).wait();
  const hook = await ethers.getContractAt("EquoHook", hookAddr);
  const endpoint = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(eid);
  const tokenDeployer = await (await ethers.getContractFactory("EquoTokenDeployer")).deploy(admin.address, admin.address);
    await (await tokenDeployer.setEndpoint(await endpoint.getAddress())).wait();
  const TD = await tokenDeployer.getAddress();
  const plain = await (await ethers.getContractFactory("EquoTokenCreator")).deploy(TD);
  const div = await (await ethers.getContractFactory("EquoDivTokenCreator")).deploy(TD);
  await (await tokenDeployer.setCreators(await plain.getAddress(), await div.getAddress())).wait();
  const book = await (await ethers.getContractFactory("EquoPriceBook")).deploy(admin.address);
  await (await book.setPrices([WETH], [ETH_USD_18])).wait();
  await (await book.setMaxAge(86400)).wait();
  const rules = await (await ethers.getContractFactory("EquoLaunchRules")).deploy();
  const factory = await (await ethers.getContractFactory("EquoFactory", { libraries: { EquoLaunchRules: await rules.getAddress() } })).deploy(admin.address, admin.address, POOL_MANAGER, hookAddr, TD, WETH, await book.getAddress(), feeWallet.address, ethers.parseEther("0.001"));
  const FACTORY = await factory.getAddress();
  const router = await (await ethers.getContractFactory("EquoRouter")).deploy(POOL_MANAGER, FACTORY, WETH);
  await (await tokenDeployer.setFactory(FACTORY)).wait();
  await (await hook.setFactory(FACTORY)).wait();
  await (await factory.setConverter(await router.getAddress())).wait();
  await (await factory.setLauncher(launcher.address, true)).wait();
  return { key, eid, WETH, endpoint, tokenDeployer, factory, router, hook, POOL_MANAGER, TD, startBlock };
}

async function main() {
  const out = process.env.OUT;
  if (!out) throw new Error("set OUT to the JSON file to write");
  const [, creator, trader, , launcher, trader2] = await ethers.getSigners();
  const chains = [];
  for (const c of CHAINS) chains.push(await deployChain(c.key, c.eid));

  /** launch one coin on the given chain indexes; the first is paid by the creator with a first buy */
  async function launchOn(idx: number[], tag: string, genes: any) {
    const salt = ethers.id("fixture-" + tag), divs = genes.divShareBps !== 0;
    const bound = ethers.keccak256(coder.encode(["address", "bytes32"], [creator.address, salt]));
    const addrs: string[] = [];
    for (const i of idx) addrs.push((await chains[i].tokenDeployer.predict(bound, chains[i].WETH, divs))[0]);
    for (const a of idx) for (const b of idx) if (a !== b) await (await chains[a].endpoint.setDestLzEndpoint(addrs[idx.indexOf(b)], await chains[b].endpoint.getAddress())).wait();
    const p = { name: "Fixture " + tag, symbol: "FX" + tag, metadataURI: "", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [] as any[], split: 1 };
    for (let n = 0; n < idx.length; n++) {
      const i = idx[n], others = idx.filter((x) => x !== i);
      const peers = coder.encode(["uint32[]", "bytes32[]"], [others.map((x) => chains[x].eid), others.map((x) => pad(addrs[idx.indexOf(x)]))]);
      if (n === 0) await (await chains[i].factory.connect(creator).launch(p, salt, "0x", peers, { value: ethers.parseEther("1") })).wait();
      else await (await chains[i].factory.connect(launcher).launchFor(creator.address, p, salt, "0x", peers, { value: ethers.parseEther("0.001") })).wait();
    }
    return Object.fromEntries(idx.map((i, n) => [chains[i].key, addrs[n]]));
  }
  const coin = (k: string, a: string, divs = false) => ethers.getContractAt(divs ? "EquoDivToken" : "EquoToken", a);
  const at = (k: string) => chains.find((c) => c.key === k)!;
  async function bridge(tok: any, from: any, dstEid: number, to: string, amount: bigint) {
    const sp = { dstEid, to: pad(to), amountLD: amount, minAmountLD: 0n, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const qf = await tok.quoteSend(sp, false);
    await (await tok.connect(from).send(sp, { nativeFee: qf.nativeFee, lzTokenFee: qf.lzTokenFee }, from.address, { value: qf.nativeFee })).wait();
  }

  const A = await launchOn([0, 1, 2], "A", FLAT);
  await step();
  const B = await launchOn([0, 2], "B", { ...FLAT, divShareBps: 3_000 });
  await step();

  // trades: 1 ETH dev buys already happened on eth for A and B
  await (await at("hyper").router.connect(trader).buy(A.hyper, "0x", 0, { value: ethers.parseEther("0.5") })).wait();
  await step();
  const aHyper = await coin("hyper", A.hyper);
  const half = (await aHyper.balanceOf(trader.address)) / 2n;
  await (await aHyper.connect(trader).approve(await at("hyper").router.getAddress(), half)).wait();
  await (await at("hyper").router.connect(trader).sell(A.hyper, half, "0x", 0)).wait();
  await step();
  await (await at("bsc").router.connect(trader2).buy(A.bsc, "0x", 0, { value: ethers.parseEther("0.2") })).wait();
  await step();
  const aEth = await coin("eth", A.eth);
  const sellAmt = (await aEth.balanceOf(creator.address)) / 5n;
  await (await aEth.connect(creator).approve(await at("eth").router.getAddress(), sellAmt)).wait();
  await (await at("eth").router.connect(creator).sell(A.eth, sellAmt, "0x", 0)).wait();
  await step();
  await (await at("bsc").router.connect(trader).buy(B.bsc, "0x", 0, { value: ethers.parseEther("0.3") })).wait();
  await step();

  // bridges: creator eth -> hyper (to trader), trader hyper -> bsc
  await bridge(aEth, creator, at("hyper").eid, trader.address, (await aEth.balanceOf(creator.address)) / 4n);
  await step(60);
  await bridge(aHyper, trader, at("bsc").eid, trader.address, (await aHyper.balanceOf(trader.address)) / 3n);
  await step(60);

  // what the indexer should find
  const wallets = [creator.address, trader.address, trader2.address].map((a) => a.toLowerCase());
  const expect: any = { coins: {} };
  for (const [tag, m, divs] of [["A", A, false], ["B", B, true]] as const) {
    const e: any = { chains: {}, balances: {} };
    for (const [k, a] of Object.entries(m)) {
      const t = await coin(k, a as string, divs);
      e.chains[k] = { token: (a as string).toLowerCase(), supply: (await t.totalSupply()).toString() };
      for (const w of wallets) { const b = await t.balanceOf(w); if (b > 0n) e.balances[w] = ((BigInt(e.balances[w] || 0) + b)).toString(); }
    }
    expect.coins[tag] = e;
  }
  expect.coins.A.trades = { eth: 2, hyper: 2, bsc: 1 };
  expect.coins.B.trades = { eth: 1, bsc: 1 };
  expect.coins.A.bridges = 4; // two sends, two receipts
  expect.coins.B.bridges = 0;

  const rpc = "http://127.0.0.1:8545";
  const cfg = chains.map((c) => ({ key: c.key, name: c.key, chainId: 31337, lzEid: c.eid, native: "ETH", rpcs: [rpc], maxRange: 50, confirmations: 0, pollMs: 500,
    poolManager: c.POOL_MANAGER, wrappedNative: c.WETH, factory: c.factory.target, hook: c.hook.target, tokenDeployer: c.TD, router: c.router.target, startBlock: c.startBlock }));
  writeFileSync(out, JSON.stringify({ chains: cfg, expect }, null, 2));
  console.log("fixture written to", out);
}

main().catch((e) => { console.error(e); process.exit(1); });
