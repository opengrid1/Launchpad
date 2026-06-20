import { Bot } from "grammy";
import { formatEther, getAddress, isAddress, type Address } from "viem";
import { config, DEFAULT_TOKEN, EXPLORER_URL } from "./config.js";
import { publicClient, WALLET_ADDRESS } from "./chain.js";
import { buildTokenReport } from "./report.js";
import { buy, sell, type SwapResult } from "./dex.js";
import { fmt } from "./token.js";
import { checkToken } from "./safety.js";

export function createBot() {
  if (!config.telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const bot = new Bot(config.telegramToken);

  const isAllowed = (id?: number) => !!id && config.allowedIds.includes(String(id));

  const guard = async (ctx: any): Promise<boolean> => {
    if (isAllowed(ctx.from?.id)) return true;
    await ctx.reply(
      `⛔ Not authorized to trade.\nYour Telegram ID: \`${ctx.from?.id}\`\n` +
        `Add it to TELEGRAM_ALLOWED_IDS in .env and restart.`,
      { parse_mode: "Markdown" },
    );
    return false;
  };

  const resolveToken = (arg?: string): Address => {
    if (arg && isAddress(arg)) return getAddress(arg);
    return getAddress(DEFAULT_TOKEN);
  };

  const swapReply = (r: SwapResult): string => {
    const out = fmt(r.expectedOut, 18, 6);
    const min = fmt(r.minOut, 18, 6);
    const head = r.dryRun ? "🧪 *DRY RUN* (no tx sent)" : "✅ *Swap sent*";
    const lines = [
      head,
      `${r.symbolIn} → ${r.symbolOut} @ ${r.fee / 10000}% fee`,
      `Expected out: ~${out}`,
      `Min out (slippage ${Number(config.slippageBps) / 100}%): ${min}`,
    ];
    if (r.hash) lines.push(`Tx: ${EXPLORER_URL}/tx/${r.hash}`);
    return lines.join("\n");
  };

  bot.command("start", async (ctx) => {
    const authed = isAllowed(ctx.from?.id);
    await ctx.reply(
      [
        "🤖 *Robinhood L2 Trading Bot*",
        "",
        `Wallet: \`${WALLET_ADDRESS}\``,
        `Your Telegram ID: \`${ctx.from?.id}\` ${authed ? "✅ authorized" : "⛔ not authorized"}`,
        `Mode: ${config.dryRun ? "🧪 DRY RUN" : "🔴 LIVE"}`,
        "",
        "*Commands*",
        "/wallet — balances",
        "/info [token] — full token data",
        "/check [token] — safety / honeypot check",
        "/price [token] — quick price",
        "/buy <eth> [token] — buy with ETH",
        "/sell <amount|%> [token] — sell for ETH",
        "/help — this message",
      ].join("\n"),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  });
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Send /info to see $MARIAN data, /info <address> for any token, /buy 0.01 to buy, /sell 50% to sell half.",
    );
  });

  bot.command("wallet", async (ctx) => {
    const eth = await publicClient.getBalance({ address: WALLET_ADDRESS });
    await ctx.reply(
      [
        "👛 *Wallet*",
        `\`${WALLET_ADDRESS}\``,
        `ETH: ${formatEther(eth)}`,
        "",
        `Token balances → ${EXPLORER_URL}/address/${WALLET_ADDRESS}`,
      ].join("\n"),
      { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("info", async (ctx) => {
    const arg = ctx.match?.trim();
    await ctx.replyWithChatAction("typing");
    try {
      const report = await buildTokenReport(arg && isAddress(arg) ? arg : DEFAULT_TOKEN);
      await ctx.reply(report, { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
    } catch (e: any) {
      await ctx.reply(`Error: ${e.message}`);
    }
  });

  bot.command("check", async (ctx) => {
    const arg = ctx.match?.trim();
    await ctx.replyWithChatAction("typing");
    try {
      const r = await checkToken(arg && isAddress(arg) ? arg : DEFAULT_TOKEN);
      const verdict =
        r.sellable === false ? "🚫 *LIKELY HONEYPOT*" : r.sellable ? "✅ *Sellable*" : "❓ *Unknown*";
      await ctx.reply(
        [`🔬 *Safety check — $${r.symbol}*`, verdict, "", ...r.notes.map((n) => `• ${n}`)].join("\n"),
        { parse_mode: "Markdown", link_preview_options: { is_disabled: true } },
      );
    } catch (e: any) {
      await ctx.reply(`Error: ${e.message}`);
    }
  });

  bot.command("price", async (ctx) => {
    const token = resolveToken(ctx.match?.trim());
    await ctx.replyWithChatAction("typing");
    try {
      const { getTokenMeta, findPool } = await import("./token.js");
      const { getEthUsd, usd } = await import("./usd.js");
      const meta = await getTokenMeta(token);
      const [pool, ethUsd] = await Promise.all([findPool(token, meta.decimals), getEthUsd()]);
      if (!pool) return void ctx.reply(`No pool for ${meta.symbol}`);
      const p = pool.priceInEth < 1e-6 ? pool.priceInEth.toExponential(4) : pool.priceInEth.toPrecision(6);
      const priceUsd = ethUsd ? usd(pool.priceInEth * ethUsd) : "n/a";
      await ctx.reply(`💲 $${meta.symbol}: ${priceUsd}  (${p} ETH, fee ${pool.fee / 10000}%)`);
    } catch (e: any) {
      await ctx.reply(`Error: ${e.message}`);
    }
  });

  bot.command("buy", async (ctx) => {
    if (!(await guard(ctx))) return;
    const [amount, tokenArg] = (ctx.match || "").trim().split(/\s+/);
    if (!amount || isNaN(Number(amount))) return void ctx.reply("Usage: /buy <ethAmount> [tokenAddress]");
    await ctx.replyWithChatAction("typing");
    try {
      const r = await buy(resolveToken(tokenArg), amount);
      await ctx.reply(swapReply(r), { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
    } catch (e: any) {
      await ctx.reply(`❌ ${e.shortMessage || e.message}`);
    }
  });

  bot.command("sell", async (ctx) => {
    if (!(await guard(ctx))) return;
    const [amount, tokenArg] = (ctx.match || "").trim().split(/\s+/);
    if (!amount) return void ctx.reply("Usage: /sell <amount|percent%> [tokenAddress]");
    await ctx.replyWithChatAction("typing");
    try {
      const r = await sell(resolveToken(tokenArg), amount);
      await ctx.reply(swapReply(r), { parse_mode: "Markdown", link_preview_options: { is_disabled: true } });
    } catch (e: any) {
      await ctx.reply(`❌ ${e.shortMessage || e.message}`);
    }
  });

  bot.catch((err) => console.error("[bot] error", err));
  return bot;
}
