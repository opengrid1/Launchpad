/* End-to-end check of the indexer against three local Equo chains.
 *
 *   1. npx hardhat node                                   (in contracts/)
 *   2. OUT=/tmp/omni.json npx hardhat run scripts/omni-local-fixture.ts --network localhost
 *   3. FIXTURE=/tmp/omni.json DATABASE_URL=postgres://… node test/e2e.mjs   (in indexer/, empty database)
 *
 * Starts the indexer on the fixture's chains, waits until every chain is caught up, then compares the API with
 * what the fixture read from the contracts: trades per chain, supply per chain, holder balances, bridges,
 * candles and the coin grouping across chains. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const FIX = process.env.FIXTURE;
if (!FIX) throw new Error("set FIXTURE to the fixture JSON");
const fx = JSON.parse(readFileSync(FIX, "utf8"));
const PORT = process.env.PORT || "8093";
const api = (p) => fetch(`http://127.0.0.1:${PORT}${p}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// E2E_TICK=1 runs the indexer the way the serverless host does: API only, indexing through /api/tick
const TICK = process.env.E2E_TICK === "1";
const child = spawn(process.execPath, ["src/main.js"], { env: { ...process.env, CHAINS_FILE: FIX, PORT, PRICE_EVERY_MS: "2000", ...(TICK ? { MODE: "api", TICK: "1" } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
let logs = "";
child.stdout.on("data", (d) => (logs += d));
child.stderr.on("data", (d) => (logs += d));

let failed = 0, passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log("  ✔", name); } catch (e) { failed++; console.log("  ✘", name, "\n    ", e.message.split("\n").slice(0, 6).join("\n     ")); }
}

try {
  // wait for the API, then for every chain to reach the head
  let h;
  for (let i = 0; i < 120; i++) {
    await sleep(TICK ? 9000 : 1000);
    if (TICK) console.log("tick:", JSON.stringify((await api("/api/tick").catch((e) => ({ body: e.message }))).body).slice(0, 200));
    h = await api("/api/health").catch(() => null);
    if (h && h.body.chains.length === fx.chains.length && h.body.chains.every((c) => c.behind === 0)) break;
  }
  console.log("health:", JSON.stringify(h && h.body.chains));
  await sleep(1500);

  for (const [tag, e] of Object.entries(fx.expect.coins)) {
    console.log(`coin ${tag}`);
    const anyAddr = Object.values(e.chains)[0].token;
    const coin = (await api(`/api/coin?coin=${anyAddr}`)).body;

    await check("every chain's contract is grouped into one coin", async () => {
      assert.deepEqual(Object.keys(coin.chains).sort(), Object.keys(e.chains).sort());
      for (const [k, c] of Object.entries(e.chains)) assert.equal(coin.chains[k].token, c.token);
      for (const c of Object.values(e.chains)) assert.equal((await api(`/api/coin?coin=${c.token}`)).body.id, coin.id);
    });
    await check("supply per chain matches totalSupply (bridging burns and mints)", async () => {
      for (const [k, c] of Object.entries(e.chains)) assert.equal(coin.chains[k].supply, c.supply, k);
    });
    await check("trades per chain", async () => {
      const t = (await api(`/api/trades?coin=${anyAddr}&limit=500`)).body.trades;
      const by = {};
      t.forEach((x) => (by[x.chain] = (by[x.chain] || 0) + 1));
      assert.deepEqual(by, e.trades);
      assert.ok(t.every((x) => x.priceUsd > 0 && x.valueUsd > 0 && /^0x[0-9a-f]{40}$/.test(x.wallet)), "every trade has a wallet and USD values");
      for (let i = 1; i < t.length; i++) assert.ok(t[i - 1].ts >= t[i].ts, "newest first");
    });
    await check("holder balances across chains", async () => {
      const hs = (await api(`/api/holders?coin=${anyAddr}&limit=500`)).body.holders;
      const got = Object.fromEntries(hs.map((x) => [x.wallet, x.balance]));
      for (const [w, b] of Object.entries(e.balances)) assert.equal(got[w], b, w);
      const sys = fx.chains.flatMap((c) => [c.poolManager, c.factory, c.hook, c.tokenDeployer, c.router].map((a) => String(a).toLowerCase()));
      assert.ok(hs.every((x) => !sys.includes(x.wallet)), "no pool or launchpad contract listed as a holder");
    });
    await check("bridge events", async () => {
      const b = (await api(`/api/bridges?coin=${anyAddr}`)).body.bridges;
      assert.equal(b.length, e.bridges);
      if (e.bridges) {
        const outs = b.filter((x) => x.direction === "out"), ins = b.filter((x) => x.direction === "in");
        for (const o of outs) assert.ok(ins.some((i) => i.guid === o.guid && i.received === o.received), "each send has its receipt");
      }
    });
    // the local chain runs ahead of the wall clock (the fixture skips time), so ask for a window around now
    const now = Math.floor(Date.now() / 1000), win = `&from=${now - 86400}&to=${now + 86400}`;
    await check("candles: merged equals the sum of the chains; one chain alone; pair units", async () => {
      const m = (await api(`/api/candles?coin=${anyAddr}&res=300${win}`)).body.candles;
      const n = m.reduce((a, c) => a + c.n, 0);
      const total = Object.values(e.trades).reduce((a, b) => a + b, 0);
      assert.equal(n, total);
      let per = 0;
      for (const k of Object.keys(e.trades)) {
        const one = (await api(`/api/candles?coin=${anyAddr}&res=300${win}&chain=${k}`)).body.candles;
        per += one.reduce((a, c) => a + c.n, 0);
        assert.ok(one.every((c) => c.h >= c.l && c.h >= c.o && c.h >= c.c && c.l <= c.o && c.l <= c.c && c.v > 0));
        const pairC = (await api(`/api/candles?coin=${anyAddr}&res=300${win}&chain=${k}&unit=pair`)).body;
        assert.equal(pairC.unit, "pair");
        assert.ok(pairC.candles.every((c) => c.c > 0 && c.c < 1), "pair per coin is a small number");
      }
      assert.equal(per, total);
      assert.equal((await api(`/api/candles?coin=${anyAddr}&res=300&unit=pair`)).status, 400, "pair units need one chain");
      assert.equal((await api(`/api/candles?coin=${anyAddr}&res=60&from=0`)).status, 400, "too many candles is refused");
    });
    await check("market cap = sum over chains of supply x that chain's price", async () => {
      let mc = 0;
      for (const c of Object.values(coin.chains)) if (c.price) mc += (Number(c.supply) / 1e18) * c.price;
      assert.ok(coin.mc > 0 && Math.abs(coin.mc - mc) / mc < 1e-9);
      assert.ok(coin.holders >= Object.keys(e.balances).length);
    });
  }

  await check("coins list has both coins; bad input is refused", async () => {
    const l = (await api("/api/coins")).body.coins;
    assert.equal(l.length, Object.keys(fx.expect.coins).length);
    assert.equal((await api("/api/coin?coin=nope")).status, 400);
    assert.equal((await api("/api/coin?coin=0x0000000000000000000000000000000000000001")).status, 404);
    assert.equal((await api("/api/candles?coin=" + l[0].chains[Object.keys(l[0].chains)[0]].token + "&res=7")).status, 400);
  });
} finally {
  child.kill("SIGTERM");
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log("--- indexer log ---\n" + logs.slice(-3000)); process.exit(1); }
