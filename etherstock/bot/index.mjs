/* eslint-disable no-console */
// Etherstock Telegram bot. Watches the factory for new launches, the
// PoolManager for trades on Etherstock pools and every coin for buyback
// burns, posts to a Telegram chat.
//
//   node index.mjs          long-running worker (polls every POLL_MS)
//   node index.mjs --once   one pass since the saved block, then exit (cron hosts)
//
// Env (see .env.example): ALCHEMY_HTTP, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
// FACTORY, START_BLOCK, SITE_URL, MIN_TRADE_USD (0 disables trade alerts),
// MIN_BURN_USD (0 disables burn alerts), STATE_FILE, BACKFILL_BLOCKS, DRY_RUN.
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import "dotenv/config";
import { startKeeper } from "./keeper.mjs";

const RPC = process.env.ALCHEMY_HTTP || process.env.RPC_URL || "https://gateway.tenderly.co/public/mainnet";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const DRY = process.env.DRY_RUN === "1";
const MIN_TRADE_USD = Number(process.env.MIN_TRADE_USD ?? "0"); // launches only by default
const POLL_MS = Number(process.env.POLL_MS ?? "6000");
const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), "state.json");
const BACKFILL = Number(process.env.BACKFILL_BLOCKS ?? "0");
const SITE = process.env.SITE_URL || "https://www.etherstock.fun";
const MIN_BURN_USD = Number(process.env.MIN_BURN_USD ?? "1");
const ONCE = process.argv.includes("--once");

const FACTORY = process.env.FACTORY;
const POOL_MANAGER = "0x000000000004444c5dc75cB358380D2e3dE08A90";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const START_BLOCK = Number(process.env.START_BLOCK ?? "0"); // factory deploy
const SUPPLY = 1e9;
if (!FACTORY || !START_BLOCK) { console.error("FACTORY and START_BLOCK missing"); process.exit(1); }

if (!TOKEN && !DRY) { console.error("TELEGRAM_BOT_TOKEN missing"); process.exit(1); }
if (!CHAT && !DRY) { console.error("TELEGRAM_CHAT_ID missing (add the bot to the channel, post once, then read getUpdates)"); process.exit(1); }

const p = new ethers.JsonRpcProvider(RPC, 1, { staticNetwork: true, batchMaxCount: 1 });
const factory = new ethers.Contract(FACTORY, [
  "event Launched(address indexed token, address indexed creator, address indexed pair, uint16 taxBps, bytes32 poolId, uint256 pairUsdPrice8)",
  "function listings(address) view returns (address creator, address pair, uint16 taxBps, uint64 createdAt, bytes32 poolId)",
  "function pairUsdPrice(address) view returns (uint256)",
], p);
const SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"; // Swap(bytes32,address,int128,int128,uint160,uint128,uint24,int24)
const BUYBACK_TOPIC = ethers.id("Buyback(uint256,uint256,bool)");
const coder = ethers.AbiCoder.defaultAbiCoder();
const erc20 = (a) => new ethers.Contract(a, ["function name() view returns (string)", "function symbol() view returns (string)", "function metadataURI() view returns (string)", "function totalSupply() view returns (uint256)", "function totalBurned() view returns (uint256)"], p);

// -- state -----------------------------------------------------------------
const state = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return { lastBlock: 0 }; } })();
const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));

/** poolId -> coin info, filled from Launched logs. */
const pools = new Map();
const pairSymbols = new Map();

async function pairSymbol(pair) {
  const k = pair.toLowerCase();
  if (k === WETH) return "ETH";
  if (!pairSymbols.has(k)) { try { pairSymbols.set(k, await erc20(pair).symbol()); } catch { pairSymbols.set(k, k.slice(0, 8)); } }
  return pairSymbols.get(k);
}

async function coinInfo(token, creator, pair, poolId) {
  const t = erc20(token);
  const [name, symbol, metaRaw] = await Promise.all([t.name(), t.symbol(), t.metadataURI().catch(() => "")]);
  let meta = {}; try { meta = JSON.parse(metaRaw); } catch { meta = { description: metaRaw }; }
  const info = { token, creator, pair: pair.toLowerCase(), poolId, name, symbol, meta, pairSym: await pairSymbol(pair), tokenIs0: token.toLowerCase() < pair.toLowerCase() };
  pools.set(poolId.toLowerCase(), info);
  return info;
}

