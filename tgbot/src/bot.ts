/** The Telegram side: screens, inline keyboards, and the buy/sell flows. */
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";

import { ago, COIN_STORAGE, fillPlaceholders, fmt, getHolder, getInfo, liquidity, listCoins, NEAR, nearUsd, pairDec, pairSym, pairUsd, planBuy, planSell, resolveCoin, toUnits, units, usd, yocto, type Coin, type Info } from "./chipfi.js";
import { config } from "./config.js";
import { balanceOf, ensureUser, friendlyError, ftBalance, run, secretKeyOf, sendNear, txUrl } from "./near.js";
import { coinImage, LOGO } from "./image.js";
import { allUsers, updateUser, type User } from "./store.js";

export const bot = new Bot(config.botToken);

type Pending = { kind: "buyx" | "sellx" | "withdraw" | "presets"; acct?: string };
const pending = new Map<number, Pending>();
const busy = new Set<number>();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (bps: number) => `${bps / 100}%`;
const short = (a: string) => (a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

// ---- screens -------------------------------------------------------------

async function homeText(u: User) {
  const [bal, px] = await Promise.all([balanceOf(u.accountId), nearUsd()]);
  return [
    `<b>Chipfi Bot</b>`,
    ``,
    `Paste a coin to trade it: its address like <code>c1.chipfi.near</code>, its symbol like <code>CHIP</code>, or a chipfi.fun link.`,
    ``,
    `💼 <b>W1</b> ${fmt(units(bal, 24), 3)} NEAR${px ? ` (${usd(units(bal, 24) * px)})` : ""}`,
    `<code>${u.accountId}</code>`,
    bal === 0n ? `\nSend NEAR to that address to start. It is your own wallet inside the bot.` : ``,
  ].join("\n");
}

const homeKb = () => new InlineKeyboard().text("💼 Wallet", "wallet").text("🪙 Coins", "coins").row().text("⚙️ Settings", "settings").text("❓ Help", "help");

async function coinCard(u: User, coin: Coin, i: Info) {
  const dec = pairDec(i.pair); const sym = pairSym(i.pair);
  const [liq, pUsd, nUsd, h, bal] = await Promise.all([liquidity(i), pairUsd(i.pair), nearUsd(), getHolder(coin.account_id, u.accountId), balanceOf(u.accountId)]);
  const price = units(i.price, dec);
  const mcap = units(i.market_cap, dec) * pUsd;
  // Same measure as the site: tokens sold out of the curve supply.
  const progress = i.pool_id != null ? null : Math.min(100, (units(i.tokens_sold, 18) / units(i.curve_supply, 18)) * 100);
  const mine = BigInt(h.balance); const mineVal = units(mine, 18) * price * pUsd;
  const claimable = BigInt(h.claimable_dividends) + BigInt(h.credit);
  const s = i.split;
  const lines = [
    `<b>${esc(i.symbol)}</b> · ${esc(i.name)}`,
    `<code>${coin.account_id}</code>`,
    ``,
    `<b>Pool</b>`,
    `🏦 ${i.pool_id != null ? `Rhea pool #${i.pool_id}` : `Curve · <b>${progress!.toFixed(1)}%</b> sold · ${fmt(units(i.raised, dec), 1)} / ${fmt(units(i.graduation, dec), 0)} ${sym} raised`} · pair <b>${sym}</b>`,
    `📊 Mcap: <b>${usd(mcap)}</b>`,
    `💧 Liq: <b>${usd(units(liq, dec) * pUsd)}</b>`,
    ``,
    `<b>Token</b>`,
    `🧾 Tax: B <b>${pct(i.buy_tax_bps)}</b> | S <b>${pct(i.sell_tax_bps)}</b>`,
    `💸 Split: ${pct(s.dividends_bps)} holders · ${pct(s.creator_bps)} creator · ${pct(s.burn_bps)} burn · ${pct(s.liquidity_bps)} LP`,
    `👥 Holders: <b>${i.holders}</b> · Trades: <b>${i.trades}</b> · Age: ${ago(i.created_at_ms)}`,
    `🎁 Paid to holders: ${fmt(units(i.dividends_total, dec), 3)} ${sym}`,
    `👤 Creator: <code>${short(i.creator)}</code>`,
    ``,
    `💼 <b>W1</b> ${fmt(units(bal, 24), 3)} NEAR${nUsd ? ` (${usd(units(bal, 24) * nUsd)})` : ""}`,
    mine > 0n || claimable > 0n
      ? `🪙 You: <b>${fmt(units(mine, 18))} ${esc(i.symbol)}</b> (${usd(mineVal)})${claimable > 0n ? ` · claimable ${fmt(units(claimable, dec), 4)} ${sym}` : ""}`
      : `🪙 You hold none yet.`,
  ];
  return lines.join("\n");
}

function coinKb(u: User, coin: Coin, i: Info) {
  const a = coin.account_id;
  const kb = new InlineKeyboard();
  const graduating = i.phase === "Graduating";
  if (!graduating) {
    for (const p of u.presets) kb.text(`Buy ${p} NEAR`, `buy:${a}:${p}`);
    kb.row().text("Buy X NEAR", `buyx:${a}`).row();
    kb.text("Sell 25%", `sell:${a}:25`).text("Sell 50%", `sell:${a}:50`).text("Sell 100%", `sell:${a}:100`).row();
  } else {
    kb.text("⏳ Graduating: open the pool", `open:${a}`).row();
  }
  kb.text(`Slippage ${pct(u.slippageBps)}`, `slip:${a}`).text("Claim", `claim:${a}`).text("🔄 Refresh", `coin:${a}`).row();
  kb.url("📈 Chart", `${config.siteUrl}/t/${a}`).url("🌐 Chipfi", config.siteUrl).text("💼 Wallet", "wallet");
  return kb;
}

async function showCoin(ctx: Context, u: User, coin: Coin, edit = false) {
  const i = await getInfo(coin.account_id);
  const text = await coinCard(u, coin, i);
  const kb = coinKb(u, coin, i);
  const msg = ctx.callbackQuery?.message;
  // A refresh keeps the photo and rewrites the caption; anything else is a new card.
  if (edit && msg && "photo" in msg) {
    const ok = await ctx.editMessageCaption({ caption: text, parse_mode: "HTML", reply_markup: kb }).then(() => true).catch(() => false);
    if (ok) return;
  }
  const photo = new InputFile(await coinImage(i.icon), `${i.symbol}.png`);
  const sent = await ctx.replyWithPhoto(photo, { caption: text, parse_mode: "HTML", reply_markup: kb }).then(() => true).catch(() => false);
  if (!sent) await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
}

async function walletText(u: User) {
  const [bal, nUsd, coins] = await Promise.all([balanceOf(u.accountId), nearUsd(), listCoins()]);
  const rows: string[] = [];
  let total = units(bal, 24) * nUsd;
  await Promise.all(coins.map(async (c) => {
    const h = await getHolder(c.account_id, u.accountId);
    const mine = BigInt(h.balance); const claimable = BigInt(h.claimable_dividends) + BigInt(h.credit);
    if (mine === 0n && claimable === 0n) return;
    const i = await getInfo(c.account_id);
    const pUsd = await pairUsd(i.pair); const dec = pairDec(i.pair);
    const val = units(mine, 18) * units(i.price, dec) * pUsd; total += val;
    rows.push(`• <b>${esc(c.symbol)}</b> ${fmt(units(mine, 18))} (${usd(val)})${claimable > 0n ? ` · claimable ${fmt(units(claimable, dec), 4)} ${pairSym(i.pair)}` : ""}`);
  }));
  return [
    `<b>💼 Wallet W1</b>`,
    `<code>${u.accountId}</code>`,
    ``,
    `NEAR: <b>${fmt(units(bal, 24), 4)}</b>${nUsd ? ` (${usd(units(bal, 24) * nUsd)})` : ""}`,
    rows.length ? `\n<b>Positions</b>\n${rows.join("\n")}` : `\nNo positions yet. Paste a coin to buy.`,
    `\nTotal: <b>${usd(total)}</b>`,
    `\nDeposit: send NEAR to the address above from any wallet or exchange.`,
  ].join("\n");
}

const walletKb = () => new InlineKeyboard().text("📤 Withdraw", "withdraw").text("🔑 Export key", "export").row().text("🔄 Refresh", "wallet").text("🪙 Coins", "coins").text("🏠 Home", "home");

async function coinsText() {
  const coins = await listCoins(true);
  const nUsd = await nearUsd();
  const rows = await Promise.all(coins.map(async (c) => {
    const i = await getInfo(c.account_id).catch(() => null);
    if (!i) return null;
    const pUsd = i.pair === "Near" ? nUsd : await pairUsd(i.pair);
    const mcap = units(i.market_cap, pairDec(i.pair)) * pUsd;
    return { c, i, mcap };
  }));
  const list = rows.filter((r): r is NonNullable<typeof r> => !!r).sort((a, b) => b.mcap - a.mcap);
  const kb = new InlineKeyboard();
  list.forEach((r, k) => { kb.text(`${r.c.symbol} · ${usd(r.mcap)}`, `coin:${r.c.account_id}`); if (k % 2 === 1) kb.row(); });
  kb.row().text("🏠 Home", "home");
  const text = [`<b>🪙 Coins on Chipfi</b>`, ``, ...list.map((r) => `<b>${esc(r.c.symbol)}</b> · ${usd(r.mcap)} · ${r.i.pool_id != null ? "Rhea" : "curve"} · pair ${pairSym(r.i.pair)} · ${r.i.holders} holders`)].join("\n");
  return { text, kb };
}

const settingsText = (u: User) => [`<b>⚙️ Settings</b>`, ``, `Slippage: <b>${pct(u.slippageBps)}</b>`, `Buy presets: <b>${u.presets.join(", ")} NEAR</b>`].join("\n");
const settingsKb = (u: User) => {
  const kb = new InlineKeyboard();
  for (const s of [100, 300, 500, 1000, 2000]) kb.text(`${s === u.slippageBps ? "• " : ""}${pct(s)}`, `setslip:${s}`);
  return kb.row().text("Edit presets", "presets").text("🏠 Home", "home");
};

const HELP = [
  `<b>How it works</b>`,
  ``,
  `1. The bot made you a NEAR wallet. Send NEAR to it.`,
  `2. Paste a coin (address, symbol or chipfi.fun link) and tap Buy.`,
  `3. Sell any time. Coins on the curve pay your NEAR back in the same transaction; on Rhea it comes back through the pool.`,
  ``,
  `Coins paired with a stock (like JENSEN on NVDAon) are bought in two hops: NEAR turns into the stock on Rhea, then the stock buys the coin. Sells go the other way.`,
  ``,
  `Every trade pays the coin's tax, and the holders share means you get paid on other people's trades. Tap <b>Claim</b> to pull your dividends.`,
  ``,
  `Your key is encrypted on the bot's server. Export it any time to use the wallet elsewhere. Keep the export private.`,
].join("\n");

// ---- helpers -------------------------------------------------------------

/** Rewrites a text message in place; a photo message gets a new message instead. */
async function editOrReply(ctx: Context, text: string, kb: InlineKeyboard) {
  const m = ctx.callbackQuery?.message;
  if (m && !("photo" in m)) { const ok = await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } }).then(() => true).catch(() => false); if (ok) return; }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
}

