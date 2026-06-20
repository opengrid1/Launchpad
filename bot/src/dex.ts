import { parseEther, type Address, type Hash } from "viem";
import { publicClient, walletClient, account, WALLET_ADDRESS } from "./chain.js";
import { erc20Abi, swapRouter02Abi, wethAbi } from "./abis.js";
import { ADDRESSES, config } from "./config.js";
import { findPool, getTokenMeta, balanceOf } from "./token.js";

const MAX_UINT256 = 2n ** 256n - 1n;

export interface SwapResult {
  dryRun: boolean;
  hash?: Hash;
  amountIn: bigint;
  minOut: bigint;
  expectedOut: bigint;
  fee: number;
  symbolIn: string;
  symbolOut: string;
}

function applySlippage(expected: bigint): bigint {
  return (expected * (10_000n - config.slippageBps)) / 10_000n;
}

/** Buy `token` with `ethAmount` of native ETH (router wraps msg.value to WETH). */
export async function buy(token: Address, ethAmountStr: string): Promise<SwapResult> {
  const meta = await getTokenMeta(token);
  const pool = await findPool(token, meta.decimals);
  if (!pool) throw new Error(`No WETH pool found for ${meta.symbol}`);

  const amountIn = parseEther(ethAmountStr);
  const tokensPerEth = pool.priceInEth > 0 ? 1 / pool.priceInEth : 0;
  const expectedOut = BigInt(Math.floor(Number(ethAmountStr) * tokensPerEth * 10 ** meta.decimals));
  const minOut = applySlippage(expectedOut);

  const params = {
    tokenIn: ADDRESSES.weth as Address,
    tokenOut: token,
    fee: pool.fee,
    recipient: WALLET_ADDRESS,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  };

  const base = {
    address: ADDRESSES.swapRouter02 as Address,
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [params],
    value: amountIn,
    account,
  } as const;

  if (config.dryRun) {
    // Validate the real swap path without requiring the wallet to be funded:
    // override the account balance just for this eth_call simulation.
    await publicClient.simulateContract({
      ...base,
      stateOverride: [{ address: WALLET_ADDRESS, balance: amountIn + parseEther("1") }],
    });
    return { dryRun: true, amountIn, minOut, expectedOut, fee: pool.fee, symbolIn: "ETH", symbolOut: meta.symbol };
  }

  const { request } = await publicClient.simulateContract(base);
  const hash = await walletClient.writeContract(request);
  await publicClient.waitForTransactionReceipt({ hash });
  return { dryRun: false, hash, amountIn, minOut, expectedOut, fee: pool.fee, symbolIn: "ETH", symbolOut: meta.symbol };
}

/**
 * Sell `token` for ETH. `amount` is a token amount, or "100%"/"50%" of balance.
 * Approves the router if needed, swaps token->WETH, then unwraps WETH to ETH.
 */
export async function sell(token: Address, amount: string): Promise<SwapResult> {
  const meta = await getTokenMeta(token);
  const pool = await findPool(token, meta.decimals);
  if (!pool) throw new Error(`No WETH pool found for ${meta.symbol}`);

  const bal = await balanceOf(token, WALLET_ADDRESS);
  let amountIn: bigint;
  if (amount.trim().endsWith("%")) {
    const pct = BigInt(Math.round(parseFloat(amount)));
    amountIn = (bal * pct) / 100n;
  } else {
    amountIn = BigInt(Math.floor(parseFloat(amount) * 10 ** meta.decimals));
  }
  if (amountIn <= 0n) throw new Error("Nothing to sell");
  if (amountIn > bal) throw new Error(`Insufficient ${meta.symbol} balance`);

  const wholeIn = Number(amountIn) / 10 ** meta.decimals;
  const expectedOut = parseEther((wholeIn * pool.priceInEth).toFixed(18));
  const minOut = applySlippage(expectedOut);

  const params = {
    tokenIn: token,
    tokenOut: ADDRESSES.weth as Address,
    fee: pool.fee,
    recipient: WALLET_ADDRESS,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0n,
  };

  const swapBase = {
    address: ADDRESSES.swapRouter02 as Address,
    abi: swapRouter02Abi,
    functionName: "exactInputSingle",
    args: [params],
    account,
  } as const;

  if (config.dryRun) {
    return { dryRun: true, amountIn, minOut, expectedOut, fee: pool.fee, symbolIn: meta.symbol, symbolOut: "WETH→ETH" };
  }

  // Ensure allowance.
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [WALLET_ADDRESS, ADDRESSES.swapRouter02 as Address],
  });
  if (allowance < amountIn) {
    const approveHash = await walletClient.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [ADDRESSES.swapRouter02 as Address, MAX_UINT256],
      account,
      chain: undefined,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const { request } = await publicClient.simulateContract(swapBase);
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Unwrap received WETH to native ETH.
  const wethBal = await publicClient.readContract({
    address: ADDRESSES.weth as Address,
    abi: wethAbi,
    functionName: "balanceOf",
    args: [WALLET_ADDRESS],
  });
  if (wethBal > 0n) {
    const unwrap = await walletClient.writeContract({
      address: ADDRESSES.weth as Address,
      abi: wethAbi,
      functionName: "withdraw",
      args: [wethBal],
      account,
      chain: undefined,
    });
    await publicClient.waitForTransactionReceipt({ hash: unwrap });
  }

  void receipt;
  return { dryRun: false, hash, amountIn, minOut, expectedOut, fee: pool.fee, symbolIn: meta.symbol, symbolOut: "ETH" };
}
