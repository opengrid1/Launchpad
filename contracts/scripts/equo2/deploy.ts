import { ethers, network } from "hardhat";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Deploy Equo v2 (EquoFeeHook, EquoCoinDeployer + EquoCoinCreator, EquoLaunchFactory, EquoSwapRouter) to one chain.
 * Run it once per chain with the same deployer key; it picks the chain's settings from scripts/equo2/chains.js by
 * chain id and pins a LayerZero route to every other Equo v2 chain (LayerZero Labs + Nethermind DVNs, LayerZero's
 * own libraries, executor and confirmations from scripts/equo2/lz-defaults.json).
 *
 *   Rehearsal on a fork (real PoolManager, endpoint, libraries, DVNs), with a test launch and a $60 buy:
 *     EQUO2_FORK=<chain> npx hardhat run scripts/equo2/deploy.ts
 *   Live:
 *     EQUO_CONFIRM_DEPLOY=1 EQUO_SIGNER=0x.. EQUO_LAUNCHER=0x.. npx hardhat run scripts/equo2/deploy.ts --network <chain>
 *
 * Env:
 *   EQUO_ADMIN      immutable admin of the factory and coin deployer (default: the Equo admin wallet)
 *   EQUO_FEE_TO     platform fee recipient (default: admin)
 *   EQUO_SIGNER     the launch service's snapshot signer
 *   EQUO_LAUNCHER   the launch service's sending account, a launcher from deployment
 *
 * A live run writes deployments/equo2-<chain>.json after every step and resumes from it if rerun. It ends the
 * deployer's setup rights on the coin deployer, so routes can afterwards only be added by the admin.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CHAINS } = require("./chains");
const LZ = JSON.parse(readFileSync(join(__dirname, "lz-defaults.json"), "utf8"));

const ADMIN = "0x5DdDEa56774f01fc9d207BBD7B7633596a2f4A0b";
// beforeInitialize | beforeAddLiquidity | beforeSwap | afterSwap | beforeSwapReturnDelta | afterSwapReturnDelta
const HOOK_FLAGS = (1n << 13n) | (1n << 11n) | (1n << 7n) | (1n << 6n) | (1n << 3n) | (1n << 2n);
const FLAG_MASK = (1n << 14n) - 1n;
const CREATE2_PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const RECEIVE_GAS = 100_000;
const CHAIN_SUPPLY = 1_000_000_000n * 10n ** 9n;
const CEILING = 1n << 156n;
/// USD band a snapshot's native price must sit in, per chain (fixed in the factory for good: wide on purpose).
const NATIVE_BAND: Record<string, [string, string]> = {
  mainnet: ["300", "30000"], arbitrum: ["300", "30000"], base: ["300", "30000"], unichain: ["300", "30000"], megaeth: ["300", "30000"],
  bsc: ["70", "7000"], hyperevm: ["5", "1000"], monad: ["0.001", "1"],
};
/// A rough native price for the rehearsal launch only.
const REHEARSAL_USD: Record<string, string> = {
  mainnet: "2300", arbitrum: "2300", base: "2300", unichain: "2300", megaeth: "2300", bsc: "737", hyperevm: "77", monad: "0.026",
};

const coder = ethers.AbiCoder.defaultAbiCoder();
const ULN = "tuple(uint64,uint8,uint8,uint8,address[],address[])";
const PARAMS = "tuple(uint32,uint32,bytes)[]";

function routeFor(self: any, remote: any) {
  const d = LZ[self.name]?.[remote.name];
  if (!d?.supported) throw new Error(`LayerZero does not connect ${self.name} -> ${remote.name}`);
  const uln = (confirmations: number) => coder.encode([ULN], [[confirmations, self.dvns.length, 0, 0, self.dvns, []]]);
  const executor = coder.encode(["tuple(uint32,address)"], [[d.maxMessageSize, d.executor]]);
  return {
    sendLib: d.sendLib,
    receiveLib: d.receiveLib,
    // executor (config type 1) and ULN (type 2) for messages to `remote`; ULN for messages from it
    sendConfig: coder.encode([PARAMS], [[[remote.eid, 1, executor], [remote.eid, 2, uln(d.sendConfirmations)]]]),
    receiveConfig: coder.encode([PARAMS], [[[remote.eid, 2, uln(d.receiveConfirmations)]]]),
    receiveGas: RECEIVE_GAS,
    composeGas: 0,
    receiveValue: 0,
  };
}