async function withLock(ctx: Context, u: User, f: () => Promise<void>) {
  if (busy.has(u.tgId)) { await ctx.answerCallbackQuery?.({ text: "One trade at a time.", show_alert: false }).catch(() => {}); return; }
  busy.add(u.tgId);
  try { await f(); } finally { busy.delete(u.tgId); }
}

async function doBuy(ctx: Context, u: User, acct: string, nearAmt: string) {
  const nearIn = yocto(nearAmt);
  if (nearIn <= 0n) return void (await ctx.reply("Amount must be a number of NEAR."));
  const coin = await resolveCoin(acct);
  if (!coin) return void (await ctx.reply("That coin is gone."));
  const [bal, i] = await Promise.all([balanceOf(u.accountId), getInfo(acct)]);
  const reserve = 5n * 10n ** 22n; // 0.05 NEAR for gas and storage
  if (bal < nearIn + reserve) return void (await ctx.reply(`Not enough NEAR. You have ${fmt(units(bal, 24), 4)}, and the bot keeps 0.05 for gas.`));
  if (i.pool_id == null && i.pair === "Near" && nearIn <= COIN_STORAGE) return void (await ctx.reply("Too small: a first buy needs more than 0.004 NEAR."));
  const m = await ctx.reply(`⏳ Buying ${esc(i.symbol)} with ${nearAmt} NEAR…`, { parse_mode: "HTML" });
  try {
    const plan = await planBuy(u, acct, i, nearIn);
    const stock = i.pair === "Near" ? undefined : i.pair.Token.account_id;
    const before = { stock: stock ? await ftBalance(stock, u.accountId) : 0n };
    const had = BigInt((await getHolder(acct, u.accountId)).balance);
    let last;
    for (const step of plan.steps) last = await run(u, await fillPlaceholders(u, step, before, stock));
    const got = BigInt((await getHolder(acct, u.accountId)).balance) - had;
    const hash = last?.transaction.hash as string;
    await ctx.api.editMessageText(m.chat.id, m.message_id, [
      `✅ <b>Bought ${fmt(units(got, 18))} ${esc(i.symbol)}</b> for ${nearAmt} NEAR ${plan.note}.`,
      `<a href="${txUrl(hash)}">tx</a> · ${await positionLine(u, acct)}`,
    ].join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ Buy failed: ${esc(friendlyError(e))}`, { parse_mode: "HTML" });
  }
  await showCoin(ctx, u, coin);
}

async function doSell(ctx: Context, u: User, acct: string, pctOrAmt: string) {
  const coin = await resolveCoin(acct);
  if (!coin) return void (await ctx.reply("That coin is gone."));
  const [i, h] = await Promise.all([getInfo(acct), getHolder(acct, u.accountId)]);
  const have = BigInt(h.balance);
  if (have === 0n) return void (await ctx.reply(`You hold no ${esc(i.symbol)}.`, { parse_mode: "HTML" }));
  const p = Number(pctOrAmt);
  if (!(p > 0 && p <= 100)) return void (await ctx.reply("Give a percent between 1 and 100."));
  const tokens = p === 100 ? have : (have * BigInt(Math.round(p * 100))) / 10000n;
  const m = await ctx.reply(`⏳ Selling ${p}% of your ${esc(i.symbol)}…`, { parse_mode: "HTML" });
  try {
    const plan = await planSell(u, acct, i, tokens);
    const stock = i.pair === "Near" ? undefined : i.pair.Token.account_id;
    const before = { stock: stock ? await ftBalance(stock, u.accountId) : 0n };
    const nearBefore = await balanceOf(u.accountId);
    let last;
    for (const step of plan.steps) { const filled = await fillPlaceholders(u, step, before, stock); if (filled.length) last = await run(u, filled); }
    const nearAfter = await balanceOf(u.accountId);
    const delta = nearAfter - nearBefore;
    const hash = last?.transaction.hash as string;
    await ctx.api.editMessageText(m.chat.id, m.message_id, [
      `✅ <b>Sold ${fmt(units(tokens, 18))} ${esc(i.symbol)}</b> ${plan.note}.`,
      plan.nearOut != null ? `Wallet change: <b>${delta >= 0n ? "+" : ""}${fmt(units(delta, 24), 4)} NEAR</b> after gas.` : `Received about ${fmt(units(plan.pairOut, pairDec(i.pair)), 4)} ${pairSym(i.pair)}.`,
      `<a href="${txUrl(hash)}">tx</a> · ${await positionLine(u, acct)}`,
    ].join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ Sell failed: ${esc(friendlyError(e))}`, { parse_mode: "HTML" });
  }
  await showCoin(ctx, u, coin);
}

