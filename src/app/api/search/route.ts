import { search, type SearchHit } from "@/lib/scan/sources/dexscreener";

/** Ticker / name search across the three supported chains (DexScreener). */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().replace(/^\$/, "") ?? "";
  if (q.length < 2) return Response.json({ hits: [] });
  const hits: SearchHit[] = await search(q);
  if ("example".startsWith(q.toLowerCase()))
    hits.unshift({ chain: "robinhood", address: "example", symbol: "EXAMPLE", name: "Example Token (illustrative)", liquidityUsd: 0, logo: null });
  return Response.json({ hits }, { headers: { "cache-control": "public, max-age=60" } });
}
