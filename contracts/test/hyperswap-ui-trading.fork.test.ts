import { expect } from "chai";
import { ethers, network } from "hardhat";

// Replays the EXACT router calls the liquidstock frontend (StableV3Client)
// makes, against live HyperSwap V3 on a HyperEVM fork:
//   buy  (HYPE pair):  exactInputSingle{tokenIn: WHYPE} with plain native
//                      msg.value — no deposit, no approval (router wraps).
//   sell (HYPE pair):  approve coin -> multicall([swap to address(2),
//                      unwrapWETH9(minOut, seller)]) — seller paid in native.
//   buy/sell (stock):  approve the stock -> swap directly, both directions.
// If these pass, the UI's trading paths are known-good against the real DEX.
const V3_FACTORY = "0xb1c0fa0b789320044a6f623cfe5ebda9562602e3";
const WHYPE = "0x5555555555555555555555555555555555555555";
const SWAP_ROUTER = "0x6d99e7f6747af2cdbb5164b6dd50e40d4fde1e77";
const NPM = "0x6eda206207c09e5428f281761ddc0d300851fbc8";
// USDT0, the deepest ERC20 on HyperEVM (6 decimals) — stands in for a
// stock-pair quote: the pool + router mechanics are identical for any plain
// ERC20 quote, and the Ondo stocks have near-zero circulating supply to
// borrow on a fork (NVDAon total supply is ~3.9 tokens).
const USDT0 = "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb";
const USDT = (n: bigint) => n * 10n ** 6n;
// SwapRouter02's ADDRESS_THIS constant: recipient=address(2) keeps the swap
// output in the router for a follow-up unwrapWETH9 in the same multicall.
const ADDRESS_THIS = "0x0000000000000000000000000000000000000002";

const ROUTER02_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum)) payable returns (uint256)",
  "function multicall(bytes[] data) payable returns (bytes[])",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
];
const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