async function positionLine(u: User, acct: string) {
  const [h, bal] = await Promise.all([getHolder(acct, u.accountId), balanceOf(u.accountId)]);
  return `you hold ${fmt(units(BigInt(h.balance), 18))} · W1 ${fmt(units(bal, 24), 3)} NEAR`;
}

// ---- commands ------------------------------------------------------------

bot.command("start", async (ctx) => {
  const u = ensureUser(ctx.from!.id);
  const payload = ctx.match?.trim();
  if (payload) { const c = await resolveCoin(payload); if (c) return showCoin(ctx, u, c); }
  await ctx.replyWithPhoto(new InputFile(LOGO, "chipfi.png"), { caption: await homeText(u), parse_mode: "HTML", reply_markup: homeKb() });
});
bot.command("wallet", async (ctx) => { const u = ensureUser(ctx.from!.id); await ctx.reply(await walletText(u), { parse_mode: "HTML", reply_markup: walletKb() }); });
bot.command("coins", async (ctx) => { ensureUser(ctx.from!.id); const { text, kb } = await coinsText(); await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb }); });
bot.command("settings", async (ctx) => { const u = ensureUser(ctx.from!.id); await ctx.reply(settingsText(u), { parse_mode: "HTML", reply_markup: settingsKb(u) }); });
bot.command("help", async (ctx) => { await ctx.reply(HELP, { parse_mode: "HTML" }); });
bot.command("buy", async (ctx) => {
  const u = ensureUser(ctx.from!.id);
  const [what, amt] = (ctx.match ?? "").trim().split(/\s+/);
  const c = what ? await resolveCoin(what) : null;
  if (!c) return ctx.reply("Usage: /buy CHIP 5");
  if (!amt) return showCoin(ctx, u, c);
  await withLock(ctx, u, () => doBuy(ctx, u, c.account_id, amt));
});
bot.command("sell", async (ctx) => {
  const u = ensureUser(ctx.from!.id);
  const [what, p] = (ctx.match ?? "").trim().split(/\s+/);
  const c = what ? await resolveCoin(what) : null;
  if (!c) return ctx.reply("Usage: /sell CHIP 50   (percent of what you hold)");
  await withLock(ctx, u, () => doSell(ctx, u, c.account_id, p ?? "100"));
});

