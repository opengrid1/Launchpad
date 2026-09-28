/** The Telegram side: screens, inline keyboards, and the buy/sell flows. */
import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";

import { ago, COIN_STORAGE, fillPlaceholders, fmt, getHolder, getInfo, liquidity, listCoins, NEAR, nearUsd, pairDec, pairSym, pairUsd, planBuy, planSell, resolveCoin, toUnits, units, usd, yocto, type Coin, type Info } from "./chipfi.js";
import { config } from "./config.js";
import { balanceOf, ensureUser, friendlyError, ftBalance, importKey, newWallet, run, secretKeyOf, sendNear, txUrl } from "./near.js";
import { coinImage, LOGO } from "./image.js";
import { activate, allUsers, removeWallet, tokenAlias, tokenFromAlias, updateUser, type User } from "./store.js";
import { looksLikeAccount, planTokenBuy, planTokenSell, rheaUrl, tokenMeta, tokenPriceNear, type TokenMeta } from "./tokens.js";

export const bot = new Bot(config.botToken);

type Pending =
  | { kind: "buyx" | "sellx"; acct: string }
  | { kind: "tbuyx" | "tsellx"; token: string }
  | { kind: "withdraw" | "presets" | "import" }
  | { kind: "importpick"; secret: string; choices: string[] };
const pending = new Map<number, Pending>();
const busy = new Set<number>();

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (bps: number) => `${bps / 100}%`;
const short = (a: string) => (a.length > 20 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);
const wl = (u: User) => u.wallets[u.active]?.label ?? "W1";

// ---- screens -------------------------------------------------------------

async function homeText(u: User) {
  const [bal, px] = await Promise.all([balanceOf(u.accountId), nearUsd()]);
  return [
    `<b>Chipfi Bot</b>`,
    ``,
    `Paste any NEAR token to trade it: a Chipfi coin like <code>CHIP</code>, or any token address like <code>blackdragon.tkn.near</code>.`,
    ``,
    `💼 <b>${wl(u)}</b> ${fmt(units(bal, 24), 3)} NEAR${px ? ` (${usd(units(bal, 24) * px)})` : ""}${u.wallets.length > 1 ? ` · ${u.wallets.length} wallets` : ""}`,
    `<code>${u.accountId}</code>`,
    bal === 0n ? `\nSend NEAR to that address to start, or import a wallet you already have.` : ``,
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
    `<b>${esc(i.symbol)}</b> · ${esc(i.name)}${coin.hidden ? " · retired" : ""}`,
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
    `💼 <b>${wl(u)}</b> ${fmt(units(bal, 24), 3)} NEAR${nUsd ? ` (${usd(units(bal, 24) * nUsd)})` : ""}`,
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

async function sendCard(ctx: Context, text: string, kb: InlineKeyboard, icon: string | null | undefined, name: string, edit: boolean) {
  const msg = ctx.callbackQuery?.message;
  // A refresh keeps the photo and rewrites the caption; anything else is a new card.
  if (edit && msg && "photo" in msg) {
    const ok = await ctx.editMessageCaption({ caption: text, parse_mode: "HTML", reply_markup: kb }).then(() => true).catch(() => false);
    if (ok) return;
  }
  const photo = new InputFile(await coinImage(icon), `${name}.png`);
  const sent = await ctx.replyWithPhoto(photo, { caption: text, parse_mode: "HTML", reply_markup: kb }).then(() => true).catch(() => false);
  if (!sent) await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb, link_preview_options: { is_disabled: true } });
}

async function showCoin(ctx: Context, u: User, coin: Coin, edit = false) {
  const i = await getInfo(coin.account_id);
  await sendCard(ctx, await coinCard(u, coin, i), coinKb(u, coin, i), i.icon, i.symbol, edit);
}

// ---- any NEAR token ------------------------------------------------------

