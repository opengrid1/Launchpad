import { formatUnits, getAddress, type Address } from "viem";
import { getTokenMeta, findPool, balanceOf, fmt } from "./token.js";
import { explorer } from "./explorer.js";
import { WALLET_ADDRESS } from "./chain.js";
import { EXPLORER_URL } from "./config.js";

/**
 * Aggregate "all data" about a token from three sources:
 *  1. On-chain ERC-20 reads (authoritative: name/symbol/decimals/supply/balance)
 *  2. The Uniswap-V3 pool (live price + liquidity)
 *  3. Blockscout API (holders count, recent transfers, market metadata)
 */
export async function buildTokenReport(tokenAddr: string): Promise<string> {
  const token = getAddress(tokenAddr) as Address;
  const meta = await getTokenMeta(token);

  const [pool, myBal, exTok, holders, transfers] = await Promise.all([
    findPool(token, meta.decimals).catch(() => null),
    balanceOf(token, WALLET_ADDRESS).catch(() => 0n),
    explorer.token(token).catch(() => null),
    explorer.holders(token).catch(() => null),
    explorer.transfers(token).catch(() => null),
  ]);

  const lines: string[] = [];
  lines.push(`📊 *${meta.name}* ($${meta.symbol})`);
  lines.push("`" + meta.address + "`");
  lines.push("");
  lines.push(`• Decimals: ${meta.decimals}`);
  lines.push(`• Total supply: ${fmt(meta.totalSupply, meta.decimals, 0)}`);
  if (exTok?.holders_count) lines.push(`• Holders: ${exTok.holders_count}`);

  if (pool) {
    const priceStr = pool.priceInEth < 1e-6 ? pool.priceInEth.toExponential(4) : pool.priceInEth.toPrecision(6);
    const mcapEth = pool.priceInEth * Number(formatUnits(meta.totalSupply, meta.decimals));
    lines.push("");
    lines.push(`💧 *Pool* (fee ${pool.fee / 10000}%)`);
    lines.push(`• Price: ${priceStr} ETH`);
    lines.push(`• FDV: ${mcapEth.toPrecision(6)} ETH`);
    lines.push(`• Pool: \`${pool.pool}\``);
  } else {
    lines.push("");
    lines.push("💧 No active WETH pool found.");
  }

  lines.push("");
  lines.push(`👛 Your balance: ${fmt(myBal, meta.decimals)} ${meta.symbol}`);

  if (holders?.items?.length) {
    lines.push("");
    lines.push("🏆 *Top holders*");
    holders.items.slice(0, 5).forEach((h, i) => {
      const tag = h.address.name ? ` (${h.address.name})` : h.address.is_contract ? " (contract)" : "";
      lines.push(`${i + 1}. \`${h.address.hash.slice(0, 10)}…\`${tag} — ${fmt(BigInt(h.value), meta.decimals, 0)}`);
    });
  }

  if (transfers?.items?.length) {
    lines.push("");
    lines.push("🔄 *Recent transfers*");
    transfers.items.slice(0, 3).forEach((t) => {
      const amt = fmt(BigInt(t.total.value), Number(t.total.decimals), 2);
      lines.push(`• ${t.method || "transfer"} ${amt} — \`${t.transaction_hash.slice(0, 10)}…\``);
    });
  }

  lines.push("");
  lines.push(`🔎 ${EXPLORER_URL}/token/${meta.address}`);
  return lines.join("\n");
}
