/** Runs the bot's buy and sell plans with the deployer key, no Telegram.
 *   NEAR_ACCOUNT_ID=... NEAR_SECRET_KEY=... npx tsx scripts/selftest.ts <coin> <near>  */
import { fillPlaceholders, getHolder, getInfo, planBuy, planSell, resolveCoin, units, yocto } from "../src/chipfi.js";
import { balanceOf, ftBalance, run } from "../src/near.js";
import { encrypt, load, type User } from "../src/store.js";

load();
const [what, near] = process.argv.slice(2);
const u: User = { tgId: 0, accountId: process.env.NEAR_ACCOUNT_ID!, publicKey: "", secretKeyEnc: encrypt(process.env.NEAR_SECRET_KEY!), slippageBps: 500, presets: [1, 5, 10], createdAt: 0 };
const c = (await resolveCoin(what))!;
const acct = c.account_id;
let i = await getInfo(acct);
const stock = i.pair === "Near" ? undefined : i.pair.Token.account_id;
console.log("coin", c.symbol, "phase", i.phase, "pair", i.pair === "Near" ? "NEAR" : i.pair.Token.symbol, "balance", units(await balanceOf(u.accountId), 24));

const buy = await planBuy(u, acct, i, yocto(near));
console.log("buy plan:", buy.note, "expect tokens", units(buy.tokensOut, 18), "steps", buy.steps.map((s) => s.map((c) => `${c.receiverId}.${c.method}`)));
const before = { stock: stock ? await ftBalance(stock, u.accountId) : 0n };
const had = BigInt((await getHolder(acct, u.accountId)).balance);
for (const step of buy.steps) { const r = await run(u, await fillPlaceholders(u, step, before, stock)); console.log("  tx", r.transaction.hash); }
const got = BigInt((await getHolder(acct, u.accountId)).balance) - had;
console.log("got tokens", units(got, 18));

i = await getInfo(acct);
const sell = await planSell(u, acct, i, got);
console.log("sell plan:", sell.note, "expect pair", units(sell.pairOut, i.pair === "Near" ? 24 : i.pair.Token.decimals), "steps", sell.steps.map((s) => s.map((c) => `${c.receiverId}.${c.method}`)));
const b2 = { stock: stock ? await ftBalance(stock, u.accountId) : 0n };
const nb = await balanceOf(u.accountId);
for (const step of sell.steps) { const f = await fillPlaceholders(u, step, b2, stock); if (f.length) { const r = await run(u, f); console.log("  tx", r.transaction.hash); } }
console.log("NEAR change", units(await balanceOf(u.accountId) - nb, 24), "holding now", units(BigInt((await getHolder(acct, u.accountId)).balance), 18));