async function tokenCard(u: User, t: TokenMeta) {
  const [priceNear, nUsd, mine, bal] = await Promise.all([tokenPriceNear(t), nearUsd(), ftBalance(t.account, u.accountId), balanceOf(u.accountId)]);
  const priceUsd = priceNear != null ? priceNear * nUsd : null;
  const mineVal = priceUsd != null ? units(mine, t.decimals) * priceUsd : null;
  return [
    `<b>${esc(t.symbol)}</b> · ${esc(t.name)}`,
    `<code>${t.account}</code>`,
    ``,
    `🏦 Trades on <b>Rhea</b>`,
    `💵 Price: <b>${priceUsd != null ? usd(priceUsd) : "no route"}</b>${priceNear != null ? ` · ${priceNear.toPrecision(3)} NEAR` : ""}`,
    ``,
    `💼 <b>${wl(u)}</b> ${fmt(units(bal, 24), 3)} NEAR${nUsd ? ` (${usd(units(bal, 24) * nUsd)})` : ""}`,
    mine > 0n ? `🪙 You: <b>${fmt(units(mine, t.decimals))} ${esc(t.symbol)}</b>${mineVal != null ? ` (${usd(mineVal)})` : ""}` : `🪙 You hold none yet.`,
  ].join("\n");
}

function tokenKb(u: User, t: TokenMeta) {
  const a = tokenAlias(t.account);
  const kb = new InlineKeyboard();
  for (const p of u.presets) kb.text(`Buy ${p} NEAR`, `tbuy:${a}:${p}`);
  kb.row().text("Buy X NEAR", `tbuyx:${a}`).row();
  kb.text("Sell 25%", `tsell:${a}:25`).text("Sell 50%", `tsell:${a}:50`).text("Sell 100%", `tsell:${a}:100`).row();
  kb.text(`Slippage ${pct(u.slippageBps)}`, `tslip:${a}`).text("🔄 Refresh", `tok:${a}`).row();
  kb.url("📈 Rhea", rheaUrl(t.account)).url("🔎 Explorer", `https://nearblocks.io/token/${t.account}`).text("💼 Wallet", "wallet");
  return kb;
}

async function showToken(ctx: Context, u: User, t: TokenMeta, edit = false) {
  await sendCard(ctx, await tokenCard(u, t), tokenKb(u, t), t.icon, t.symbol, edit);
}

async function doTokenBuy(ctx: Context, u: User, t: TokenMeta, nearAmt: string) {
  const nearIn = yocto(nearAmt);
  if (nearIn <= 0n) return void (await ctx.reply("Amount must be a number of NEAR."));
  const bal = await balanceOf(u.accountId);
  if (bal < nearIn + 5n * 10n ** 22n) return void (await ctx.reply(`Not enough NEAR. You have ${fmt(units(bal, 24), 4)}, and the bot keeps 0.05 for gas.`));
  const m = await ctx.reply(`⏳ Buying ${esc(t.symbol)} with ${nearAmt} NEAR on Rhea…`, { parse_mode: "HTML" });
  try {
    const plan = await planTokenBuy(u, t.account, nearIn);
    const had = await ftBalance(t.account, u.accountId);
    let last;
    for (const step of plan.steps) last = await run(u, step);
    const got = (await ftBalance(t.account, u.accountId)) - had;
    await ctx.api.editMessageText(m.chat.id, m.message_id, `✅ <b>Bought ${fmt(units(got, t.decimals))} ${esc(t.symbol)}</b> for ${nearAmt} NEAR. <a href="${txUrl(last!.transaction.hash)}">tx</a>`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ Buy failed: ${esc(friendlyError(e))}`, { parse_mode: "HTML" });
  }
  await showToken(ctx, u, t);
}

async function doTokenSell(ctx: Context, u: User, t: TokenMeta, pctStr: string) {
  const have = await ftBalance(t.account, u.accountId);
  if (have === 0n) return void (await ctx.reply(`You hold no ${esc(t.symbol)}.`, { parse_mode: "HTML" }));
  const p = Number(pctStr);
  if (!(p > 0 && p <= 100)) return void (await ctx.reply("Give a percent between 1 and 100."));
  const amount = p === 100 ? have : (have * BigInt(Math.round(p * 100))) / 10000n;
  const m = await ctx.reply(`⏳ Selling ${p}% of your ${esc(t.symbol)} on Rhea…`, { parse_mode: "HTML" });
  try {
    const plan = await planTokenSell(u, t.account, amount);
    let last;
    for (const step of plan.steps) { const filled = await fillPlaceholders(u, step, {}); if (filled.length) last = await run(u, filled); }
    await ctx.api.editMessageText(m.chat.id, m.message_id, `✅ <b>Sold ${fmt(units(amount, t.decimals))} ${esc(t.symbol)}</b> for about <b>${fmt(units(plan.nearOut, 24), 4)} NEAR</b>. <a href="${txUrl(last!.transaction.hash)}">tx</a>`, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ Sell failed: ${esc(friendlyError(e))}`, { parse_mode: "HTML" });
  }
  await showToken(ctx, u, t);
}

