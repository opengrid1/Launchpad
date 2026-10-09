import { env } from "./env";

/** Plain JSON-RPC view calls against NEAR, with endpoint rotation. */
let i = 0;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  let lastErr: unknown;
  for (let k = 0; k < env.rpcUrls.length; k++) {
    const url = env.rpcUrls[(i + k) % env.rpcUrls.length];
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) throw new Error(`rpc ${r.status}`);
      const j = await r.json();
      if (j.error) {
        // A contract panic is not an endpoint problem: surface it as-is.
        const msg = j.error?.data ?? j.error?.message ?? "rpc error";
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      return j.result as T;
    } catch (e) {
      lastErr = e;
      i++;
    }
  }
  throw lastErr;
}

const enc = (o: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));

/** Calls a view method and decodes its JSON result. */
export async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: enc(args),
  });
  if (r.error) throw new Error(r.error);
  const text = new TextDecoder().decode(Uint8Array.from(r.result));
  return JSON.parse(text) as T;
}

export async function accountBalance(accountId: string): Promise<bigint> {
  try {
    const r = await rpc<{ amount: string }>("query", { request_type: "view_account", finality: "final", account_id: accountId });
    return BigInt(r.amount);
  } catch {
    return 0n;
  }
}

/** Runs view calls a few at a time so a long list does not hammer the endpoint. */
export async function mapLimit<A, B>(items: A[], limit: number, fn: (a: A) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