bot.command("stats", async (ctx) => {
  if (!config.admins.includes(ctx.from!.id)) return void (await ctx.reply(`Admin only. Your Telegram id is <code>${ctx.from!.id}</code>.`, { parse_mode: "HTML" }));
  const users = allUsers();
  const nUsd = await nearUsd();
  const bals = await Promise.all(users.map(async (u) => ({ u, bal: await balanceOf(u.accountId) })));
  const funded = bals.filter((b) => b.bal > 0n);
  const total = funded.reduce((a, b) => a + b.bal, 0n);
  const day = Date.now() - 86_400_000;
  const lines = [
    `<b>📊 Bot stats</b>`,
    `Users: <b>${users.length}</b> · new last 24h: <b>${users.filter((u) => u.createdAt > day).length}</b>`,
    `Funded wallets: <b>${funded.length}</b>`,
    `NEAR held in bot wallets: <b>${fmt(units(total, 24), 3)}</b>${nUsd ? ` (${usd(units(total, 24) * nUsd)})` : ""}`,
    ``,
    ...funded.sort((a, b) => (b.bal > a.bal ? 1 : -1)).slice(0, 10).map((b) => `• <code>${short(b.u.accountId)}</code> ${fmt(units(b.bal, 24), 3)} NEAR · joined ${ago(b.u.createdAt)} ago`),
  ];
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

// ---- callbacks -----------------------------------------------------------

bot.on("callback_query:data", async (ctx) => {
  const u = ensureUser(ctx.from.id);
  const [op, a, b] = ctx.callbackQuery.data.split(":");
  await ctx.answerCallbackQuery().catch(() => {});
  switch (op) {
    case "home": {
      const t = await homeText(u);
      const m = ctx.callbackQuery.message;
      if (m && "photo" in m) return void ctx.editMessageCaption({ caption: t, parse_mode: "HTML", reply_markup: homeKb() }).catch(() => {});
      return void ctx.editMessageText(t, { parse_mode: "HTML", reply_markup: homeKb() }).catch(() => {});
    }
    case "wallet": return void editOrReply(ctx, await walletText(u), walletKb());
    case "coins": { const { text, kb } = await coinsText(); return void editOrReply(ctx, text, kb); }
    case "settings": return void editOrReply(ctx, settingsText(u), settingsKb(u));
    case "help": return void ctx.reply(HELP, { parse_mode: "HTML" });
    case "coin": { const c = await resolveCoin(a); if (c) await showCoin(ctx, u, c, true); return; }
    case "buy": return withLock(ctx, u, () => doBuy(ctx, u, a, b));
    case "sell": return withLock(ctx, u, () => doSell(ctx, u, a, b));
    case "buyx": pending.set(u.tgId, { kind: "buyx", acct: a }); return void ctx.reply("How much NEAR? Send a number, like <code>2.5</code>.", { parse_mode: "HTML" });
    case "sellx": pending.set(u.tgId, { kind: "sellx", acct: a }); return void ctx.reply("What percent to sell? Send a number from 1 to 100.");
    case "slip": { const next = [100, 300, 500, 1000, 2000]; const k = next.indexOf(u.slippageBps); updateUser(u.tgId, { slippageBps: next[(k + 1) % next.length] }); const c = await resolveCoin(a); if (c) await showCoin(ctx, ensureUser(u.tgId), c, true); return; }
    case "setslip": updateUser(u.tgId, { slippageBps: Number(a) }); { const nu = ensureUser(u.tgId); return void ctx.editMessageText(settingsText(nu), { parse_mode: "HTML", reply_markup: settingsKb(nu) }).catch(() => {}); }
    case "presets": pending.set(u.tgId, { kind: "presets" }); return void ctx.reply("Send three amounts in NEAR, like <code>1 5 10</code>.", { parse_mode: "HTML" });
    case "claim": return withLock(ctx, u, async () => {
      const c = await resolveCoin(a); if (!c) return;
      const m = await ctx.reply("⏳ Claiming…");
      try { const r = await run(u, [{ receiverId: a, method: "claim", args: {}, gas: 60n * 10n ** 12n }]); await ctx.api.editMessageText(m.chat.id, m.message_id, `✅ Claimed. <a href="${txUrl(r.transaction.hash)}">tx</a>`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }); }
      catch (e) { await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ ${esc(friendlyError(e))}`, { parse_mode: "HTML" }); }
      await showCoin(ctx, u, c);
    });
    case "open": return withLock(ctx, u, async () => {
      const c = await resolveCoin(a); if (!c) return;
      const i = await getInfo(a);
      const m = await ctx.reply("⏳ Opening the pool on Rhea…");
      try { const r = await run(u, [{ receiverId: a, method: "open_pool", args: {}, deposit: i.pair === "Near" ? 0n : 2n * 10n ** 23n, gas: 300n * 10n ** 12n }]); await ctx.api.editMessageText(m.chat.id, m.message_id, `✅ Pool step done. <a href="${txUrl(r.transaction.hash)}">tx</a>`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }); }
      catch (e) { await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ ${esc(friendlyError(e))}`, { parse_mode: "HTML" }); }
      await showCoin(ctx, u, c);
    });
    case "withdraw": pending.set(u.tgId, { kind: "withdraw" }); return void ctx.reply("Send the amount and the address, like <code>1.5 alice.near</code>. Use <code>all</code> to send everything but gas.", { parse_mode: "HTML" });
    case "export": {
      const m = await ctx.reply([`🔑 <b>Your private key</b>`, `<code>${secretKeyOf(u)}</code>`, ``, `Anyone with this key controls the wallet. Import it into Meteor or HOT to use it outside the bot, then delete this message. It disappears in 60 seconds.`].join("\n"), { parse_mode: "HTML" });
      setTimeout(() => ctx.api.deleteMessage(m.chat.id, m.message_id).catch(() => {}), 60_000);
      return;
    }
  }
});