// ---- wallet --------------------------------------------------------------

async function walletText(u: User) {
  const [bal, nUsd, coins] = await Promise.all([balanceOf(u.accountId), nearUsd(), listCoins(false, true)]);
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
  const w = u.wallets[u.active];
  return [
    `<b>💼 Wallet ${wl(u)}</b>${w?.imported ? " · imported" : ""}${u.wallets.length > 1 ? ` · ${u.active + 1} of ${u.wallets.length}` : ""}`,
    `<code>${u.accountId}</code>`,
    ``,
    `NEAR: <b>${fmt(units(bal, 24), 4)}</b>${nUsd ? ` (${usd(units(bal, 24) * nUsd)})` : ""}`,
    rows.length ? `\n<b>Chipfi positions</b>\n${rows.join("\n")}` : `\nNo Chipfi positions in this wallet.`,
    `\nTotal: <b>${usd(total)}</b>`,
    `\nDeposit: send NEAR to the address above from any wallet or exchange.`,
  ].join("\n");
}

const walletKb = (u: User) => {
  const kb = new InlineKeyboard();
  if (u.wallets.length > 1) kb.text("🔀 Switch", "switch");
  kb.text("➕ New wallet", "neww").text("📥 Import key", "import").row();
  kb.text("📤 Withdraw", "withdraw").text("🔑 Export key", "export");
  if (u.wallets.length > 1) kb.text("🗑 Remove", "rmw");
  return kb.row().text("🔄 Refresh", "wallet").text("🪙 Coins", "coins").text("🏠 Home", "home");
};

async function switchScreen(u: User) {
  const bals = await Promise.all(u.wallets.map((w) => balanceOf(w.accountId)));
  const kb = new InlineKeyboard();
  u.wallets.forEach((w, k) => { kb.text(`${k === u.active ? "• " : ""}${w.label} · ${fmt(units(bals[k], 24), 2)} NEAR · ${short(w.accountId)}`, `use:${k}`).row(); });
  kb.text("💼 Back", "wallet");
  return { text: `<b>🔀 Your wallets</b>\n\nTap one to make it active. Every buy, sell and claim uses the active wallet.`, kb };
}

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
  const text = [`<b>🪙 Coins on Chipfi</b>`, ``, ...list.map((r) => `<b>${esc(r.c.symbol)}</b> · ${usd(r.mcap)} · ${r.i.pool_id != null ? "Rhea" : "curve"} · pair ${pairSym(r.i.pair)} · ${r.i.holders} holders`), ``, `Any other NEAR token: paste its address.`].join("\n");
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
  `1. The bot made you a NEAR wallet. Send NEAR to it, or import a wallet you already have with its private key.`,
  `2. Paste a Chipfi coin (symbol, address or link) or any NEAR token address, and tap Buy.`,
  `3. Sell any time. Chipfi coins on the curve pay your NEAR back in the same transaction; everything else goes through Rhea.`,
  ``,
  `Chipfi coins paired with a stock (like JENSEN on NVDAon) are bought in two hops: NEAR turns into the stock on Rhea, then the stock buys the coin. Sells go the other way.`,
  ``,
  `Chipfi coins tax every trade and pay a share to holders. Tap <b>Claim</b> to pull your dividends.`,
  ``,
  `Wallets: keep several, switch between them, export any key. Keys are encrypted on the bot's server. Keep exports private.`,
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
    let last;
    for (const step of plan.steps) { const filled = await fillPlaceholders(u, step, before, stock); if (filled.length) last = await run(u, filled); }
    const hash = last?.transaction.hash as string;
    await ctx.api.editMessageText(m.chat.id, m.message_id, [
      `✅ <b>Sold ${fmt(units(tokens, 18))} ${esc(i.symbol)}</b> ${plan.note}.`,
      plan.nearOut != null ? `Received about <b>${fmt(units(plan.nearOut, 24), 4)} NEAR</b>.` : `Received about ${fmt(units(plan.pairOut, pairDec(i.pair)), 4)} ${pairSym(i.pair)}.`,
      `<a href="${txUrl(hash)}">tx</a> · ${await positionLine(u, acct)}`,
    ].join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  } catch (e) {
    await ctx.api.editMessageText(m.chat.id, m.message_id, `❌ Sell failed: ${esc(friendlyError(e))}`, { parse_mode: "HTML" });
  }
  await showCoin(ctx, u, coin);
}

