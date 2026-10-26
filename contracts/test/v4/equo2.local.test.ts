import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Equo v2 across three chains on one local network (Ethereum, BNB Chain and HyperEVM eids), each with its own
 * PoolManager, LayerZero endpoint mock, coin deployer, fee hook, factory and router.
 *
 * What this proves:
 *   - one signed snapshot launches a coin on every chain, 1B on each; each chain's coin has its own address ending in e9;
 *   - every leg opens at the same USD price whatever its pair costs, never cheaper than the snapshot;
 *   - peers are wired at birth and sealed; bridging burns, mints, keeps the total and takes 0.2%;
 *   - the fee is fixed per coin and splits max(20% of the fee, 0.2% of volume) to the platform, the rest to the
 *     creator; the creator's launch buy pays none;
 *   - only the factory opens pools on the hook or adds liquidity; sells stop at the opening price;
 *   - snapshots expire, launch once, need the signer, and need slices adding up to the 1B.
 */

const HOOK_FLAGS = (1n << 13n) | (1n << 11n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const CHAIN_SUPPLY = 1_000_000_000n * 10n ** 9n; // 1B on every chain
const CEILING = 1n << 156n;
const coder = ethers.AbiCoder.defaultAbiCoder();
const pad = (a: string) => ethers.zeroPadValue(a, 32);

// three chains, ascending eids, and their pair prices (USD per whole native coin)
const CHAINS = [
  { eid: 30101, usd: 3000n }, // Ethereum
  { eid: 30102, usd: 700n }, // BNB Chain
  { eid: 30367, usd: 40n }, // HyperEVM
];

const TYPES = {
  Snapshot: [
    { name: "launchId", type: "bytes32" },
    { name: "creator", type: "address" },
    { name: "name", type: "string" },
    { name: "symbol", type: "string" },
    { name: "metadataURI", type: "string" },
    { name: "feeBps", type: "uint16" },
    { name: "deadline", type: "uint64" },
    { name: "legs", type: "Leg[]" },
  ],
  Leg: [
    { name: "eid", type: "uint32" },
    { name: "coin", type: "bytes32" },
    { name: "legSalt", type: "bytes32" },
    { name: "slice", type: "uint256" },
    { name: "quoteUsd18", type: "uint256" },
  ],
};
const DOMAIN = { name: "Equo", version: "2" };

function ulnConfig(eid: number, dvns: number) {
  const required = Array.from({ length: dvns }, (_, i) => ethers.getAddress(ethers.toBeHex(0x1000 + i, 20)));
  const uln = coder.encode(["tuple(uint64,uint8,uint8,uint8,address[],address[])"], [[15, dvns, 0, 0, required, []]]);
  return coder.encode(["tuple(uint32,uint32,bytes)[]"], [[[eid, 2, uln]]]);
}

describe("Equo v2: one signed launch on three chains (local)", function () {
  this.timeout(900_000);

  async function deployChain(eid: number, signer: string) {
    const [admin, , , feeWallet] = await ethers.getSigners();
    let weth = await (await ethers.getContractFactory("WETH9")).deploy();
    while (BigInt(await weth.getAddress()) < CEILING) weth = await (await ethers.getContractFactory("WETH9")).deploy();
    const WETH = await weth.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    const PM = await pm.getAddress();

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EquoFeeHook");
    const initCode = ethers.concat([Hook.bytecode, coder.encode(["address", "address"], [PM, WETH])]);
    const hash = ethers.keccak256(initCode);
    let salt = "", hookAddr = "";
    for (let i = 0n; i < 4_000_000n; i++) {
      const s = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const a = ethers.getCreate2Address(c2Addr, s, hash);
      if ((BigInt(a) & FLAG_MASK) === HOOK_FLAGS) { salt = s; hookAddr = a; break; }
    }
    await (await c2.deploy(salt, initCode)).wait();
    const hook = await ethers.getContractAt("EquoFeeHook", hookAddr);

    const endpoint = await (await ethers.getContractFactory("EndpointV2Mock")).deploy(eid);
    const deployer = await (await ethers.getContractFactory("EquoCoinDeployer")).deploy(admin.address, admin.address);
    const DEP = await deployer.getAddress();
    await (await deployer.setEndpoint(await endpoint.getAddress())).wait();
    const creatorC = await (await ethers.getContractFactory("EquoCoinCreator")).deploy(DEP);
    await (await deployer.setCreatorContract(await creatorC.getAddress())).wait();
    for (const o of CHAINS) {
      if (o.eid === eid) continue;
      const lib = ethers.getAddress(ethers.toBeHex(0x51b, 20));
      await (await deployer.setRoute(o.eid, { sendLib: lib, receiveLib: lib, sendConfig: ulnConfig(o.eid, 2), receiveConfig: ulnConfig(o.eid, 2), receiveGas: 100_000, composeGas: 0 })).wait();
    }
    const factory = await (await ethers.getContractFactory("EquoLaunchFactory")).deploy(
      admin.address, PM, hookAddr, DEP, WETH, eid, signer, feeWallet.address, ethers.parseEther("1"), ethers.parseEther("1000000"),
    );
    const FACTORY = await factory.getAddress();
    await (await deployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    const router = await (await ethers.getContractFactory("EquoSwapRouter")).deploy(PM, FACTORY, WETH);
    return { eid, WETH, weth, pm, endpoint, deployer, creatorC, hook, factory, router };
  }

  async function deployAll() {
    const [admin, creator, trader, feeWallet, launcher, outsider] = await ethers.getSigners();
    const signer = ethers.Wallet.createRandom();
    const chains: any[] = [];
    for (const c of CHAINS) chains.push(await deployChain(c.eid, signer.address));
    for (const c of chains) await (await c.factory.setLauncher(launcher.address, true)).wait();
    return { admin, creator, trader, feeWallet, launcher, outsider, signer, chains };
  }

  /** Mine each leg's salt so its coin address ends in e9 below the ceiling, the way the launch service does. */
  async function buildSnapshot(env: any, opts: { tag: string; feeBps?: number; slices?: bigint[]; deadline?: number; creator?: string }) {
    const launchId = ethers.id(`launch-${opts.tag}`);
    const creator = opts.creator ?? env.creator.address;
    const slices = opts.slices ?? [CHAIN_SUPPLY, CHAIN_SUPPLY, CHAIN_SUPPLY];
    const legs = [];
    for (let i = 0; i < env.chains.length; i++) {
      const c = env.chains[i];
      const cc = c.creatorC.target as string, h = await c.creatorC.initCodeHash();
      let legSalt = "", coin = "";
      for (let n = 0; ; n++) {
        legSalt = ethers.zeroPadValue(ethers.toBeHex(n), 32);
        const s = ethers.keccak256(coder.encode(["bytes32", "address", "bytes32"], [launchId, creator, legSalt]));
        coin = ethers.getCreate2Address(cc, s, h);
        if (BigInt(coin) < CEILING && (BigInt(coin) & 0xffn) === 0xe9n) break;
      }
      legs.push({ eid: c.eid, coin: pad(coin), legSalt, slice: slices[i], quoteUsd18: CHAINS[i].usd * 10n ** 18n });
    }
    const deadline = opts.deadline ?? (await time.latest()) + 1800;
    const snap = { launchId, creator, name: `Equo ${opts.tag}`, symbol: `E${opts.tag}`, metadataURI: "ipfs://equo", feeBps: opts.feeBps ?? 100, deadline, legs };
    const sig = await env.signer.signTypedData(DOMAIN, TYPES, snap);
    return { snap, sig };
  }

  async function launchAll(env: any, tag: string, feeBps = 100, devBuy = ethers.parseEther("0.1")) {
    const { snap, sig } = await buildSnapshot(env, { tag, feeBps });
    // the mock endpoints deliver straight to the coin on the other "chain"
    const addrs = snap.legs.map((l: any) => ethers.getAddress("0x" + l.coin.slice(26)));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) await (await env.chains[i].endpoint.setDestLzEndpoint(addrs[j], await env.chains[j].endpoint.getAddress())).wait();
    for (let i = 0; i < 3; i++) {
      const f = env.chains[i].factory;
      const who = i === 0 ? env.creator : env.launcher;
      await (await f.connect(who).launch(snap, sig, { value: i === 0 ? devBuy : 0n })).wait();
    }
    const coins = addrs.map((a: string) => ethers.getContractAt("EquoCoin", a));
    return { snap, sig, addrs, coins: await Promise.all(coins) };
  }

  async function bridge(coin: any, from: any, dstEid: number, to: string, amount: bigint) {
    const sp = { dstEid, to: pad(to), amountLD: amount, minAmountLD: 0n, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const q = await coin.quoteSend(sp, false);
    return (await coin.connect(from).send(sp, { nativeFee: q.nativeFee, lzTokenFee: q.lzTokenFee }, from.address, { value: q.nativeFee })).wait();
  }

  /** USD price of one whole coin in a chain's pool. */
  async function usdPrice(c: any, coin: string, usd: bigint) {
    const key = await c.factory.poolKeyOf(coin);
    const id = ethers.keccak256(coder.encode(["address", "address", "uint24", "int24", "address"], [key[0], key[1], key[2], key[3], key[4]]));
    const slot = ethers.keccak256(coder.encode(["bytes32", "uint256"], [id, 6n]));
    const raw = BigInt(await ethers.provider.getStorage(await c.pm.getAddress(), slot));
    const sqrtP = Number(raw & ((1n << 160n) - 1n)) / 2 ** 96;
    // pair wei per coin unit -> USD per whole coin (9 decimals)
    return sqrtP * sqrtP * 1e9 / 1e18 * Number(usd);
  }

  it("launches one coin on three chains from one signature, 1B each, each with its own e9 address", async () => {
    const env = await deployAll();
    const { addrs, coins, snap } = await launchAll(env, "A");
    expect(new Set(addrs.map((a: string) => a.toLowerCase())).size).to.equal(3);
    let total = 0n;
    for (let i = 0; i < 3; i++) {
      expect(addrs[i].toLowerCase().endsWith("e9")).to.equal(true);
      const coin = coins[i];
      expect(await coin.decimals()).to.equal(9);
      expect(await coin.totalSupply()).to.equal(snap.legs[i].slice);
      expect(await coin.owner()).to.equal(ethers.ZeroAddress);
      expect(await coin.creator()).to.equal(env.creator.address);
      expect(await coin.metadataAuthority()).to.equal(env.creator.address);
      for (let j = 0; j < 3; j++) if (j !== i) expect(await coin.peers(CHAINS[j].eid)).to.equal(pad(addrs[j]));
      expect(await coin.launchTotal()).to.equal(3n * CHAIN_SUPPLY);
      total += await coin.totalSupply();
      expect((await env.chains[i].factory.listings(addrs[i])).creator).to.equal(env.creator.address);
    }
    expect(total).to.equal(3n * CHAIN_SUPPLY);
  });

  it("opens every chain at the same USD price, never cheaper than the snapshot and within 0.6%", async () => {
    const env = await deployAll();
    const { addrs } = await launchAll(env, "B", 100, 0n);
    const target = 3000 / 1e9;
    for (let i = 0; i < 3; i++) {
      const p = await usdPrice(env.chains[i], addrs[i], CHAINS[i].usd);
      expect(p).to.be.gte(target * 0.999999);
      expect(p).to.be.lte(target * 1.0061);
    }
  });

  it("the creator's launch buy pays no fee and lands with the creator", async () => {
    const env = await deployAll();
    const { addrs, coins } = await launchAll(env, "C", 100, ethers.parseEther("0.5"));
    expect(await coins[0].balanceOf(env.creator.address)).to.be.gt(0n);
    expect(await env.chains[0].hook.feesTotal(addrs[0])).to.equal(0n);
  });

  for (const [feeBps, label] of [[100, "1%"], [30, "0.3%"], [500, "5%"]] as const) {
    it(`splits a ${label} fee: platform max(20% of fee, 0.2% of volume), creator the rest`, async () => {
      const env = await deployAll();
      const { addrs } = await launchAll(env, `F${feeBps}`, feeBps, 0n);
      const c = env.chains[0];
      const amount = ethers.parseEther("1");
      await (await c.router.connect(env.trader).buy(addrs[0], "0x", 0n, { value: amount })).wait();
      const fee = (amount * BigInt(feeBps)) / 10_000n;
      let platform = (fee * 2_000n) / 10_000n;
      const byVol = (amount * 20n) / 10_000n;
      if (byVol > platform) platform = byVol;
      if (platform > fee) platform = fee;
      expect(await c.hook.platformOwed(addrs[0])).to.equal(platform);
      expect(await c.hook.creatorOwed(addrs[0])).to.equal(fee - platform);
      // payouts: anyone, in native coin
      const before = await ethers.provider.getBalance(env.creator.address);
      await (await c.hook.connect(env.outsider).payCreator(addrs[0])).wait();
      expect((await ethers.provider.getBalance(env.creator.address)) - before).to.equal(fee - platform);
      const pb = await ethers.provider.getBalance(env.feeWallet.address);
      await (await c.hook.connect(env.outsider).payPlatform([addrs[0]])).wait();
      expect((await ethers.provider.getBalance(env.feeWallet.address)) - pb).to.equal(platform);
    });
  }

  it("buys and sells through the router; a sell stops at the opening price and returns the rest", async () => {
    const env = await deployAll();
    const { addrs, coins } = await launchAll(env, "S", 100, 0n);
    const c = env.chains[0];
    await (await c.router.connect(env.trader).buy(addrs[0], "0x", 0n, { value: ethers.parseEther("0.2") })).wait();
    const got = await coins[0].balanceOf(env.trader.address);
    expect(got).to.be.gt(0n);
    // a plain sell of half
    await (await coins[0].connect(env.trader).approve(await c.router.getAddress(), got)).wait();
    const ethBefore = await ethers.provider.getBalance(env.trader.address);
    await (await c.router.connect(env.trader).sell(addrs[0], got / 2n, "0x", 0n)).wait();
    expect(await ethers.provider.getBalance(env.trader.address)).to.be.gt(ethBefore);
    expect(await coins[0].balanceOf(env.trader.address)).to.equal(got - got / 2n);
    // coins from outside the pool's trading (the admin's collect) are more than the pool can take back above its
    // opening price: the sell fills down to that price and returns the rest
    await (await c.factory.connect(env.admin).collect(addrs[0], 1000, env.admin.address)).wait();
    const extra = await coins[0].balanceOf(env.admin.address);
    await (await coins[0].connect(env.trader).transfer(env.admin.address, got - got / 2n)).wait();
    const all = extra + (got - got / 2n);
    await (await coins[0].connect(env.admin).approve(await c.router.getAddress(), all)).wait();
    await (await c.router.connect(env.admin).sell(addrs[0], all, "0x", 0n)).wait();
    const left = await coins[0].balanceOf(env.admin.address);
    expect(left).to.be.gt(0n);
    expect(left).to.be.lt(all);
    // and a direct swap that would go below the opening price is refused by the hook
    await expect(c.router.connect(env.admin).sell(addrs[0], left, "0x", 1n)).to.be.reverted;
  });

  it("bridges between chains: burns out, mints in, keeps the total, takes 0.2%", async () => {
    const env = await deployAll();
    const { addrs, coins } = await launchAll(env, "X", 100, ethers.parseEther("0.5"));
    const held = await coins[0].balanceOf(env.creator.address);
    const amount = (held / 2n / 10n ** 3n) * 10n ** 3n; // OFT shared decimals: dust below 1e3 units
    const before = await coins[2].balanceOf(env.trader.address);
    await bridge(coins[0], env.creator, CHAINS[2].eid, env.trader.address, amount);
    // 0.2% stays behind; what arrives is rounded down to LayerZero's 6 shared decimals (the rest is fee too)
    const arrives = ((amount - (amount * 20n) / 10_000n) / 10n ** 3n) * 10n ** 3n;
    const fee = amount - arrives;
    expect((await coins[2].balanceOf(env.trader.address)) - before).to.equal(arrives);
    expect(await coins[0].balanceOf(env.feeWallet.address)).to.equal(fee);
    let local = 0n;
    for (const c of coins) local += await c.localSupply();
    expect(local).to.equal(3n * CHAIN_SUPPLY); // every chain's coins together: nothing created or lost
    expect(await coins[0].totalSupply()).to.equal((await env.chains[0].factory.listings(addrs[0]))[5]);
  });

  it("peers and options are sealed: nobody can rewire a coin", async () => {
    const env = await deployAll();
    const { coins } = await launchAll(env, "P", 100, 0n);
    await expect(coins[0].connect(env.admin).setPeer(999, pad(env.outsider.address))).to.be.reverted;
  });

  it("only the factory opens pools on the hook or adds liquidity", async () => {
    const env = await deployAll();
    const { addrs } = await launchAll(env, "G", 100, 0n);
    const c = env.chains[0];
    const key = await c.factory.poolKeyOf(addrs[0]);
    // a second pool with the same hook, opened by someone else, is refused
    const fake = { currency0: addrs[0], currency1: c.WETH, fee: 3000, tickSpacing: 60, hooks: key[4] };
    await expect(c.pm.connect(env.outsider).initialize(fake, 2n ** 96n)).to.be.reverted;
  });

  it("refuses a bad snapshot: wrong signer, expired, reused, a leg that is not 1B, outsider caller", async () => {
    const env = await deployAll();
    const f = env.chains[0].factory;
    // wrong signer
    const a = await buildSnapshot(env, { tag: "W1" });
    const bad = await ethers.Wallet.createRandom().signTypedData(DOMAIN, TYPES, a.snap);
    await expect(f.connect(env.creator).launch(a.snap, bad)).to.be.revertedWithCustomError(f, "BadSignature");
    // outsider may not launch for the creator
    await expect(f.connect(env.outsider).launch(a.snap, a.sig)).to.be.revertedWithCustomError(f, "NotAllowed");
    // every leg is 1B
    const b = await buildSnapshot(env, { tag: "W2", slices: [CHAIN_SUPPLY, CHAIN_SUPPLY / 2n, CHAIN_SUPPLY] });
    await expect(f.connect(env.creator).launch(b.snap, b.sig)).to.be.revertedWithCustomError(f, "BadSnapshot");
    // more than an hour ahead, or past its deadline
    const c = await buildSnapshot(env, { tag: "W3", deadline: (await time.latest()) + 7200 });
    await expect(f.connect(env.creator).launch(c.snap, c.sig)).to.be.revertedWithCustomError(f, "Expired");
    const d = await buildSnapshot(env, { tag: "W4" });
    await time.increase(3600);
    await expect(f.connect(env.creator).launch(d.snap, d.sig)).to.be.revertedWithCustomError(f, "Expired");
    // launches once
    const e = await buildSnapshot(env, { tag: "W5" });
    await (await f.connect(env.creator).launch(e.snap, e.sig)).wait();
    await expect(f.connect(env.creator).launch(e.snap, e.sig)).to.be.revertedWithCustomError(f, "AlreadyLaunched");
  });

  it("anyone can submit a launch the creator signed", async () => {
    const env = await deployAll();
    const { snap, sig } = await buildSnapshot(env, { tag: "CS" });
    const creatorSig = await env.creator.signTypedData(DOMAIN, TYPES, snap);
    const f = env.chains[0].factory;
    await (await f.connect(env.outsider).launchSigned(snap, sig, creatorSig)).wait();
    expect((await f.listings(ethers.getAddress("0x" + snap.legs[0].coin.slice(26)))).creator).to.equal(env.creator.address);
  });

  it("routes must name at least two DVNs and both libraries", async () => {
    const env = await deployAll();
    const d = env.chains[0].deployer;
    const lib = ethers.getAddress(ethers.toBeHex(0x51b, 20));
    await expect(d.setRoute(40000, { sendLib: lib, receiveLib: lib, sendConfig: ulnConfig(40000, 1), receiveConfig: ulnConfig(40000, 2), receiveGas: 100_000, composeGas: 0 }))
      .to.be.revertedWithCustomError(d, "BadRoute");
    await expect(d.setRoute(40000, { sendLib: ethers.ZeroAddress, receiveLib: lib, sendConfig: ulnConfig(40000, 2), receiveConfig: ulnConfig(40000, 2), receiveGas: 100_000, composeGas: 0 }))
      .to.be.revertedWithCustomError(d, "BadRoute");
  });

  it("the admin's collect pulls a share of a launch position; the creator's metadata pen moves in two steps", async () => {
    const env = await deployAll();
    const { addrs, coins } = await launchAll(env, "K", 100, ethers.parseEther("0.2"));
    const f = env.chains[0].factory;
    await expect(f.connect(env.outsider).collect(addrs[0], 5000, env.outsider.address)).to.be.revertedWithCustomError(f, "NotAdmin");
    const before = await coins[0].balanceOf(env.admin.address);
    await (await f.connect(env.admin).collect(addrs[0], 5000, env.admin.address)).wait();
    expect(await coins[0].balanceOf(env.admin.address)).to.be.gt(before);
    await expect(coins[0].connect(env.outsider).setMetadataURI("x")).to.be.revertedWithCustomError(coins[0], "NotMetadataAuthority");
    await (await coins[0].connect(env.creator).offerMetadataAuthority(env.trader.address)).wait();
    await (await coins[0].connect(env.trader).acceptMetadataAuthority()).wait();
    await (await coins[0].connect(env.trader).setMetadataURI("ipfs://new")).wait();
    expect(await coins[0].metadataURI()).to.equal("ipfs://new");
  });
});
