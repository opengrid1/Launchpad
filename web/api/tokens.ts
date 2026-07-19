import { fail, reader, readerS, sendJson } from "./_reader";

/** GET /api/tokens?sort=new|volume|marketCap&limit=60 — the Discover feed. */
export default async function handler(req: any, res: any): Promise<void> {
  try {
    const url = new URL(req.url, "http://localhost");
    const sort = (url.searchParams.get("sort") as any) ?? "new";
    const limit = Math.min(Number(url.searchParams.get("limit")) || 60, 100);
    const [a, b] = await Promise.all([
      reader.getTokens({ sort, limit }),
      readerS.getTokens({ sort, limit }).catch(() => []),
    ]);
    const tokens = [...b, ...a].sort((x: any, y: any) => (y.createdAt ?? 0) - (x.createdAt ?? 0)).slice(0, limit);
    sendJson(res, tokens, 8, 30);
  } catch (err) {
    fail(res, err);
  }
}