async function positionLine(u: User, acct: string) {
  const [h, bal] = await Promise.all([getHolder(acct, u.accountId), balanceOf(u.accountId)]);
  return `you hold ${fmt(units(BigInt(h.balance), 18))} · ${wl(u)} ${fmt(units(bal, 24), 3)} NEAR`;
}

/** Whatever a person pasted: a Chipfi coin, or any token account. */
async function showAny(ctx: Context, u: User, text: string): Promise<boolean> {
  const c = await resolveCoin(text);
  if (c) { await showCoin(ctx, u, c); return true; }
  const acct = text.trim().toLowerCase();
  if (looksLikeAccount(acct)) {
    const t = await tokenMeta(acct);
    if (t) { await showToken(ctx, u, t); return true; }
  }
  return false;
}

// ---- commands ------------------------------------------------------------

bot.command("start", async (ctx) => {
  const u = ensureUser(ctx.from!.id);
  const payload = ctx.match?.trim();
  if (payload && (await showAny(ctx, u, payload))) return;
  await ctx.replyWithPhoto(new InputFile(LOGO, "chipfi.png"), { caption: await homeText(u), parse_mode: "HTML", reply_markup: homeKb() });
});
bot.command("wallet", async (ctx) => { const u = ensureUser(ctx.from!.id); await ctx.reply(await walletText(u), { parse_mode: "HTML", reply_markup: walletKb(u) }); });
bot.command("wallets", async (ctx) => { const u = ensureUser(ctx.from!.id); const { text, kb } = await switchScreen(u); await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb }); });
bot.command("import", async (ctx) => { const u = ensureUser(ctx.from!.id); pending.set(u.tgId, { kind: "import" }); await ctx.reply(IMPORT_PROMPT, { parse_mode: "HTML" }); });
bot.command("coins", async (ctx) => { ensureUser(ctx.from!.id); const { text, kb } = await coinsText(); await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb }); });
bot.command("settings", async (ctx) => { const u = ensureUser(ctx.from!.id); await ctx.reply(settingsText(u), { parse_mode: "HTML", reply_markup: settingsKb(u) }); });
bot.command("help", async (ctx) => { await ctx.reply(HELP, { parse_mode: "HTML" }); });
bot.command("buy", async (ctx) => {
  const u = ensureUser(ctx.from!.id);
  const [what, amt] = (ctx.match ?? "").trim().split(/\s+/);
  if (!what) return ctx.reply("Usage: /buy CHIP 5   or   /buy blackdragon.tkn.near 5");
  const c = await resolveCoin(what);
  if (c) { if (!amt) return showCoin(ctx, u, c); return withLock(ctx, u, () => doBuy(ctx, u, c.account_id, amt)); }
  const t = looksLikeAccount(what.toLowerCase()) ? await tokenMeta(what.toLowerCase()) : null;
  if (!t) return ctx.reply("I don't know that token.");
  if (!amt) return showToken(ctx, u, t);
  await withLock(ctx, u, () => doTokenBuy(ctx, u, t, amt));
});
bot.command("sell", async (ctx) => {
  const u = ensureUser(ctx.from!.id);
  const [what, p] = (ctx.match ?? "").trim().split(/\s+/);
  if (!what) return ctx.reply("Usage: /sell CHIP 50   (percent of what you hold)");
  const c = await resolveCoin(what);
  if (c) return withLock(ctx, u, () => doSell(ctx, u, c.account_id, p ?? "100"));
  const t = looksLikeAccount(what.toLowerCase()) ? await tokenMeta(what.toLowerCase()) : null;
  if (!t) return ctx.reply("I don't know that token.");
  await withLock(ctx, u, () => doTokenSell(ctx, u, t, p ?? "100"));
});