async function loadPools(toBlock) {
  const ev = factory.getEvent("Launched");
  for (let a = START_BLOCK; a <= toBlock; a += 10_000) {
    const b = Math.min(a + 9_999, toBlock);
    const logs = await factory.queryFilter(ev, a, b);
    for (const l of logs) await coinInfo(l.args.token, l.args.creator, l.args.pair, l.args.poolId);
  }
  console.log("tracking", pools.size, "pools");
}

// -- telegram --------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const usd = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 })}`;

async function tg(method, body) {
  if (DRY) { console.log("[dry]", method, "\n" + (body instanceof FormData ? body.get("caption") : body.text)); return; }
  const isForm = body instanceof FormData;
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, { method: "POST", headers: isForm ? undefined : { "content-type": "application/json" }, body: isForm ? body : JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`);
  return j.result;
}

function dataUriToBlob(uri) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri || "");
  if (!m) return null;
  const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
  if (buf.length > 5_000_000) return null;
  return new Blob([buf], { type: m[1] });
}

async function post(text, logo) {
  const blob = dataUriToBlob(logo);
  if (blob) {
    const fd = new FormData();
    fd.append("chat_id", CHAT ?? "");
    fd.append("photo", blob, "logo." + (blob.type.split("/")[1] || "png"));
    fd.append("caption", text);
    fd.append("parse_mode", "HTML");
    try { await tg("sendPhoto", fd); return; } catch (e) { console.warn("sendPhoto failed, falling back to text:", e.message); }
  }
  await tg("sendMessage", { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true });
}

// -- messages --------------------------------------------------------------
function launchText(c) {
  const lines = [
    `🚀 <b>New coin on Etherstock</b>`,
    ``,
    `<b>${esc(c.name)}</b> ($${esc(c.symbol)})`,
    `Paired with <b>${esc(c.pairSym)}</b> · every trade pays the creator in ${esc(c.pairSym)} and burns the coin`,
    c.meta?.description ? `<i>${esc(String(c.meta.description).slice(0, 280))}</i>` : "",
    ``,
    `Creator: <a href="https://etherscan.io/address/${c.creator}">${short(c.creator)}</a>`,
    `CA: <code>${c.token}</code>`,
    ``,
    `<a href="${SITE}/t/${c.token}">Trade on Etherstock</a> · <a href="https://etherscan.io/token/${c.token}">Etherscan</a>`,
  ];
  return lines.filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

function tradeText(c, isBuy, pairAmt, pairUsd, mcapUsd, trader, tx) {
  const head = isBuy ? "🟢 <b>Buy</b>" : "🔴 <b>Sell</b>";
  return [
    `${head} $${esc(c.symbol)}`,
    ``,
    `${pairAmt.toFixed(4)} ${esc(c.pairSym)} (${usd(pairUsd)})`,
    `Market cap: ${usd(mcapUsd)}`,
    `Trader: <a href="https://etherscan.io/address/${trader}">${short(trader)}</a> · <a href="https://etherscan.io/tx/${tx}">tx</a>`,
    ``,
    `<a href="${SITE}/t/${c.token}">Trade on Etherstock</a>`,
  ].join("\n");
}

function burnText(c, pairIn, pairUsd, coins, pctNow, pctTotal, inSwap, tx) {
  return [
    `🔥 <b>Burn</b> $${esc(c.symbol)}`,
    ``,
    `${pairIn.toFixed(4)} ${esc(c.pairSym)} (${usd(pairUsd)}) bought back and burned ${coins.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${esc(c.symbol)} (${pctNow.toFixed(3)}% of supply)`,
    `Total burned: <b>${pctTotal.toFixed(2)}%</b> of supply${inSwap ? " · fired inside a trade" : ""}`,
    `<a href="https://etherscan.io/tx/${tx}">tx</a>`,
    ``,
    `<a href="${SITE}/t/${c.token}">Trade on Etherstock</a>`,
  ].join("\n");
}

// -- scan ------------------------------------------------------------------
async function scan(from, to) {
  // launches
  const ev = factory.getEvent("Launched");
  const launches = await factory.queryFilter(ev, from, to);
  for (const l of launches) {
    const c = await coinInfo(l.args.token, l.args.creator, l.args.pair, l.args.poolId);
    console.log("launch", c.symbol, c.token);
    await post(launchText(c), c.meta?.logo);
  }
  if (pools.size === 0) return;
  const pairUsdCache = new Map();
  const pairUsdOf = async (pair) => { if (!pairUsdCache.has(pair)) pairUsdCache.set(pair, Number(await factory.pairUsdPrice(pair)) / 1e8); return pairUsdCache.get(pair); };
  // buyback burns on any tracked coin
  if (MIN_BURN_USD > 0) {
    const byToken = new Map([...pools.values()].map((c) => [c.token.toLowerCase(), c]));
    const burns = await p.getLogs({ address: [...byToken.keys()], topics: [BUYBACK_TOPIC], fromBlock: from, toBlock: to });
    for (const l of burns) {
      const c = byToken.get(l.address.toLowerCase());
      if (!c) continue;
      const [pairInWei, coinsWei, inSwap] = coder.decode(["uint256", "uint256", "bool"], l.data);
      const pairIn = Number(ethers.formatEther(pairInWei));
      const pairUsd = pairIn * (await pairUsdOf(c.pair));
      if (pairUsd < MIN_BURN_USD) continue;
      const coins = Number(ethers.formatEther(coinsWei));
      let pctTotal = 0; try { pctTotal = Number(ethers.formatEther(await erc20(c.token).totalBurned())) / SUPPLY * 100; } catch {}
      console.log("burn", c.symbol, pairIn.toFixed(4), c.pairSym, usd(pairUsd), coins.toFixed(0), "coins");
      await post(burnText(c, pairIn, pairUsd, coins, coins / SUPPLY * 100, pctTotal, inSwap, l.transactionHash));
    }
  }
  if (MIN_TRADE_USD <= 0) return;
  // trades on any tracked pool
  const logs = await p.getLogs({ address: POOL_MANAGER, topics: [SWAP_TOPIC, [...pools.keys()]], fromBlock: from, toBlock: to });
  for (const l of logs) {
    const c = pools.get(l.topics[1].toLowerCase());
    if (!c) continue;
    const [a0, a1, sqrtP] = coder.decode(["int128", "int128", "uint160", "uint128", "uint24", "int24"], l.data);
    const pairDelta = c.tokenIs0 ? a1 : a0, tokDelta = c.tokenIs0 ? a0 : a1;
    const isBuy = tokDelta > 0n;
    const pairAmt = Number(ethers.formatEther(pairDelta < 0n ? -pairDelta : pairDelta));
    const pu = await pairUsdOf(c.pair);
    const pairUsd = pairAmt * pu;
    if (pairUsd < MIN_TRADE_USD) continue;
    const r = Number(sqrtP) / 2 ** 96;
    const price = c.tokenIs0 ? r * r : 1 / (r * r);
    let supply = SUPPLY; try { supply = Number(ethers.formatEther(await erc20(c.token).totalSupply())); } catch {}
    const mcap = price * supply * pu;
    // The swap's tx sender is the trader; the log's sender is the router.
    let trader = "0x" + l.topics[2].slice(26);
    try { const tx = await p.getTransaction(l.transactionHash); if (tx?.from) trader = tx.from; } catch {}
    console.log(isBuy ? "buy" : "sell", c.symbol, pairAmt.toFixed(4), c.pairSym, usd(pairUsd));
    await post(tradeText(c, isBuy, pairAmt, pairUsd, mcap, trader, l.transactionHash));
  }
}

async function tick() {
  const head = await p.getBlockNumber();
  if (!state.lastBlock) { state.lastBlock = Math.max(START_BLOCK, head - BACKFILL) - 1; save(); }
  if (head <= state.lastBlock) return;
  const from = state.lastBlock + 1, to = Math.min(head, from + 2_000);
  await scan(from, to);
  state.lastBlock = to; save();
}

(async () => {
  const head = await p.getBlockNumber();
  await loadPools(head);
  if (ONCE) { await tick(); return; }
  console.log("polling every", POLL_MS, "ms from block", state.lastBlock || head);
  startKeeper(); // no-op unless KEEPER_PRIVATE_KEY is set
  for (;;) {
    try { await tick(); } catch (e) { console.error("tick failed:", e.shortMessage || e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})().catch((e) => { console.error(e); process.exit(1); });
