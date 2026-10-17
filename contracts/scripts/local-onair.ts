/* eslint-disable no-console */
// Local ONAIR stack for UI work: real Uniswap V3 bytecode, the ONAIR factory
// and house, Multicall3 at the canonical address, one instant coin, one
// running auction with bids and one settled auction. Run against `hardhat node`:
//   HARDHAT_CONFIG=hardhat.config.size.ts npx hardhat run scripts/local-onair.ts --network localhost
import { ethers, network } from "hardhat";
import UniswapV3FactoryArtifact from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import SwapRouterArtifact from "@uniswap/swap-router-contracts/artifacts/contracts/SwapRouter02.sol/SwapRouter02.json";
import PositionManagerArtifact from "@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const HYPE_USD8 = 84n * 10n ** 8n;

async function mine(n: number) {
  await network.provider.send("hardhat_mine", [`0x${n.toString(16)}`]);
}

async function main() {
  const [deployer, owner, creator, alice, bob, carol] = await ethers.getSigners();
  // Multicall3 from mainnet HyperEVM so viem's batching works locally.
  const code = await (async () => {
    try {
      const r = await fetch("https://rpc.hyperliquid.xyz/evm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [MULTICALL3, "latest"] }) });
      return ((await r.json()) as any).result as string;
    } catch { return "0x"; }
  })();
  if (code && code.length > 2) await network.provider.send("hardhat_setCode", [MULTICALL3, code]);
  console.log("multicall3", code.length > 2 ? "set" : "MISSING");

  const wnative = await (await ethers.getContractFactory("WrappedNative")).deploy("Wrapped HYPE", "WHYPE");
  const uniFactory = await new ethers.ContractFactory(UniswapV3FactoryArtifact.abi, UniswapV3FactoryArtifact.bytecode, deployer).deploy();
  const positionManager = await new ethers.ContractFactory(PositionManagerArtifact.abi, PositionManagerArtifact.bytecode, deployer).deploy(await uniFactory.getAddress(), await wnative.getAddress(), ethers.ZeroAddress);
  const swapRouter = await new ethers.ContractFactory(SwapRouterArtifact.abi, SwapRouterArtifact.bytecode, deployer).deploy(ethers.ZeroAddress, await uniFactory.getAddress(), await positionManager.getAddress(), await wnative.getAddress());
  const td = await (await ethers.getContractFactory("OnairTokenDeployer")).deploy();
  const factory = await (await ethers.getContractFactory("OnairFactory")).deploy(
    owner.address, owner.address, await td.getAddress(), await uniFactory.getAddress(), await positionManager.getAddress(), await swapRouter.getAddress(), await wnative.getAddress(),
    HYPE_USD8, 0, 7000, 10000,
  );
  await td.setFactory(await factory.getAddress());
  const house = await (await ethers.getContractFactory("OnairAuctionHouse")).deploy(await factory.getAddress());
  await (await factory.connect(owner).setAuctionHouse(await house.getAddress())).wait();
  // 900-block auctions locally
  await (await factory.connect(owner).setAuctionConfig(900, ethers.parseEther("0.05"), 3_000n * 10n ** 8n, ethers.parseEther("220"))).wait();

  const meta = (d: string) => JSON.stringify({ description: d, website: "https://example.com", twitter: "https://x.com/onair" });
  const created = async (rc: any): Promise<string> => {
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "TokenCreated");
    return ev.args.token;
  };

  // 1) instant coin with a first buy, plus a few trades
  const instant = await created(await (await factory.connect(creator).createToken({ name: "Night Owl", symbol: "OWL", metadataURI: meta("Late shift radio. Plays until the sun."), marketCapUsd8: 0, devBuyQuote: ethers.parseEther("1") }, { value: ethers.parseEther("1") })).wait());
  for (const [who, amt] of [[alice, "2"], [bob, "0.7"], [carol, "3"]] as const) {
    await (await swapRouter.connect(who).exactInputSingle({ tokenIn: await wnative.getAddress(), tokenOut: instant, fee: 10000, recipient: who.address, amountIn: ethers.parseEther(amt), amountOutMinimum: 0, sqrtPriceLimitX96: 0 }, { value: ethers.parseEther(amt) })).wait();
    await mine(20);
  }

  // 2) settled auction: bonded, pool seeded, some claims done
  const done = await created(await (await factory.connect(creator).createAuction({ name: "Dead Air", symbol: "DEAD", metadataURI: meta("The auction that already ended."), marketCapUsd8: 0, devBuyQuote: ethers.parseEther("5") }, { value: ethers.parseEther("5") })).wait());
  const floorPrev = (await factory.auctionPreview())[0];
  const tick = floorPrev / 100n;
  await (await house.connect(alice).bid(done, floorPrev + 1900n * tick, 0, { value: ethers.parseEther("150") })).wait();
  await mine(100);
  await (await house.connect(bob).bid(done, floorPrev + 3000n * tick, 0, { value: ethers.parseEther("120") })).wait();
  await mine(820);
  await (await factory.finalize(done)).wait();
  const hint = await house.exitHint(done, 1);
  await (await house.connect(alice).claim(done, 1, hint)).wait();

  // 3) running auction: creator bid + three bidders, a third of the way in
  const running = await created(await (await factory.connect(creator).createAuction({ name: "Signal Fire", symbol: "FIRE", metadataURI: meta("Four hours, one price. Bid early, pay less."), marketCapUsd8: 0, devBuyQuote: ethers.parseEther("2") }, { value: ethers.parseEther("2") })).wait());
  await mine(30);
  await (await house.connect(alice).bid(running, floorPrev + 1400n * tick, 0, { value: ethers.parseEther("40") })).wait();
  await mine(60);
  // bob caps at 5x the floor; carol's bid below pushes the price past it, so he ends up outbid
  await (await house.connect(bob).bid(running, floorPrev + 400n * tick, 0, { value: ethers.parseEther("25") })).wait();
  await mine(80);
  await (await house.connect(carol).bid(running, floorPrev + 4000n * tick, 0, { value: ethers.parseEther("90") })).wait();
  await mine(120);

  // 4) a fresh auction with no bids yet
  const fresh = await created(await (await factory.connect(bob).createAuction({ name: "Test Pattern", symbol: "TEST", metadataURI: meta("Colour bars. Nothing has happened yet."), marketCapUsd8: 0, devBuyQuote: 0 })).wait());

  console.log(JSON.stringify({
    factory: await factory.getAddress(), house: await house.getAddress(), tokenDeployer: await td.getAddress(), swapRouter: await swapRouter.getAddress(), quote: await wnative.getAddress(),
    tokens: { instant, done, running, fresh }, owner: owner.address,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