bot.command("stats", async (ctx) => {
  if (!config.admins.includes(ctx.from!.id)) return void (await ctx.reply(`Admin only. Your Telegram id is <code>${ctx.from!.id}</code>.`, { parse_mode: "HTML" }));
  const users = allUsers();
  const nUsd = await nearUsd();
  const wallets = users.flatMap((u) => u.wallets.map((w) => ({ u, w })));
  const bals = await Promise.all(wallets.map(async (x) => ({ ...x, bal: await balanceOf(x.w.accountId) })));
  const funded = bals.filter((b) => b.bal > 0n);
  const total = funded.reduce((a, b) => a + b.bal, 0n);
  const day = Date.now() - 86_400_000;
  const lines = [
    `<b>📊 Bot stats</b>`,
    `Users: <b>${users.length}</b> · new last 24h: <b>${users.filter((u) => u.createdAt > day).length}</b> · wallets: <b>${wallets.length}</b> (${wallets.filter((x) => x.w.imported).length} imported)`,
    `Funded wallets: <b>${funded.length}</b>`,
    `NEAR held: <b>${fmt(units(total, 24), 3)}</b>${nUsd ? ` (${usd(units(total, 24) * nUsd)})` : ""}`,
    ``,
    ...funded.sort((a, b) => (b.bal > a.bal ? 1 : -1)).slice(0, 10).map((b) => `• <code>${short(b.w.accountId)}</code> ${fmt(units(b.bal, 24), 3)} NEAR · joined ${ago(b.u.createdAt)} ago`),
  ];
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
});