describe("UI trading paths against live HyperSwap (fork)", function () {
  this.timeout(600_000);
  if (process.env.FORK !== "1") { it.skip("requires FORK=1", () => {}); return; }

  async function deploySystem(owner: any, feeRecipient: any) {
    const tokenDeployer = await (await ethers.getContractFactory("TokenDeployer")).deploy();
    await tokenDeployer.waitForDeployment();
    const factory = await (await ethers.getContractFactory("StableLaunchpadFactory")).deploy(
      owner.address, feeRecipient.address, await tokenDeployer.getAddress(),
      V3_FACTORY, NPM, SWAP_ROUTER, WHYPE, 7000,
    );
    await factory.waitForDeployment();
    await (await tokenDeployer.setFactory(await factory.getAddress())).wait();
    return factory;
  }

  async function createToken(factory: any, creator: any, quote: string) {
    const p = { name: "Hyper Coin", symbol: "HYPC", metadataURI: "{}", quote, marketCapUsd8: 0n, devBuyQuote: 0n };
    const rc = await (await factory.connect(creator).createToken(p)).wait();
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    return ev.args.token as string;
  }

  /** Credit up to `amount` of a live ERC20 by impersonating its richest
   *  WHYPE-pair HyperSwap pool on the fork (pools are the deepest holders). */
  async function dealToken(token: string, to: string, amount: bigint) {
    const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
    const v3 = await ethers.getContractAt("IUniswapV3FactoryCore", V3_FACTORY);
    let best: { addr: string; bal: bigint } | null = null;
    for (const fee of [100, 500, 3000, 10_000]) {
      const pool = (await v3.getPool(token, WHYPE, fee)) as string;
      if (pool === ethers.ZeroAddress) continue;
      const bal = (await erc20.balanceOf(pool)) as bigint;
      if (!best || bal > best.bal) best = { addr: pool, bal };
    }
    if (!best || best.bal === 0n) throw new Error(`no funded WHYPE pool holding ${token}`);
    const take = amount < best.bal / 2n ? amount : best.bal / 2n;
    await network.provider.send("hardhat_impersonateAccount", [best.addr]);
    await network.provider.send("hardhat_setBalance", [best.addr, ethers.toBeHex(ethers.parseEther("1"))]);
    const signer = await ethers.getSigner(best.addr);
    await (await new ethers.Contract(token, ["function transfer(address,uint256) returns (bool)"], signer).transfer(to, take)).wait();
    await network.provider.send("hardhat_stopImpersonatingAccount", [best.addr]);
    return take;
  }

  it("fills an atomic dev buy in the launch transaction (native and ERC20 quotes)", async () => {
    const [, owner, feeRecipient, creator] = await ethers.getSigners();
    const factory = await deploySystem(owner, feeRecipient);
    const dep = await factory.deploymentTransaction()!.wait();
    console.log("        factory deploy gas:", dep!.gasUsed.toString());

    // Native (WHYPE) quote: dev buy rides in as msg.value.
    const devBuy = ethers.parseEther("2");
    const p = { name: "Dev Coin", symbol: "DEVC", metadataURI: "{}", quote: WHYPE, marketCapUsd8: 0n, devBuyQuote: devBuy };
    const rc = await (await factory.connect(creator).createToken(p, { value: devBuy })).wait();
    const ev = rc.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    const token = ev.args.token as string;
    console.log("        createToken+devBuy gas:", rc.gasUsed.toString());
    const coin = new ethers.Contract(token, ERC20_ABI, ethers.provider);
    expect(await coin.balanceOf(creator.address), "creator holds the dev buy fill").to.be.greaterThan(0n);

    // ERC20 quote: approve the factory, dev buy pulled and swapped atomically.
    await (await factory.connect(owner).setQuoteAsset(USDT0, true, 100000000n)).wait();
    const amt = await dealToken(USDT0, creator.address, USDT(200n));
    const usdt = new ethers.Contract(USDT0, ERC20_ABI, creator);
    await (await usdt.approve(await factory.getAddress(), amt)).wait();
    const p2 = { name: "Dev Coin 2", symbol: "DEVC2", metadataURI: "{}", quote: USDT0, marketCapUsd8: 0n, devBuyQuote: amt };
    const rc2 = await (await factory.connect(creator).createToken(p2)).wait();
    const ev2 = rc2.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "TokenCreated");
    const coin2 = new ethers.Contract(ev2.args.token as string, ERC20_ABI, ethers.provider);
    expect(await coin2.balanceOf(creator.address), "creator holds the ERC20 dev buy fill").to.be.greaterThan(0n);
    // Wrong native value is rejected.
    await expect(
      factory.connect(creator).createToken(p2, { value: 1n }),
    ).to.be.revertedWithCustomError(factory, "InvalidParams");
  });

  it("buys and sells a stock-paired coin with plain HYPE via a two-hop route", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const factory = await deploySystem(owner, feeRecipient);
    // USDT0 stands in for a stock: it is the one quote with a live, funded
    // WHYPE pool today, which is exactly what the route detector looks for.
    await (await factory.connect(owner).setQuoteAsset(USDT0, true, 100000000n)).wait();
    const token = await createToken(factory, creator, USDT0);
    const coin = new ethers.Contract(token, ERC20_ABI, trader);
    const router = new ethers.Contract(SWAP_ROUTER, ROUTER02_ABI, trader);

    // Find the funded WHYPE/USDT0 tier the same way the client does.
    const v3 = await ethers.getContractAt("IUniswapV3FactoryCore", V3_FACTORY);
    let tier = 0;
    for (const fee of [3000, 500, 10_000, 100]) {
      const pool = (await v3.getPool(WHYPE, USDT0, fee)) as string;
      if (pool === ethers.ZeroAddress) continue;
      const liq = await new ethers.Contract(pool, ["function liquidity() view returns (uint128)"], ethers.provider).liquidity();
      if (liq > 0n) { tier = fee; break; }
    }
    expect(tier, "a funded WHYPE/USDT0 pool exists").to.be.greaterThan(0);

    // Buy: plain native in, HYPE -> USDT0 -> coin, exactly the client's call.
    const amountIn = ethers.parseEther("2");
    const pathBuy = ethers.solidityPacked(
      ["address", "uint24", "address", "uint24", "address"],
      [WHYPE, tier, USDT0, 10_000, token],
    );
    await (await router.exactInput(
      { path: pathBuy, recipient: trader.address, amountIn, amountOutMinimum: 0 },
      { value: amountIn },
    )).wait();
    const got = (await coin.balanceOf(trader.address)) as bigint;
    expect(got, "coins bought with plain HYPE through the stock pool").to.be.greaterThan(0n);

    // Sell: coin -> USDT0 -> HYPE, unwrapped straight to the seller.
    await (await coin.approve(SWAP_ROUTER, got)).wait();
    const pathSell = ethers.solidityPacked(
      ["address", "uint24", "address", "uint24", "address"],
      [token, 10_000, USDT0, tier, WHYPE],
    );
    const hop = router.interface.encodeFunctionData("exactInput", [
      { path: pathSell, recipient: ADDRESS_THIS, amountIn: got, amountOutMinimum: 0 },
    ]);
    const unwrap = router.interface.encodeFunctionData("unwrapWETH9", [0, trader.address]);
    const before = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.multicall([hop, unwrap])).wait();
    const gained = (await ethers.provider.getBalance(trader.address)) - before + rc.gasUsed * rc.gasPrice;
    expect(gained, "native HYPE received selling a stock-paired coin").to.be.greaterThan(ethers.parseEther("1.5"));
  });

  it("buys with plain native value (no wrap, no approval) exactly like the UI", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const factory = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator, WHYPE);
    const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);

    const router = new ethers.Contract(SWAP_ROUTER, ROUTER02_ABI, trader);
    const amountIn = ethers.parseEther("3");
    await (await router.exactInputSingle(
      { tokenIn: WHYPE, tokenOut: token, fee: 10_000, recipient: trader.address, amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
      { value: amountIn },
    )).wait();

    expect(await erc20.balanceOf(trader.address), "coins received from a native-value buy").to.be.greaterThan(0n);
  });

  it("sells back to native via multicall + unwrapWETH9 exactly like the UI", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const factory = await deploySystem(owner, feeRecipient);
    const token = await createToken(factory, creator, WHYPE);
    const erc20 = new ethers.Contract(token, ERC20_ABI, trader);
    const router = new ethers.Contract(SWAP_ROUTER, ROUTER02_ABI, trader);

    const amountIn = ethers.parseEther("3");
    await (await router.exactInputSingle(
      { tokenIn: WHYPE, tokenOut: token, fee: 10_000, recipient: trader.address, amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
      { value: amountIn },
    )).wait();

    const coins = await erc20.balanceOf(trader.address);
    await (await erc20.approve(SWAP_ROUTER, coins)).wait();
    const swap = router.interface.encodeFunctionData("exactInputSingle", [
      { tokenIn: token, tokenOut: WHYPE, fee: 10_000, recipient: ADDRESS_THIS, amountIn: coins, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
    ]);
    const unwrap = router.interface.encodeFunctionData("unwrapWETH9", [0, trader.address]);

    const before = await ethers.provider.getBalance(trader.address);
    const rc = await (await router.multicall([swap, unwrap])).wait();
    const gas = rc.gasUsed * rc.gasPrice;
    const gained = (await ethers.provider.getBalance(trader.address)) - before + gas;

    expect(gained, "native HYPE received from the sell").to.be.greaterThan(ethers.parseEther("2.5"));
    expect(await erc20.balanceOf(trader.address), "coins fully sold").to.equal(0n);
  });

  it("launches against an ERC20 quote and trades it both ways exactly like the UI", async () => {
    const [, owner, feeRecipient, creator, trader] = await ethers.getSigners();
    const factory = await deploySystem(owner, feeRecipient);
    // Owner approves the quote as a pair, as done on the live factory.
    await (await factory.connect(owner).setQuoteAsset(USDT0, true, 100000000n)).wait();
    const token = await createToken(factory, creator, USDT0);
    const coin = new ethers.Contract(token, ERC20_ABI, trader);
    const usdt = new ethers.Contract(USDT0, ERC20_ABI, trader);
    const router = new ethers.Contract(SWAP_ROUTER, ROUTER02_ABI, trader);

    // Buy: approve the pair token, then swap pair -> coin (recipient = trader).
    const amountIn = await dealToken(USDT0, trader.address, USDT(500n));
    await (await usdt.approve(SWAP_ROUTER, amountIn)).wait();
    await (await router.exactInputSingle(
      { tokenIn: USDT0, tokenOut: token, fee: 10_000, recipient: trader.address, amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
    )).wait();
    const coins = await coin.balanceOf(trader.address);
    expect(coins, "coins received from an ERC20-paid buy").to.be.greaterThan(0n);

    // Sell: approve the coin, swap coin -> pair straight to the seller.
    await (await coin.approve(SWAP_ROUTER, coins)).wait();
    const quoteBefore = await usdt.balanceOf(trader.address);
    await (await router.exactInputSingle(
      { tokenIn: token, tokenOut: USDT0, fee: 10_000, recipient: trader.address, amountIn: coins, amountOutMinimum: 0, sqrtPriceLimitX96: 0 },
    )).wait();
    const quoteGained = (await usdt.balanceOf(trader.address)) - quoteBefore;
    expect(quoteGained, "pair token received from the sell").to.be.greaterThan((amountIn * 3n) / 4n);

    // The creator's fee accrues in the pair token and harvests 70/30.
    const creatorBefore = await usdt.balanceOf(creator.address);
    await (await factory.harvestFees(token)).wait();
    expect((await usdt.balanceOf(creator.address)) - creatorBefore, "creator earns the pair token").to.be.greaterThan(0n);
  });
});
