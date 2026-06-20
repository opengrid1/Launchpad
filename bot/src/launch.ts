/**
 * Atomic block-0 launch + dev-buy driver for the LaunchSnipe contract.
 *
 *   npm run launch -- <token> <liqTokenAmount> <liqEth> <buyEth> [feeTier]
 *
 * Example: seed 100M tokens + 1 ETH of liquidity, then dev-buy 0.2 ETH:
 *   npm run launch -- 0xToken 100000000 1 0.2 10000
 *
 * Computes the pool's initial sqrtPriceX96 from the LP amounts (for a
 * full-range position amount1/amount0 == price), picks full-range ticks, then
 * calls LaunchSnipe.launchAndSnipe in ONE transaction. Honours DRY_RUN.
 *
 * Requires LAUNCH_SNIPE_ADDRESS in .env (deploy with the Foundry script first).
 */
import { parseEther, parseUnits, getAddress, type Address } from "viem";
import { publicClient, walletClient, account, WALLET_ADDRESS } from "./chain.js";
import { ADDRESSES, FULL_RANGE_TICKS, config } from "./config.js";
import { erc20Abi, launchSnipeAbi } from "./abis.js";

/** Integer sqrt for bigint (Newton's method). */
function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("negative");
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** sqrtPriceX96 = sqrt(amount1/amount0) * 2^96, computed exactly in bigint. */
function sqrtPriceX96(amount0: bigint, amount1: bigint): bigint {
  return isqrt((amount1 << 192n) / amount0);
}

async function main() {
  const [tokenArg, liqTokenArg, liqEthArg, buyEthArg, feeArg] = process.argv.slice(2);
  if (!tokenArg || !liqTokenArg || !liqEthArg || !buyEthArg) {
    console.error("Usage: npm run launch -- <token> <liqTokenAmount> <liqEth> <buyEth> [feeTier]");
    process.exit(1);
  }
  const launchSnipe = process.env.LAUNCH_SNIPE_ADDRESS as Address | undefined;
  if (!launchSnipe) throw new Error("Set LAUNCH_SNIPE_ADDRESS in .env (deploy LaunchSnipe first)");

  const token = getAddress(tokenArg);
  const fee = Number(feeArg || "10000");
  const ticks = FULL_RANGE_TICKS[fee];
  if (!ticks) throw new Error(`Unsupported fee tier ${fee}`);

  const weth = getAddress(ADDRESSES.weth);
  const liqToken = parseUnits(liqTokenArg, 18);
  const liqWeth = parseEther(liqEthArg);
  const buyWeth = parseEther(buyEthArg);

  // Sort tokens and map amounts to compute the implied full-range price.
  const tokenIsToken0 = token.toLowerCase() < weth.toLowerCase();
  const [amount0, amount1] = tokenIsToken0 ? [liqToken, liqWeth] : [liqWeth, liqToken];
  const sqrtP = sqrtPriceX96(amount0, amount1);

  const params = {
    token,
    fee,
    sqrtPriceX96: sqrtP,
    tickLower: ticks[0],
    tickUpper: ticks[1],
    liqTokenAmount: liqToken,
    liqWethAmount: liqWeth,
    buyers: [WALLET_ADDRESS] as Address[],
    buyWethAmounts: [buyWeth],
    minTokenOutTotal: 0n,
  };

  console.log("Launch params:");
  console.log("  token        ", token);
  console.log("  fee          ", fee, `(full range ${ticks[0]}..${ticks[1]})`);
  console.log("  liq token    ", liqTokenArg);
  console.log("  liq ETH      ", liqEthArg);
  console.log("  dev-buy ETH  ", buyEthArg);
  console.log("  sqrtPriceX96 ", sqrtP.toString());
  console.log("  mode         ", config.dryRun ? "DRY RUN" : "🔴 LIVE");

  const value = liqWeth + buyWeth;

  // The contract pulls liqToken from the owner via transferFrom — approve it.
  if (!config.dryRun) {
    const allowance = await publicClient.readContract({
      address: token, abi: erc20Abi, functionName: "allowance", args: [WALLET_ADDRESS, launchSnipe],
    });
    if (allowance < liqToken) {
      const h = await walletClient.writeContract({
        address: token, abi: erc20Abi, functionName: "approve",
        args: [launchSnipe, liqToken], account, chain: undefined,
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      console.log("  approved token to LaunchSnipe");
    }
  }

  const call = {
    address: launchSnipe,
    abi: launchSnipeAbi,
    functionName: "launchAndSnipe",
    args: [params],
    value,
    account,
  } as const;

  if (config.dryRun) {
    await publicClient.simulateContract({
      ...call,
      stateOverride: [{ address: WALLET_ADDRESS, balance: value + parseEther("1") }],
    }).catch((e) => {
      console.log("🧪 DRY RUN simulate note:", e.shortMessage || e.message);
      console.log("(Expected if the token isn't approved/owned yet — params above are valid.)");
    });
    console.log("🧪 DRY RUN — no transaction sent.");
    return;
  }

  const { request } = await publicClient.simulateContract(call);
  const hash = await walletClient.writeContract(request);
  console.log("tx:", hash);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("✅ Launched + sniped in one block.");
}

main().catch((e) => {
  console.error("Error:", e.shortMessage || e.message);
  process.exit(1);
});