const IMPORT_PROMPT = [
  `📥 <b>Import a wallet</b>`,
  ``,
  `Send the private key, the string starting with <code>ed25519:</code>. For a named account you can add it after a space, like <code>ed25519:… alice.near</code>; without it I look up which accounts hold the key.`,
  ``,
  `Delete your message afterwards. The key is encrypted on the server and never shown again unless you export it.`,
].join("\n");

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
    case "wallet": return void editOrReply(ctx, await walletText(u), walletKb(u));
    case "switch": { const { text, kb } = await switchScreen(u); return void editOrReply(ctx, text, kb); }
    case "use": { activate(u.tgId, Number(a)); const nu = ensureUser(u.tgId); return void editOrReply(ctx, await walletText(nu), walletKb(nu)); }
    case "neww": { const w = newWallet(u.tgId); const nu = ensureUser(u.tgId); await ctx.reply(`➕ Made <b>${w.label}</b> and switched to it.\n<code>${w.accountId}</code>`, { parse_mode: "HTML" }); return void ctx.reply(await walletText(nu), { parse_mode: "HTML", reply_markup: walletKb(nu) }); }
    case "import": pending.set(u.tgId, { kind: "import" }); return void ctx.reply(IMPORT_PROMPT, { parse_mode: "HTML" });
    case "pick": {
      const p = pending.get(u.tgId);
      if (!p || p.kind !== "importpick") return;
      pending.delete(u.tgId);
      const r = await importKey(u.tgId, p.secret, p.choices[Number(a)]);
      if ("ok" in r && r.ok) { const nu = ensureUser(u.tgId); await ctx.reply(`✅ Imported <b>${r.wallet.label}</b> <code>${r.wallet.accountId}</code> and switched to it.`, { parse_mode: "HTML" }); return void ctx.reply(await walletText(nu), { parse_mode: "HTML", reply_markup: walletKb(nu) }); }
      return void ctx.reply(`❌ ${"reason" in r ? esc(r.reason) : "Could not import."}`, { parse_mode: "HTML" });
    }
    case "rmw": {
      if (u.wallets.length < 2) return;
      const w = u.wallets[u.active];
      const bal = await balanceOf(w.accountId);
      return void ctx.reply(`Remove <b>${w.label}</b> <code>${w.accountId}</code> from the bot?${bal > 0n ? `\n\n⚠️ It still holds ${fmt(units(bal, 24), 4)} NEAR. Export the key or withdraw first, or the funds are unreachable.` : ""}`, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("Yes, remove it", `rmwyes:${u.active}`).text("Keep it", "wallet") });
    }
    case "rmwyes": { removeWallet(u.tgId, Number(a)); const nu = ensureUser(u.tgId); return void editOrReply(ctx, await walletText(nu), walletKb(nu)); }
    case "coins": { const { text, kb } = await coinsText(); return void editOrReply(ctx, text, kb); }
    case "settings": return void editOrReply(ctx, settingsText(u), settingsKb(u));
    case "help": return void ctx.reply(HELP, { parse_mode: "HTML" });
    case "coin": { const c = await resolveCoin(a); if (c) await showCoin(ctx, u, c, true); return; }
    case "buy": return withLock(ctx, u, () => doBuy(ctx, u, a, b));
    case "sell": return withLock(ctx, u, () => doSell(ctx, u, a, b));
    case "buyx": pending.set(u.tgId, { kind: "buyx", acct: a }); return void ctx.reply("How much NEAR? Send a number, like <code>2.5</code>.", { parse_mode: "HTML" });
    case "sellx": pending.set(u.tgId, { kind: "sellx", acct: a }); return void ctx.reply("What percent to sell? Send a number from 1 to 100.");
    case "slip": { cycleSlippage(u); const c = await resolveCoin(a); if (c) await showCoin(ctx, ensureUser(u.tgId), c, true); return; }
    case "tok": { const t = await tokenByAlias(a); if (t) await showToken(ctx, u, t, true); return; }
    case "tbuy": { const t = await tokenByAlias(a); if (t) return withLock(ctx, u, () => doTokenBuy(ctx, u, t, b)); return; }
    case "tsell": { const t = await tokenByAlias(a); if (t) return withLock(ctx, u, () => doTokenSell(ctx, u, t, b)); return; }
    case "tbuyx": { const t = tokenFromAlias(a); if (!t) return; pending.set(u.tgId, { kind: "tbuyx", token: t }); return void ctx.reply("How much NEAR? Send a number, like <code>2.5</code>.", { parse_mode: "HTML" }); }
    case "tsellx": { const t = tokenFromAlias(a); if (!t) return; pending.set(u.tgId, { kind: "tsellx", token: t }); return void ctx.reply("What percent to sell? Send a number from 1 to 100."); }
    case "tslip": { cycleSlippage(u); const t = await tokenByAlias(a); if (t) await showToken(ctx, ensureUser(u.tgId), t, true); return; }
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
      const m = await ctx.reply([`🔑 <b>Private key of ${wl(u)}</b> <code>${u.accountId}</code>`, `<code>${secretKeyOf(u)}</code>`, ``, `Anyone with this key controls the wallet. Import it into Meteor or HOT to use it outside the bot, then delete this message. It disappears in 60 seconds.`].join("\n"), { parse_mode: "HTML" });
      setTimeout(() => ctx.api.deleteMessage(m.chat.id, m.message_id).catch(() => {}), 60_000);
      return;
    }
  }
});

function cycleSlippage(u: User) {
  const next = [100, 300, 500, 1000, 2000]; const k = next.indexOf(u.slippageBps);
  updateUser(u.tgId, { slippageBps: next[(k + 1) % next.length] });
}

async function tokenByAlias(a: string): Promise<TokenMeta | null> {
  const acct = tokenFromAlias(a);
  return acct ? tokenMeta(acct) : null;
}

// ---- free text: coins, tokens and pending answers -----------------------

