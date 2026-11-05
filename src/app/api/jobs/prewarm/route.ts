import { chainByDexscreenerId } from "@/lib/chains";
import { dbEnabled } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { store } from "@/lib/store";
import type { ChainKey } from "@/lib/types";

export const maxDuration = 60;

const STALE_MS = 12 * 60 * 60_000;
const MAX_TRENDING = 30;

async function trending(): Promise<{ chain: ChainKey; address: string }[]> {
  const out: { chain: ChainKey; address: string }[] = [];
  for (const url of ["https://api.dexscreener.com/token-boosts/top/v1", "https://api.dexscreener.com/token-profiles/latest/v1"]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const list = (await res.json()) as { chainId?: string; tokenAddress?: string }[];
      for (const t of Array.isArray(list) ? list : []) {
        const chain = t.chainId ? chainByDexscreenerId(t.chainId)?.key : undefined;
        if (chain && t.tokenAddress?.startsWith("0x")) out.push({ chain, address: t.tokenAddress.toLowerCase() });
      }
    } catch {
      // trending lists are best effort
    }
  }
  return out;
}

/**
 * Daily prewarm (cron, `Authorization: Bearer $CRON_SECRET`): queue low-priority rescans for tokens
 * whose latest snapshot is older than 12 hours, plus trending tokens on supported chains, so their
 * stored history stays current and visitors get a fresh map without waiting.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!dbEnabled()) return Response.json({ error: "needs DATABASE_URL" }, { status: 400 });

  const now = Date.now();
  const stale = (await store().recent(500)).filter((r) => r.chain && now - Date.parse(r.scannedAt) > STALE_MS).map((r) => ({ chain: r.chain, address: r.address.toLowerCase() }));
  const hot = (await trending()).slice(0, MAX_TRENDING);
  const seen = new Set<string>();
  let queued = 0;
  for (const t of [...hot, ...stale]) {
    const k = `${t.chain}:${t.address}`;
    if (seen.has(k) || t.address === "example") continue;
    seen.add(k);
    if (await enqueue(t.chain, t.address, { priority: -1, client: "prewarm" }).catch(() => null)) queued++;
  }
  return Response.json({ queued, stale: stale.length, trending: hot.length });
}
