// Checks a deployment made by deploy.cjs on a LOCAL FORK of Elysium, never on Elysium itself (it impersonates the
// owner wallet, which only a fork allows): the owner accepts the six contracts and opens launches, then a coin is
// launched with HYPE against each quote, bought and sold through the router, paid a keeper round, its fees split,
// and a collect simulated.
//   anvil --fork-url https://rpc.elysium.kinetiq.xyz --port 8547 --chain-id 31337
//   ELYSIUM_RPC=http://127.0.0.1:8547 ALLOW_CHAIN=1 KEYFILE=<a file with one of anvil's test keys> node deploy.cjs --send
//   node smoke.cjs            (then delete deployments/lootbag-elysium*.json: they describe the fork, not Elysium)
const fs = require("fs"), path = require("path");
const { ethers } = require(fs.existsSync(path.join(__dirname, "node_modules/ethers")) ? "ethers" : path.join(__dirname, "../node_modules/ethers"));
const D = __dirname, dep = JSON.parse(fs.readFileSync(D + "/deployments/lootbag-elysium.json", "utf8")), C = dep.contracts;
const abi = (n) => JSON.parse(fs.readFileSync(`${D}/out/${n}.sol/${n}.json`, "utf8")).abi;
(async () => {
  if (dep.chainId === 99901) throw new Error("this deployment record is Elysium's own: the smoke test runs on a local fork only");
  const P = new ethers.JsonRpcProvider(process.env.FORK_RPC || "http://127.0.0.1:8547", undefined, { staticNetwork: true, cacheTimeout: -1 });
  const as = async (addr) => { await P.send("anvil_impersonateAccount", [addr]); await P.send("anvil_setBalance", [addr, "0x" + (10n ** 21n).toString(16)]); return P.getSigner(addr); };
  const owner = await as(dep.owner), alice = await as("0x00000000000000000000000000000000000a11ce"), bob = await as("0x0000000000000000000000000000000000000b0b"), dev = await as("0x000000000000000000000000000000000000de11");
  const f = new ethers.Contract(C.factory, abi("LootbagFactory"), P), hook = new ethers.Contract(C.hook, abi("LootbagHook"), P), payout = new ethers.Contract(C.payout, abi("LootbagPayout"), P), router = new ethers.Contract(C.router, abi("LootbagRouter"), P);
  const erc = (a) => new ethers.Contract(a, ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], P);
  const K = dep.tokens.kntq, W = dep.tokens.whype, fmt = ethers.formatEther, ok = (c, m) => { if (!c) throw new Error("CHECK FAILED: " + m); console.log("  ok:", m); };
  for (const n of ["factory", "hook", "payout", "swapper", "bags", "airdrop"]) await (await new ethers.Contract(C[n], ["function acceptOwnership()", "function owner() view returns (address)"], owner).acceptOwnership()).wait();
  ok((await f.owner()) === dep.owner && (await hook.owner()) === dep.owner, "the owner wallet owns the contracts after accepting");
  ok(await f.paused(), "the factory is deployed paused");
  await (await f.connect(owner).setPaused(false)).wait();
  ok((await f.LAUNCH_FEE()) === ethers.parseEther(dep.fees.launchFeeHype) && (await f.COPY_FEE()) === ethers.parseEther(dep.fees.copyFeeHype), `fees fixed at ${dep.fees.launchFeeHype} and ${dep.fees.copyFeeHype} HYPE`);
  const bags = new ethers.Contract(C.bags, abi("LootbagBags"), P);
  ok((await bags.kntq()).toLowerCase() === K.toLowerCase() && (await bags.MINT_KNTQ()) === ethers.parseEther(dep.fees.bagMintKntq), `Bags are priced in KNTQ: ${dep.fees.bagMintKntq} a mint`);
  ok((await hook.bagPot()) === C.bags && (await hook.airdropPot()) === C.airdrop, "the hook pays the Bag pot and the airdrop pot");

  // A round is sent with gas to spare, as a keeper must: the swap runs through another protocol's pool, whose first
  // trade in a new second costs more than an estimate made a block earlier, and an exact estimate then runs out.
  const ROUND_GAS = { gasLimit: 1_500_000 };
  const listed = new Set(dep.quotes.map((q) => q.token.toLowerCase()));
  for (const [sym, quote] of [["KLOOT", K], ["WLOOT", W]].filter(([, q]) => listed.has(q.toLowerCase()))) {
    const p = { name: "Smoke " + sym, symbol: sym, quote, rewards: [K, W], devBuy: 0, minCoinsOut: 1 }, fee = await f.launchFee(sym);
    const rc = await (await f.connect(dev).launchWithEth(p, ["", "smoke test", "", "", ""], 1, { value: fee + ethers.parseEther("0.5") })).wait();
    const coin = rc.logs.map((l) => { try { return f.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Launched").args.coin;
    const t = new ethers.Contract(coin, abi("LootbagToken"), P), devCoins = await t.balanceOf(dev.address);
    ok(devCoins > 0n && devCoins <= 20_000_000n * 10n ** 18n, `${sym} launched with 0.5 HYPE: dev got ${(Number(devCoins) / 1e24).toFixed(2)}M coins (${(Number(devCoins) / 1e25).toFixed(2)}% of supply), gas ${rc.gasUsed}`);
    ok(await t.excluded(dev.address), "the creator is excluded from rewards");
    await P.send("evm_mine", []);
    const got = await router.connect(alice).buy.staticCall(coin, 1, alice.address, { value: ethers.parseEther("1") });
    await (await router.connect(alice).buy(coin, 1, alice.address, { value: ethers.parseEther("1") })).wait();
    const have = await t.balanceOf(alice.address); ok(have > (got * 99n) / 100n && have < (got * 101n) / 100n && !(await t.excluded(alice.address)), `alice bought ${(Number(got) / 1e24).toFixed(2)}M coins with 1 HYPE and is not excluded`);
    await (await router.connect(bob).buy(coin, 1, bob.address, { value: ethers.parseEther("1") })).wait();
    const earned = await t.earned(alice.address);
    ok(earned > 0n, `alice earned ${fmt(earned)} ${quote === K ? "KNTQ" : "WHYPE"} from bob's buy`);
    await (await t.connect(alice).approve(C.router, have / 2n)).wait();
    const b0 = await P.getBalance(alice.address); const r2 = await (await router.connect(alice).sell(coin, have / 2n, 1, alice.address)).wait();
    ok((await P.getBalance(alice.address)) + r2.gasUsed * r2.gasPrice > b0, "alice sold half back for HYPE");
    // a KNTQ round arrives as KNTQ, a WHYPE round as HYPE itself; alice does nothing either way
    const reward = await payout.currentReward(coin), inHype = reward.toLowerCase() === W.toLowerCase();
    const bal = () => (inHype ? P.getBalance(alice.address) : erc(reward).balanceOf(alice.address)), rb0 = await bal(), wb0 = await erc(W).balanceOf(alice.address);
    await (await payout.connect(owner).pay(coin, [alice.address, bob.address], 1, ROUND_GAS)).wait();
    ok((await bal()) > rb0 && (await t.earned(alice.address)) === 0n && (await erc(W).balanceOf(alice.address)) === wb0, `the keeper's round paid alice in ${inHype ? "HYPE, straight to her wallet (no WHYPE)" : "KNTQ"}`);
    if (!inHype) { // the next round is the other reward: WHYPE, which must arrive as HYPE
      await (await router.connect(bob).buy(coin, 1, bob.address, { value: ethers.parseEther("1") })).wait();
      await P.send("evm_increaseTime", [300]); await P.send("evm_mine", []);
      ok((await payout.currentReward(coin)).toLowerCase() === W.toLowerCase(), "five minutes later the round's reward is WHYPE");
      const h0 = await P.getBalance(alice.address);
      await (await payout.connect(owner).pay(coin, [alice.address], 1, ROUND_GAS)).wait();
      ok((await P.getBalance(alice.address)) > h0 && (await erc(W).balanceOf(alice.address)) === wb0, "and it reached alice as HYPE, with no WHYPE left to unwrap");
    }
    await (await hook.connect(bob).split(quote)).wait();
    ok((await erc(quote).balanceOf(C.bags)) > 0n && (await erc(quote).balanceOf(C.airdrop)) > 0n, "the split reached the Bag pot and the airdrop pot");
    const [coins, q] = await f.connect(owner).collect.staticCall(coin, 1000, dep.owner);
    ok(coins > 0n && q > 0n, `collect works: 10% of the pool would return ${(Number(coins) / 1e24).toFixed(1)}M coins and ${fmt(q)} of the quote`);
  }
  console.log("ALL CHECKS PASSED");
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
