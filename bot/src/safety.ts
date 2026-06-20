import {
  encodeAbiParameters,
  keccak256,
  pad,
  toHex,
  parseEther,
  formatEther,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { publicClient, WALLET_ADDRESS } from "./chain.js";
import { erc20Abi, swapRouter02Abi } from "./abis.js";
import { ADDRESSES } from "./config.js";
import { getTokenMeta, findPool } from "./token.js";

const MAGIC = 0x123456789abcdefn;
const MAX_UINT256 = 2n ** 256n - 1n;

const mapSlot = (key: Address, slot: bigint): Hex =>
  keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, slot]));

const nestedSlot = (owner: Address, spender: Address, slot: bigint): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [spender, mapSlot(owner, slot)],
    ),
  );

/** Brute-force the storage slot backing balanceOf (standard Solidity layout). */
async function findBalanceSlot(token: Address): Promise<bigint | null> {
  for (let slot = 0n; slot < 30n; slot++) {
    const key = mapSlot(WALLET_ADDRESS, slot);
    try {
      const v = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [WALLET_ADDRESS],
        stateOverride: [{ address: token, stateDiff: [{ slot: key, value: pad(toHex(MAGIC)) }] }],
      });
      if (v === MAGIC) return slot;
    } catch {
      /* keep probing */
    }
  }
  return null;
}

/** Brute-force the storage slot backing allowance[owner][spender]. */
async function findAllowanceSlot(token: Address, spender: Address): Promise<bigint | null> {
  for (let slot = 0n; slot < 30n; slot++) {
    const key = nestedSlot(WALLET_ADDRESS, spender, slot);
    try {
      const v = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [WALLET_ADDRESS, spender],
        stateOverride: [{ address: token, stateDiff: [{ slot: key, value: pad(toHex(MAGIC)) }] }],
      });
      if (v === MAGIC) return slot;
    } catch {
      /* keep probing */
    }
  }
  return null;
}

export interface SafetyReport {
  symbol: string;
  verified: boolean;
  sellable: boolean | null; // null = couldn't determine
  sellTaxPct: number | null;
  notes: string[];
}

/**
 * "Read" an unverified token by behaviour: simulate selling a test amount with
 * fabricated balance + allowance, and compare the WETH received against the
 * pool's spot price to estimate any transfer/sell tax. No real funds needed.
 */
export async function checkToken(tokenAddr: string): Promise<SafetyReport> {
  const token = getAddress(tokenAddr) as Address;
  const meta = await getTokenMeta(token);
  const notes: string[] = [];

  // Source-verification status from the explorer.
  let verified = false;
  try {
    const res = (await fetch(
      `https://so-explorer.poptyedev.com/api/v2/addresses/${token}`,
    ).then((r) => r.json())) as { is_verified?: boolean };
    verified = !!res.is_verified;
  } catch {
    /* ignore */
  }
  notes.push(verified ? "Source is verified on the explorer." : "⚠️ Source is NOT verified — bytecode only.");

  const pool = await findPool(token, meta.decimals);
  if (!pool) {
    notes.push("No WETH pool — cannot trade.");
    return { symbol: meta.symbol, verified, sellable: null, sellTaxPct: null, notes };
  }

  const balanceSlot = await findBalanceSlot(token);
  const allowanceSlot = await findAllowanceSlot(token, ADDRESSES.swapRouter02 as Address);
  if (balanceSlot === null || allowanceSlot === null) {
    notes.push("Non-standard storage layout — couldn't fabricate a sell simulation.");
    return { symbol: meta.symbol, verified, sellable: null, sellTaxPct: null, notes };
  }

  // Test sell: 0.1% of supply (kept small to limit price impact in the estimate).
  const amountIn = meta.totalSupply / 1000n;
  const balKey = mapSlot(WALLET_ADDRESS, balanceSlot);
  const allowKey = nestedSlot(WALLET_ADDRESS, ADDRESSES.swapRouter02 as Address, allowanceSlot);

  try {
    const amountOut = await publicClient.simulateContract({
      address: ADDRESSES.swapRouter02 as Address,
      abi: swapRouter02Abi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: token,
          tokenOut: ADDRESSES.weth as Address,
          fee: pool.fee,
          recipient: WALLET_ADDRESS,
          amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        },
      ],
      account: WALLET_ADDRESS,
      stateOverride: [
        {
          address: token,
          stateDiff: [
            { slot: balKey, value: pad(toHex(amountIn * 2n)) },
            { slot: allowKey, value: pad(toHex(MAX_UINT256)) },
          ],
        },
      ],
    }).then((r) => r.result as bigint);

    const wholeIn = Number(amountIn) / 10 ** meta.decimals;
    const expectedOut = wholeIn * pool.priceInEth; // ETH, ignoring price impact
    const gotOut = Number(formatEther(amountOut));
    // Sell tax ≈ shortfall beyond the pool's own fee tier.
    const shortfall = expectedOut > 0 ? 1 - gotOut / expectedOut : 0;
    const sellTaxPct = Math.max(0, shortfall * 100 - pool.fee / 10000);

    notes.push(`Sell simulation succeeded: ${expectedOut.toPrecision(4)} ETH expected, ${gotOut.toPrecision(4)} ETH out.`);
    if (sellTaxPct > 1) notes.push(`⚠️ Estimated sell tax/impact ~${sellTaxPct.toFixed(1)}%.`);
    return { symbol: meta.symbol, verified, sellable: true, sellTaxPct, notes };
  } catch (e: any) {
    notes.push(`🚫 Sell simulation reverted — possible honeypot. ${e.shortMessage || e.message}`);
    return { symbol: meta.symbol, verified, sellable: false, sellTaxPct: null, notes };
  }
}