// ---- free text: coins and pending answers -------------------------------

bot.on("message:text", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const u = ensureUser(ctx.from.id);
  const text = ctx.message.text.trim();
  const p = pending.get(u.tgId);
  if (p) {
    pending.delete(u.tgId);
    if (p.kind === "buyx" && p.acct) return withLock(ctx, u, () => doBuy(ctx, u, p.acct!, text.replace(/[^0-9.]/g, "")));
    if (p.kind === "sellx" && p.acct) return withLock(ctx, u, () => doSell(ctx, u, p.acct!, text.replace(/[^0-9.]/g, "")));
    if (p.kind === "presets") {
      const nums = text.split(/[\s,]+/).map(Number).filter((n) => n > 0).slice(0, 3);
      if (nums.length !== 3) return ctx.reply("Three numbers, please.");
      updateUser(u.tgId, { presets: nums });
      return ctx.reply(`Presets: ${nums.join(", ")} NEAR.`);
    }
    if (p.kind === "withdraw") {
      const [amt, to] = text.split(/\s+/);
      if (!to || !/^[a-z0-9._-]+$/.test(to)) return ctx.reply("Format: <code>1.5 alice.near</code>", { parse_mode: "HTML" });
      const bal = await balanceOf(u.accountId);
      const keep = 2n * 10n ** 22n; // 0.02 NEAR stays for the account
      const amount = amt === "all" ? (bal > keep ? bal - keep : 0n) : yocto(amt);
      if (amount <= 0n || amount + keep > bal) return ctx.reply(`You can send up to ${fmt(units(bal > keep ? bal - keep : 0n, 24), 4)} NEAR.`);
      return withLock(ctx, u, async () => {
        try { const r = await sendNear(u, to, amount); await ctx.reply(`✅ Sent ${fmt(units(amount, 24), 4)} NEAR to <code>${esc(to)}</code>. <a href="${txUrl(r.transaction.hash)}">tx</a>`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } }); }
        catch (e) { await ctx.reply(`❌ ${esc(friendlyError(e))}`, { parse_mode: "HTML" }); }
      });
    }
  }
  const c = await resolveCoin(text);
  if (c) return showCoin(ctx, u, c);
  await ctx.reply("I don't know that coin. Paste its address, symbol, or chipfi.fun link, or tap Coins.", { reply_markup: new InlineKeyboard().text("🪙 Coins", "coins") });
});

bot.catch((err) => { console.error("bot error", err.error instanceof Error ? err.error.message : err.error); });

export async function setCommands() {
  await bot.api.setMyCommands([
    { command: "start", description: "Home and your wallet" },
    { command: "coins", description: "Coins on Chipfi" },
    { command: "buy", description: "/buy CHIP 5" },
    { command: "sell", description: "/sell CHIP 50" },
    { command: "wallet", description: "Balance, positions, withdraw" },
    { command: "settings", description: "Slippage and presets" },
    { command: "help", description: "How it works" },
  ]);
}

export { NEAR, toUnits };