const TYPES = {
  Snapshot: [
    { name: "launchId", type: "bytes32" }, { name: "creator", type: "address" }, { name: "name", type: "string" },
    { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }, { name: "feeBps", type: "uint16" },
    { name: "deadline", type: "uint64" }, { name: "feeEid", type: "uint32" }, { name: "launchFeeUsd18", type: "uint256" },
    { name: "legs", type: "Leg[]" },
  ],
  Leg: [
    { name: "eid", type: "uint32" }, { name: "coin", type: "bytes32" }, { name: "legSalt", type: "bytes32" },
    { name: "pair", type: "bytes32" }, { name: "slice", type: "uint256" }, { name: "quoteUsd18", type: "uint256" },
  ],
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const chain = CHAINS.find((c: any) => c.chainId === chainId);
  if (!chain) throw new Error(`chain ${chainId} is not an Equo v2 chain`);
  const fork = !!process.env.EQUO2_FORK;
  if (!fork && process.env.EQUO_CONFIRM_DEPLOY !== "1") throw new Error("set EQUO_CONFIRM_DEPLOY=1 to deploy to a live chain");
  if (fork && network.name !== "hardhat") throw new Error("EQUO2_FORK runs on the in-process network only");

  const rehearsalSigner = fork ? ethers.Wallet.createRandom() : null;
  const admin = ethers.getAddress(process.env.EQUO_ADMIN ?? ADMIN);
  const feeTo = ethers.getAddress(process.env.EQUO_FEE_TO ?? admin);
  const signer = fork ? rehearsalSigner!.address : ethers.getAddress(process.env.EQUO_SIGNER ?? "");
  const launcher = fork ? deployer.address : ethers.getAddress(process.env.EQUO_LAUNCHER ?? "");
  const [lo, hi] = NATIVE_BAND[chain.name];

  const file = join(__dirname, `../../deployments/equo2-${chain.name}.json`);
  const state: any = !fork && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { contracts: {}, gas: {} };
  const save = () => {
    if (fork) return;
    mkdirSync(join(__dirname, "../../deployments"), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
  };
  Object.assign(state, {
    network: chain.name, chainId, eid: chain.eid, deployer: deployer.address, admin, feeRecipient: feeTo, signer, launcher,
    poolManager: chain.poolManager, weth: chain.weth, lzEndpoint: chain.endpoint, dvns: chain.dvns, nativeUsdBand: [lo, hi],
  });
  const C = state.contracts;
  let gasTotal = 0n;
  const sent = async (label: string, txp: Promise<any>) => {
    const r = await (await txp).wait();
    gasTotal += r.gasUsed;
    state.gas[label] = Number(r.gasUsed);
    console.log(`  ${label}: ${r.gasUsed} gas`);
    return r;
  };
  const deployC = async (label: string, name: string, args: any[]) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    const r = await c.deploymentTransaction()!.wait();
    gasTotal += r!.gasUsed;
    state.gas[label] = Number(r!.gasUsed);
    console.log(`  ${label}: ${r!.gasUsed} gas`);
    return c.getAddress();
  };
  const codeAt = async (a: string) => (await ethers.provider.getCode(a)).length > 2;
  const balance0 = await ethers.provider.getBalance(deployer.address);
  console.log(`${fork ? "REHEARSAL on a fork of" : "LIVE"} ${chain.name} (${chainId}), deployer ${deployer.address}, balance ${ethers.formatEther(balance0)}`);
  for (const k of ["poolManager", "weth", "endpoint"]) if (!(await codeAt(chain[k]))) throw new Error(`no ${k} at ${chain[k]}`);
  if (!(await codeAt(CREATE2_PROXY))) throw new Error("no CREATE2 deployer on this chain");

  // 1. The hook, through the CREATE2 deployer at an address carrying its permission flags.
  if (!C.hook) {
    const Hook = await ethers.getContractFactory("EquoFeeHook");
    const init = ethers.concat([Hook.bytecode, coder.encode(["address", "address", "address"], [chain.poolManager, chain.weth, deployer.address])]);
    const hash = ethers.keccak256(init);
    let salt = "", addr = "";
    for (let i = 0n; ; i++) {
      salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      addr = ethers.getCreate2Address(CREATE2_PROXY, salt, hash);
      if ((BigInt(addr) & FLAG_MASK) === HOOK_FLAGS) break;
    }
    await sent("hook", deployer.sendTransaction({ to: CREATE2_PROXY, data: ethers.concat([salt, init]) }));
    for (let i = 0; !(await codeAt(addr)); i++) {
      if (i === 15) throw new Error(`hook did not land at ${addr}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    C.hook = addr;
    C.hookSalt = salt;
    save();
  }
  console.log("EquoFeeHook", C.hook);
  if ((await (await ethers.getContractAt("EquoFeeHook", C.hook)).deployer()) !== deployer.address) throw new Error("hook belongs to someone else");

  // 2. The coin deployer and its creator, with this chain's endpoint.
  if (!C.coinDeployer) {
    C.coinDeployer = await deployC("coinDeployer", "EquoCoinDeployer", [admin, deployer.address]);
    save();
  }
  const dep = await ethers.getContractAt("EquoCoinDeployer", C.coinDeployer);
  console.log("EquoCoinDeployer", C.coinDeployer);
  if ((await dep.endpoint()) === ethers.ZeroAddress) await sent("setEndpoint", dep.setEndpoint(chain.endpoint));
  if (!C.coinCreator) {
    C.coinCreator = await deployC("coinCreator", "EquoCoinCreator", [C.coinDeployer]);
    save();
  }
  console.log("EquoCoinCreator", C.coinCreator);
  if ((await dep.creatorContract()) === ethers.ZeroAddress) await sent("setCreatorContract", dep.setCreatorContract(C.coinCreator));

  // 3. A pinned route to every other chain.
  for (const remote of CHAINS) {
    if (remote === chain) continue;
    const have = await dep.route(remote.eid);
    if (have.sendLib !== ethers.ZeroAddress) continue;
    await sent(`route ${remote.name}`, dep.setRoute(remote.eid, routeFor(chain, remote)));
  }
  state.routes = Object.fromEntries(CHAINS.filter((c: any) => c !== chain).map((c: any) => [c.name, c.eid]));
  save();

  // 4. The factory (native pair only), wired to the hook and coin deployer; the router.
  if (!C.factory) {
    const pairs = [{ token: chain.weth, minUsd18: ethers.parseEther(lo), maxUsd18: ethers.parseEther(hi) }];
    C.factory = await deployC("factory", "EquoLaunchFactory", [admin, chain.poolManager, C.hook, C.coinDeployer, chain.weth, chain.eid, signer, feeTo, launcher, pairs]);
    save();
  }
  console.log("EquoLaunchFactory", C.factory);
  const hook = await ethers.getContractAt("EquoFeeHook", C.hook);
  if ((await dep.factory()) === ethers.ZeroAddress) await sent("coinDeployer.setFactory", dep.setFactory(C.factory));
  if ((await hook.factory()) === ethers.ZeroAddress) await sent("hook.setFactory", hook.setFactory(C.factory));
  if ((await hook.factory()) !== C.factory || (await dep.factory()) !== C.factory) throw new Error("hook or coin deployer wired to another factory");
  if (!C.router) {
    C.router = await deployC("router", "EquoSwapRouter", [chain.poolManager, C.factory, chain.weth]);
    save();
  }
  console.log("EquoSwapRouter", C.router);

  // 5. Close the deployer's setup rights: from here only the admin can add a route (a new chain).
  if ((await dep.setupBy()) !== ethers.ZeroAddress && !fork) await sent("coinDeployer.endSetup", dep.endSetup());
  state.deployedAt = state.deployedAt ?? new Date().toISOString();
  save();

  const spent = balance0 - (await ethers.provider.getBalance(deployer.address));
  console.log(`deploy gas ${gasTotal}, spent ${ethers.formatEther(spent)} native`);
  if (!fork) return;

  // Rehearsal: one leg of an 8-chain launch here, with a dev buy, then a $60 buy that takes the pot's timer.
  const factory = await ethers.getContractAt("EquoLaunchFactory", C.factory);
  const creatorC = await ethers.getContractAt("EquoCoinCreator", C.coinCreator);
  const initHash = await creatorC.initCodeHash();
  const launchId = ethers.id(`rehearsal-${Date.now()}`);
  const legs: any[] = [];
  let mine: any;
  for (const c of CHAINS) {
    if (c === chain) {
      for (let n = 0; ; n++) {
        const legSalt = ethers.zeroPadValue(ethers.toBeHex(n), 32);
        const s = ethers.keccak256(coder.encode(["bytes32", "address", "bytes32"], [launchId, deployer.address, legSalt]));
        const coin = ethers.getCreate2Address(C.coinCreator, s, initHash);
        if (BigInt(coin) < CEILING && (BigInt(coin) & 0xffn) === 0xe9n) { mine = { coin, legSalt }; break; }
      }
      legs.push({ eid: c.eid, coin: ethers.zeroPadValue(mine.coin, 32), legSalt: mine.legSalt, pair: ethers.ZeroHash, slice: CHAIN_SUPPLY, quoteUsd18: ethers.parseEther(REHEARSAL_USD[c.name]) });
    } else {
      const fake = "0x" + ethers.keccak256(ethers.toUtf8Bytes(c.name)).slice(2, 40).replace(/^./, "0") + "e9";
      legs.push({ eid: c.eid, coin: ethers.zeroPadValue(fake, 32), legSalt: ethers.ZeroHash, pair: ethers.ZeroHash, slice: CHAIN_SUPPLY, quoteUsd18: ethers.parseEther(REHEARSAL_USD[c.name]) });
    }
  }
  legs.sort((a, b) => a.eid - b.eid);
  const block = await ethers.provider.getBlock("latest");
  const snap = { launchId, creator: deployer.address, name: "Equo Rehearsal", symbol: "EREH", metadataURI: "ipfs://equo", feeBps: 100, deadline: block!.timestamp + 1800, feeEid: chain.eid, launchFeeUsd18: ethers.parseEther("8"), legs };
  const sig = await rehearsalSigner!.signTypedData({ name: "Equo", version: "2" }, TYPES, snap);
  const devBuy = ethers.parseEther((18 / Number(REHEARSAL_USD[chain.name])).toFixed(12)); // $8 launch fee + $10 buy
  const lr = await (await factory.launch(snap, sig, 0n, { value: devBuy })).wait();
  console.log(`rehearsal launch (8 legs, 7 routes wired, $8 fee, $10 dev buy): ${lr!.gasUsed} gas, coin ${mine.coin}`);
  const router = await ethers.getContractAt("EquoSwapRouter", C.router);
  const usd60 = ethers.parseEther((60 / Number(REHEARSAL_USD[chain.name])).toFixed(12));
  const br = await (await router.buy(mine.coin, "0x", 0n, { value: usd60 })).wait();
  const pot = await hook.pots(mine.coin);
  console.log(`$60 buy: ${br!.gasUsed} gas; pot last buyer ${pot.lastBuyer === deployer.address ? "set" : "NOT SET"}, pot ${pot.amount}`);
  const coin = await ethers.getContractAt("EquoCoin", mine.coin);
  for (const remote of CHAINS) if (remote !== chain && (await coin.peers(remote.eid)) === ethers.ZeroHash) throw new Error(`no peer to ${remote.name}`);
  console.log("peers wired to all 7 other chains; coin owner", await coin.owner());
  // a bridge quote through the real endpoint, libraries, DVNs and executor
  const remote = CHAINS.find((c: any) => c !== chain && c.name !== "megaeth")!;
  const sp = { dstEid: remote.eid, to: ethers.zeroPadValue(deployer.address, 32), amountLD: 10n ** 12n, minAmountLD: 0n, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
  const q = await coin.quoteSend(sp, false);
  console.log(`bridge quote to ${remote.name}: ${ethers.formatEther(q.nativeFee)} native`);
  console.log(JSON.stringify({ chain: chain.name, deployGas: gasTotal.toString(), launchGas: lr!.gasUsed.toString(), buyGas: br!.gasUsed.toString() }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
