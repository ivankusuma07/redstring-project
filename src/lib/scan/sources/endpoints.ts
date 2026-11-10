import { CHAINS } from "../../chains";
import type { ChainKey } from "../../types";

/**
 * Endpoint health, shared by every RPC-style source in this process.
 *
 * When a provider refuses work (an exhausted monthly quota, a revoked key, or throttling that
 * outlasts the retries), its URL is benched for a while and callers move on to the next endpoint
 * instead of failing the scan. Benches are per process and expire on their own, so a provider
 * that recovers (new billing month, raised plan) is used again without a restart.
 */

/** Monthly quota gone or key refused: no point retrying soon. */
export const QUOTA_BENCH_MS = 60 * 60_000;
/** Throttled or unreachable: try again shortly. */
export const BUSY_BENCH_MS = 2 * 60_000;

const g = globalThis as unknown as { __rsBench?: Map<string, number> };
const bench = (g.__rsBench ??= new Map());

/** Host only: keyed URLs (Alchemy) carry the key in the path, which must never reach the logs. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
};

export function markDown(url: string, ms: number, reason: string) {
  const until = Date.now() + ms;
  if ((bench.get(url) ?? 0) < until) {
    bench.set(url, until);
    console.warn(`[rpc] ${hostOf(url)} benched for ${Math.round(ms / 60_000)} min: ${reason.slice(0, 120)}`);
  }
}

export function isDown(url: string) {
  const until = bench.get(url);
  if (until == null) return false;
  if (Date.now() < until) return true;
  bench.delete(url);
  return false;
}

/** Test hook. */
export const resetHealth = () => bench.clear();

/**
 * How a provider refused a request, if it did:
 * - "quota": the key won't be served for a long time (Alchemy "Monthly capacity limit exceeded",
 *   an exhausted plan, a revoked key, HTTP 401/402/403);
 * - "throttle": a per-second rate limit that clears within seconds (HTTP 429/503, JSON-RPC 429);
 * - null: not a refusal. Other errors, including HTTP 400 "block range too wide" and archive-only
 *   reads on a pruned node, belong to the call.
 */
export function refusal(status: number, errCode: number | undefined, message = ""): "quota" | "throttle" | null {
  // Pruned public nodes answer old-block reads with 403 "archive requests require a token":
  // that call can't be served there, but the endpoint is fine for everything else.
  if (/archive|missing trie node|state .*(not available|unknown)|unknown state/i.test(message)) return null;
  if (status === 401 || status === 402 || status === 403) return "quota";
  if (status !== 429 && status !== 503 && errCode !== 429) return null;
  return /monthly|quota|upgrade|plan|capacity limit|api key|unauthori[sz]ed|forbidden/i.test(message) ? "quota" : "throttle";
}

/**
 * Endpoints to try for a chain, best first: `primary` (default: the configured RPC), then the public
 * fallbacks. Pass the logs endpoint as `primary` for eth_getLogs; the configured RPC is then left
 * out, because keyed free tiers cap getLogs to a few blocks.
 * Benched endpoints go to the back rather than disappearing, so if everything is benched the
 * caller still has something to try.
 */
export function rpcUrls(chain: ChainKey, primary: string = CHAINS[chain].rpc): string[] {
  const all = [...new Set([primary, ...CHAINS[chain].rpcFallbacks])];
  return [...all.filter((u) => !isDown(u)), ...all.filter((u) => isDown(u))];
}
