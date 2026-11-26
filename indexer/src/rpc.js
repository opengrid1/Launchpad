/** A small JSON-RPC client for one chain: tries each RPC in turn, retries with backoff, and splits an
 *  eth_getLogs range in half whenever an RPC refuses it as too large. */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (n) => "0x" + Number(n).toString(16);

const TOO_BIG = /range|exceed|limit exceeded|too many (results|logs|blocks)|10,?000|response size|query returned more/i;
// this RPC's node is a block or two behind: wait, do not shrink the range
const BEHIND = /beyond (the )?current head|block not found|unknown block|after last accepted|future block|not yet available/i;
// this RPC keeps no old state or logs: ask the next one
const NO_HISTORY = /archive|personal token|pruned|missing trie|header not found|not available/i;

export class Rpc {
  constructor(chain) {
    this.chain = chain;
    this.urls = chain.rpcs;
    this.i = 0;
    this.id = 0;
    this.range = chain.maxRange;
    this.gap = Number(chain.minGapMs || 0); // some public RPCs allow only so many requests a minute
    this.next = 0;
    this.ok = 0;
  }

  async pace() {
    if (!this.gap) return;
    const now = Date.now(), at = Math.max(now, this.next);
    this.next = at + this.gap;
    if (at > now) await sleep(at - now);
  }

  async call(method, params, tries = Math.max(5, this.urls.length * 2)) {
    let last;
    for (let a = 0; a < tries; a++) {
      const url = this.urls[(this.i + a) % this.urls.length];
      try {
        await this.pace();
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
          signal: AbortSignal.timeout(30_000),
        });
        if (r.status === 429) throw Object.assign(new Error("rate limited"), { rate: true });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message || "rpc error"), { rpc: j.error });
        this.i = (this.i + a) % this.urls.length; // stick with the RPC that answered
        return j.result;
      } catch (e) {
        last = e;
        if (NO_HISTORY.test(e.message) && !BEHIND.test(e.message)) continue;
        if (BEHIND.test(e.message)) { await sleep(1500); continue; }
        // a "range too big" answer is not worth retrying as is: the caller splits the range
        if (method === "eth_getLogs" && TOO_BIG.test(e.message) && !e.rate && !/rate/i.test(e.message)) throw Object.assign(e, { tooBig: true });
        const rate = e.rate || /rate|too many requests|429/i.test(e.message);
        await sleep(rate ? Math.min(30_000, 2000 * 2 ** a) : Math.min(8000, 400 * 2 ** a));
      }
    }
    throw last;
  }

  async blockNumber() {
    return Number(await this.call("eth_blockNumber", []));
  }

  async block(n) {
    return this.call("eth_getBlockByNumber", [hex(n), false]);
  }

  async tx(hash) {
    return this.call("eth_getTransactionByHash", [hash]);
  }

  async ethCall(to, data, block = "latest") {
    return this.call("eth_call", [{ to, data }, typeof block === "number" ? hex(block) : block]);
  }

  /** All logs matching `filter` in [from, to], fetched in chunks this RPC accepts. */
  async logs(filter, from, to) {
    const out = [];
    let a = from;
    while (a <= to) {
      const b = Math.min(to, a + this.range - 1);
      try {
        const r = await this.call("eth_getLogs", [{ ...filter, fromBlock: hex(a), toBlock: hex(b) }]);
        out.push(...r);
        a = b + 1;
        // after a run of good answers, try a bigger range again (up to the chain's limit)
        if (this.range < this.chain.maxRange && ++this.ok >= 20) { this.range = Math.min(this.chain.maxRange, this.range * 2); this.ok = 0; }
      } catch (e) {
        if (e.tooBig && this.range > 1) {
          this.range = Math.max(1, Math.floor(this.range / 2));
          this.ok = 0;
          continue;
        }
        throw e;
      }
    }
    return out;
  }
}