bot.on("message:text", async (ctx) => {
  if (ctx.chat.type !== "private") return;
  const u = ensureUser(ctx.from.id);
  const text = ctx.message.text.trim();
  const p = pending.get(u.tgId);
  if (p) {
    pending.delete(u.tgId);
    if (p.kind === "buyx") return withLock(ctx, u, () => doBuy(ctx, u, p.acct, text.replace(/[^0-9.]/g, "")));
    if (p.kind === "sellx") return withLock(ctx, u, () => doSell(ctx, u, p.acct, text.replace(/[^0-9.]/g, "")));
    if (p.kind === "tbuyx" || p.kind === "tsellx") {
      const t = await tokenMeta(p.token); if (!t) return;
      const n = text.replace(/[^0-9.]/g, "");
      return withLock(ctx, u, () => (p.kind === "tbuyx" ? doTokenBuy(ctx, u, t, n) : doTokenSell(ctx, u, t, n)));
    }
    if (p.kind === "presets") {
      const nums = text.split(/[\s,]+/).map(Number).filter((n) => n > 0).slice(0, 3);
      if (nums.length !== 3) return ctx.reply("Three numbers, please.");
      updateUser(u.tgId, { presets: nums });
      return ctx.reply(`Presets: ${nums.join(", ")} NEAR.`);
    }
    if (p.kind === "import") {
      const [key, acct] = text.split(/\s+/);
      ctx.deleteMessage().catch(() => {});
      const r = await importKey(u.tgId, key, acct?.toLowerCase());
      if ("choose" in r) {
        pending.set(u.tgId, { kind: "importpick", secret: key, choices: r.choose });
        const kb = new InlineKeyboard(); r.choose.forEach((c, k) => kb.text(c, `pick:${k}`).row());
        return ctx.reply(`That key belongs to several accounts. Which one?`, { reply_markup: kb });
      }
      if (r.ok) { const nu = ensureUser(u.tgId); await ctx.reply(`✅ Imported <b>${r.wallet.label}</b> <code>${r.wallet.accountId}</code> and switched to it. Your key message was deleted.`, { parse_mode: "HTML" }); return ctx.reply(await walletText(nu), { parse_mode: "HTML", reply_markup: walletKb(nu) }); }
      return ctx.reply(`❌ ${esc(r.reason)}`, { parse_mode: "HTML" });
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
  if (/^ed25519:/.test(text)) {
    // A key pasted without asking: treat it as an import.
    const [key, acct] = text.split(/\s+/);
    ctx.deleteMessage().catch(() => {});
    const r = await importKey(u.tgId, key, acct?.toLowerCase());
    if ("choose" in r) { pending.set(u.tgId, { kind: "importpick", secret: key, choices: r.choose }); const kb = new InlineKeyboard(); r.choose.forEach((c, k) => kb.text(c, `pick:${k}`).row()); return ctx.reply(`That key belongs to several accounts. Which one?`, { reply_markup: kb }); }
    if (r.ok) { const nu = ensureUser(u.tgId); await ctx.reply(`✅ Imported <b>${r.wallet.label}</b> <code>${r.wallet.accountId}</code> and switched to it.`, { parse_mode: "HTML" }); return ctx.reply(await walletText(nu), { parse_mode: "HTML", reply_markup: walletKb(nu) }); }
    return ctx.reply(`❌ ${esc(r.reason)}`, { parse_mode: "HTML" });
  }
  if (await showAny(ctx, u, text)) return;
  await ctx.reply("I don't know that. Paste a Chipfi coin (symbol, address or link) or any NEAR token address, or tap Coins.", { reply_markup: new InlineKeyboard().text("🪙 Coins", "coins") });
});

bot.catch((err) => { console.error("bot error", err.error instanceof Error ? err.error.message : err.error); });

export async function setCommands() {
  await bot.api.setMyCommands([
    { command: "start", description: "Home and your wallet" },
    { command: "coins", description: "Coins on Chipfi" },
    { command: "buy", description: "/buy CHIP 5  or  /buy token.near 5" },
    { command: "sell", description: "/sell CHIP 50" },
    { command: "wallet", description: "Balance, positions, withdraw, export" },
    { command: "wallets", description: "Switch between your wallets" },
    { command: "import", description: "Import a wallet by private key" },
    { command: "settings", description: "Slippage and presets" },
    { command: "help", description: "How it works" },
  ]);
}

export { NEAR, toUnits };
