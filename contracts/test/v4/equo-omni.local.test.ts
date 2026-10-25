import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Equo across chains: three full Equo stacks on one local network, each with its own LayerZero endpoint mock
 * (Ethereum, HyperEVM and BNB Chain eids), its own PoolManager, hook, factory and price book.
 *
 * What this proves:
 *   - every chain's coin address is known before launch, and each chain gets a different one;
 *   - a coin launched on each chain (paid on one, `launchFor` on the others) is wired to its peers at birth;
 *   - bridging burns on the way out, mints on the way in, keeps the total supply, and takes 0.2% for the platform;
 *   - bridged coins trade in the destination chain's pool;
 *   - peers are sealed: nobody can change one, and the admin can only add a chain the coin has no peer on;
 *   - the price book only opens a launch at a fresh price.
 */

const HOOK_FLAGS = (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const ETH_USD_18 = 3000n * 10n ** 18n;
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const EIDS = [30101, 30367, 30102];

const FLAT = { feeMode: 0, feeBps: 100, snipeBps: 0, snipeBlocks: 0, buybackShareBps: 0, divShareBps: 0, maxWalletBps: 0, maxWalletSecs: 0, buybackThreshold: 0n };
const DIVS = { ...FLAT, divShareBps: 3_000 };

const pad = (a: string) => ethers.zeroPadValue(a, 32);
const coder = ethers.AbiCoder.defaultAbiCoder();

describe("Equo omnichain: one coin on three chains (local)", function () {
  this.timeout(900_000);

  async function deployChain(eid: number) {
    const [admin, , , feeWallet] = await ethers.getSigners();
    let weth = await (await ethers.getContractFactory("WETH9")).deploy();
    // like every real wrapped native, WETH must sit above the coin address ceiling (0x1000…)
    while (BigInt(await weth.getAddress()) < 2n ** 156n) weth = await (await ethers.getContractFactory("WETH9")).deploy();
    const WETH = await weth.getAddress();
    const art = JSON.parse(readFileSync(join(__dirname, "../../../node_modules/@uniswap/v4-core/out/PoolManager.sol/PoolManager.json"), "utf8"));
    const pm = await new ethers.ContractFactory(art.abi, art.bytecode.object, admin).deploy(admin.address);
    const POOL_MANAGER = await pm.getAddress();

    const c2 = await (await ethers.getContractFactory("HookDeployer")).deploy();
    const c2Addr = await c2.getAddress();
    const Hook = await ethers.getContractFactory("EquoHook");
    const initCode = ethers.concat([Hook.bytecode, coder.encode(["address", "address"], [POOL_MANAGER, WETH])]);
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
    const tokenDeployer = await (await ethers.getContractFactory("EquoTokenDeployer")).deploy(admin.address, admin.address);
    await (await tokenDeployer.setEndpoint(await endpoint.getAddress())).wait();
    const TD = await tokenDeployer.getAddress();
    const plain = await (await ethers.getContractFactory("EquoTokenCreator")).deploy(TD);
    const div = await (await ethers.getContractFactory("EquoDivTokenCreator")).deploy(TD);
    await (await tokenDeployer.setCreators(await plain.getAddress(), await div.getAddress())).wait();

    const book = await (await ethers.getContractFactory("EquoPriceBook")).deploy(admin.address);
    await (await book.setPrices([WETH], [ETH_USD_18])).wait();
    const rules = await (await ethers.getContractFactory("EquoLaunchRules")).deploy();
    const factory = await (await ethers.getContractFactory("EquoFactory", { libraries: { EquoLaunchRules: await rules.getAddress() } })).deploy(
      admin.address, admin.address, POOL_MANAGER, hookAddr, TD, WETH, await book.getAddress(), feeWallet.address, ethers.parseEther("0.001"),
    );
    const FACTORY = await factory.getAddress();
    const router = await (await ethers.getContractFactory("EquoRouter")).deploy(POOL_MANAGER, FACTORY, WETH);
    await (await tokenDeployer.setFactory(FACTORY)).wait();
    await (await hook.setFactory(FACTORY)).wait();
    await (await factory.setConverter(await router.getAddress())).wait();
    return { eid, WETH, endpoint, tokenDeployer, book, factory, router, hook };
  }

  async function deployAll() {
    const [admin, creator, trader, feeWallet, launcher, outsider] = await ethers.getSigners();
    const chains = [];
    for (const eid of EIDS) chains.push(await deployChain(eid));
    for (const c of chains) await (await c.factory.setLauncher(launcher.address, true)).wait();
    return { admin, creator, trader, feeWallet, launcher, outsider, chains };
  }

  /** Predict the coin on every chain, then launch it everywhere: paid by the creator on the first chain, by the
   *  launch service on the rest. Mirrors what the site and backend do. */
  async function launchEverywhere(env: any, genes: any, tag: string, devBuy = ethers.parseEther("1"), split = 1) {
    const { creator, launcher, chains } = env;
    const salt = ethers.id(`omni-${tag}`);
    const divs = genes.divShareBps !== 0;
    const addrs: string[] = [];
    // the factory binds the salt to the creator, so the address depends on who the coin is for
    const bound = ethers.keccak256(coder.encode(["address", "bytes32"], [creator.address, salt]));
    for (const c of chains) addrs.push((await c.tokenDeployer.predict(bound, c.WETH, divs))[0]);
    // the mock endpoints deliver straight to the coin on the other "chain"
    for (let i = 0; i < chains.length; i++)
      for (let j = 0; j < chains.length; j++)
        if (i !== j) await (await chains[i].endpoint.setDestLzEndpoint(addrs[j], await chains[j].endpoint.getAddress())).wait();

    const p = { name: `Omni ${tag}`, symbol: `O${tag}`, metadataURI: "ipfs://omni", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes, stages: [] as any[], split };
    const coins = [];
    for (let i = 0; i < chains.length; i++) {
      const others = chains.map((c: any, j: number) => j).filter((j: number) => j !== i);
      const peers = coder.encode(["uint32[]", "bytes32[]"], [others.map((j: number) => EIDS[j]), others.map((j: number) => pad(addrs[j]))]);
      const f = chains[i].factory;
      const tx = i === 0
        ? await f.connect(creator).launch(p, salt, "0x", peers, { value: devBuy })
        : await f.connect(launcher).launchFor(creator.address, p, salt, "0x", peers, { value: ethers.parseEther("0.001") }); // the launch service seeds each chain's pool with the minimum first buy
      const rc = await tx.wait();
      const ev = rc!.logs.map((l: any) => { try { return f.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
      expect(ev!.args.token).to.equal(addrs[i]);
      coins.push(await ethers.getContractAt(divs ? "EquoDivToken" : "EquoToken", addrs[i]));
    }
    return { salt, addrs, coins };
  }

  async function bridge(coin: any, from: any, dstEid: number, to: string, amount: bigint) {
    const sp = { dstEid, to: pad(to), amountLD: amount, minAmountLD: 0n, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const q = await coin.quoteSend(sp, false);
    const fee = { nativeFee: q.nativeFee, lzTokenFee: q.lzTokenFee };
    return (await coin.connect(from).send(sp, fee, from.address, { value: fee.nativeFee })).wait();
  }

  // the three "chains" here share one EVM, so their token deployers (and coin addresses) differ; on real chains the
  // deployer sits at one address everywhere and the coin does too (equo-same-address.local.test.ts)
  it("launches on all three chains and wires every peer at birth", async () => {
    const env = await deployAll();
    const { addrs, coins } = await launchEverywhere(env, FLAT, "A");
    expect(new Set(addrs.map((a) => a.toLowerCase())).size).to.equal(3);
    for (let i = 0; i < 3; i++) {
      const c = env.chains[i];
      expect(addrs[i].toLowerCase() < c.WETH.toLowerCase()).to.equal(true); // the coin is currency0 in its pool
      expect((await c.factory.listings(addrs[i])).creator).to.equal(env.creator.address);
      expect(await coins[i].totalSupply()).to.equal(SUPPLY);
      expect(await coins[i].owner()).to.equal(await c.tokenDeployer.getAddress());
      expect(await coins[i].bridgeFeeTo()).to.equal(env.feeWallet.address);
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        expect(await coins[i].peers(EIDS[j])).to.equal(pad(addrs[j]));
        expect(await coins[i].enforcedOptions(EIDS[j], 1)).to.equal(ethers.solidityPacked(["uint16", "uint8", "uint16", "uint8", "uint128"], [3, 1, 17, 1, 200_000]));
      }
    }
    // the creator's paid launch included the first buy; the service launches did not
    expect(await coins[0].balanceOf(env.creator.address)).to.be.gt(0n);
    expect(await coins[1].balanceOf(env.creator.address)).to.be.gt(0n); // the service's seed buy on the other chains goes to the creator too
  });

  it("split mode: one 1B supply shared by three chains, same opening price, total kept across a bridge", async () => {
    const env = await deployAll();
    const full = await launchEverywhere(env, FLAT, "F");
    const { coins, addrs } = await launchEverywhere(env, FLAT, "S", ethers.parseEther("1"), 3);
    const third = SUPPLY / 3n;
    let total = 0n;
    for (let i = 0; i < 3; i++) {
      const f = env.chains[i].factory;
      expect(await coins[i].totalSupply()).to.equal(third);
      expect(await f.launchSupplyOf(addrs[i])).to.equal(third);
      // same price range as a full-supply coin on the same chain, a third of its liquidity
      const ps = await f.positionOf(addrs[i]), pf = await f.positionOf(full.addrs[i]);
      expect(ps.tickLower).to.equal(pf.tickLower);
      expect(ps.tickUpper).to.equal(pf.tickUpper);
      const ratio = Number(pf.liquidity) / Number(ps.liquidity);
      expect(ratio).to.be.closeTo(3, 0.001);
      total += await coins[i].localSupply();
    }
    expect(SUPPLY - total).to.be.lt(3n); // 1B total, less the integer rounding of a third
    // a bridge moves coins between chains and never changes the total
    const bal = await coins[0].balanceOf(env.creator.address);
    await bridge(coins[0], env.creator, EIDS[1], env.trader.address, bal / 2n);
    let after = 0n;
    for (const c of coins) after += await c.localSupply();
    // trackers keep reading each chain's launch slice, however the coins moved
    for (const c of coins) expect(await c.totalSupply()).to.equal(third);
    expect(after).to.equal(total);
    // the takeover stake follows the chain's supply: 5% of a third
    expect(await env.chains[0].factory.launchSupplyOf(addrs[0]) / 20n).to.equal(third / 20n);
  });

  it("split mode: refuses a split of zero or above MAX_SPLIT", async () => {
    const env = await deployAll();
    const c = env.chains[0];
    const p = { name: "Bad", symbol: "BAD", metadataURI: "", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes: FLAT, stages: [] as any[], split: 0 };
    await expect(c.factory.connect(env.creator).launch(p, ethers.id("s0"), "0x", "0x", { value: ethers.parseEther("0.001") })).to.be.revertedWithCustomError(c.factory, "InvalidParams");
    await expect(c.factory.connect(env.creator).launch({ ...p, split: 21 }, ethers.id("s21"), "0x", "0x", { value: ethers.parseEther("0.001") })).to.be.revertedWithCustomError(c.factory, "InvalidParams");
    expect(await c.factory.MAX_SPLIT()).to.equal(20);
  });

  it("bridges: burns out, mints in, keeps the total, takes 0.2% for the platform, and the coins trade on arrival", async () => {
    const env = await deployAll();
    const { coins } = await launchEverywhere(env, FLAT, "B");
    const { creator, trader, feeWallet, chains } = env;
    const bal = await coins[0].balanceOf(creator.address);
    const amount = bal / 3n;
    const sent = (amount / 10n ** 12n) * 10n ** 12n; // shared decimals 6: dust stays with the sender
    const received = ((sent - (sent * 20n) / 10_000n) / 10n ** 12n) * 10n ** 12n;

    const total0 = (await coins[0].localSupply()) + (await coins[1].localSupply());
    await bridge(coins[0], creator, EIDS[1], trader.address, amount);

    expect(await coins[0].balanceOf(creator.address)).to.equal(bal - sent);
    expect(await coins[0].balanceOf(feeWallet.address)).to.equal(sent - received);
    expect(await coins[1].balanceOf(trader.address)).to.equal(received);
    expect(await coins[0].localSupply()).to.equal(SUPPLY - received);
    expect(await coins[1].localSupply()).to.equal(SUPPLY + received);
    // what trackers read stays at each chain's 1B launch slice
    expect(await coins[0].totalSupply()).to.equal(SUPPLY);
    expect(await coins[1].totalSupply()).to.equal(SUPPLY);
    expect((await coins[0].localSupply()) + (await coins[1].localSupply())).to.equal(total0);

    // sell the bridged coins into the destination chain's own pool
    const r1 = chains[1].router;
    await (await coins[1].connect(trader).approve(await r1.getAddress(), received)).wait();
    const before = await ethers.provider.getBalance(trader.address);
    await (await r1.connect(trader).sell(await coins[1].getAddress(), received / 2n, "0x", 0, ethers.ZeroAddress)).wait();
    expect(await ethers.provider.getBalance(trader.address)).to.be.gt(before - ethers.parseEther("0.01"));
    expect(await coins[1].balanceOf(trader.address)).to.equal(received - received / 2n);

    // and on to the third chain, then back home
    const rest = await coins[1].balanceOf(trader.address);
    await bridge(coins[1], trader, EIDS[2], trader.address, rest);
    expect(await coins[2].balanceOf(trader.address)).to.be.gt(0n);
    const onThird = await coins[2].balanceOf(trader.address);
    await bridge(coins[2], trader, EIDS[0], creator.address, onThird);
    expect(await coins[2].balanceOf(trader.address)).to.be.lt(10n ** 12n);
  });

  it("bridges a coin with holder rewards and keeps reward shares in line on both sides", async () => {
    const env = await deployAll();
    const { coins } = await launchEverywhere(env, DIVS, "D");
    const { creator, trader } = env;
    const bal = await coins[0].balanceOf(creator.address);
    const shares0 = await coins[0].totalShares();
    expect(shares0).to.equal(bal);
    const shares2 = await coins[2].totalShares(); // the creator's seed buy on chain two
    await bridge(coins[0], creator, EIDS[2], trader.address, bal / 2n);
    const got = await coins[2].balanceOf(trader.address);
    expect(got).to.be.gt(0n);
    expect(await coins[2].totalShares()).to.equal(shares2 + got);
    // what left chain one: the creator's burn, minus the fee that stayed as the platform's shares
    expect(await coins[0].totalShares()).to.equal(shares0 - got);
  });

  it("a copied salt does not take a creator's coin address on another chain", async () => {
    const env = await deployAll();
    const { creator, outsider, chains } = env;
    const salt = ethers.id("omni-Q");
    const bound = ethers.keccak256(coder.encode(["address", "bytes32"], [creator.address, salt]));
    const want = (await chains[1].tokenDeployer.predict(bound, chains[1].WETH, false))[0];
    const p = { name: "Squat", symbol: "SQ", metadataURI: "", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes: FLAT, stages: [] as any[], split: 1 };
    const rc = await (await chains[1].factory.connect(outsider).launch(p, salt, "0x", "0x", { value: ethers.parseEther("0.001") })).wait();
    const ev = rc!.logs.map((l: any) => { try { return chains[1].factory.interface.parseLog(l); } catch { return null; } }).find((l: any) => l && l.name === "Launched");
    expect(ev!.args.token).to.not.equal(want);
    expect((await chains[1].tokenDeployer.predict(bound, chains[1].WETH, false))[0]).to.equal(want);
    const { addrs } = await launchEverywhere(env, FLAT, "Q");
    expect(addrs[1]).to.equal(want);
  });

  it("seals peers: no one can change one; the admin can only add a chain the coin has none for", async () => {
    const env = await deployAll();
    const { addrs, coins } = await launchEverywhere(env, FLAT, "S");
    const { admin, outsider, chains } = env;
    const td = chains[0].tokenDeployer;
    await expect(coins[0].connect(admin).setPeer(EIDS[1], pad(outsider.address))).to.be.revertedWithCustomError(coins[0], "OwnableUnauthorizedAccount");
    await expect(td.connect(admin).addPeer(addrs[0], EIDS[1], pad(outsider.address))).to.be.revertedWithCustomError(td, "PeerExists");
    await expect(td.connect(outsider).addPeer(addrs[0], 30184, pad(outsider.address))).to.be.revertedWithCustomError(td, "NotAdmin");
    await expect(td.connect(admin).addPeer(outsider.address, 30184, pad(outsider.address))).to.be.revertedWithCustomError(td, "NotCoin");
    await expect(td.connect(admin).addPeer(addrs[0], EIDS[0], pad(outsider.address))).to.be.revertedWithCustomError(td, "BadPeers");
    // a chain added later (Base) can be linked once
    const base = pad(ethers.Wallet.createRandom().address);
    await (await td.connect(admin).addPeer(addrs[0], 30184, base)).wait();
    expect(await coins[0].peers(30184)).to.equal(base);
    await expect(td.connect(admin).addPeer(addrs[0], 30184, pad(outsider.address))).to.be.revertedWithCustomError(td, "PeerExists");
    // the deploying account can set routes only until it ends its setup; the admin always can
    const fresh = await (await ethers.getContractFactory("EquoTokenDeployer")).connect(outsider).deploy(admin.address, outsider.address);
    const route = { sendLib: ethers.ZeroAddress, receiveLib: ethers.ZeroAddress, sendConfig: "0x", receiveConfig: "0x" };
    await (await fresh.connect(outsider).setRoute(30184, route)).wait();
    await (await fresh.connect(outsider).endSetup()).wait();
    await expect(fresh.connect(outsider).setRoute(30184, route)).to.be.revertedWithCustomError(fresh, "NotAdmin");
    await expect(fresh.connect(outsider).setFactory(outsider.address)).to.be.revertedWithCustomError(fresh, "NotAdmin");
    await (await fresh.connect(admin).setRoute(30184, route)).wait();
    // the deployer only creates for its factory
    const init = { name: "x", symbol: "x", metadataURI: "", supply: 1n, pairAsset: chains[0].WETH, poolManager: admin.address, hook: admin.address, converter: admin.address, weth: chains[0].WETH, bridgeFeeTo: admin.address, dividends: false };
    await expect(td.connect(admin).deploy(ethers.id("x"), init, "0x")).to.be.revertedWithCustomError(td, "NotFactory");
  });

  it("only approved launchers can launch for a creator, and a launch needs a fresh price", async () => {
    const env = await deployAll();
    const { admin, creator, outsider, launcher, chains } = env;
    const c = chains[0];
    const p = { name: "Late", symbol: "LATE", metadataURI: "", pair: ethers.ZeroAddress, minPairOut: 0, capPreset: 0, genes: FLAT, stages: [] as any[], split: 1 };
    await expect(c.factory.connect(outsider).launchFor(creator.address, p, ethers.id("l1"), "0x", "0x")).to.be.revertedWithCustomError(c.factory, "NotAdmin");
    await expect(c.factory.connect(launcher).launchFor(ethers.ZeroAddress, p, ethers.id("l1"), "0x", "0x")).to.be.revertedWithCustomError(c.factory, "NotAdmin");

    await expect(c.book.connect(outsider).setPrices([c.WETH], [1n])).to.be.revertedWithCustomError(c.book, "NotUpdater");
    await time.increase(3601);
    await expect(c.factory.connect(creator).launch(p, ethers.id("l2"), "0x", "0x", { value: ethers.parseEther("0.001") })).to.be.revertedWithCustomError(c.book, "Stale");
    await (await c.book.setUpdater(launcher.address, true)).wait();
    await (await c.book.connect(launcher).setPrices([c.WETH], [ETH_USD_18])).wait();
    await (await c.factory.connect(creator).launch(p, ethers.id("l2"), "0x", "0x", { value: ethers.parseEther("0.001") })).wait();

    await (await c.factory.connect(admin).setLauncher(launcher.address, false)).wait();
    await expect(c.factory.connect(launcher).launchFor(creator.address, p, ethers.id("l3"), "0x", "0x", { value: ethers.parseEther("0.001") })).to.be.revertedWithCustomError(c.factory, "NotAdmin");
  });
});
