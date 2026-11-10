import { CHAINS } from "../../chains";
import type { ChainKey } from "../../types";
import type { RawTransfer } from "../raw";
import { BUSY_BENCH_MS, isDown, markDown, QUOTA_BENCH_MS, refusal } from "./endpoints";

/**
 * Alchemy Transfers API (alchemy_getAssetTransfers). Enabled when RPC_<CHAIN> is an Alchemy URL.
 * Free-tier eth_getLogs is capped at ~10 blocks, so history comes from this API instead:
 * 1,000 transfers per page, read as parallel block slices.
 * When the key is refused (monthly quota, revoked) or stays throttled, Alchemy is benched for a
 * while and alchemyEnabled() turns false, so scans use HyperSync and public RPCs instead.
 */
export function alchemyUrl(chain: ChainKey): string | null {
  const url = CHAINS[chain].rpc;
  try {
    return new URL(url).hostname.endsWith(".alchemy.com") ? url : null;
  } catch {
    return null;
  }
}
export const alchemyEnabled = (chain: ChainKey) => {
  const url = alchemyUrl(chain);
  return !!url && !isDown(url);
};

/** Alchemy refused or stayed throttled; callers should move on to another source. */
export class AlchemyUnavailable extends Error {}

/** Longest stretch of per-second throttling to sit through before giving up on Alchemy for now. */
const MAX_THROTTLE_MS = 60_000;

interface AlchemyTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string | null;
  rawContract: { value: string | null; address: string | null };
}
interface Page {
  transfers: AlchemyTransfer[];
  pageKey?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (n: number) => `0x${n.toString(16)}`;
let rid = 1;

async function call(chain: ChainKey, params: Record<string, unknown>, deadline: number): Promise<Page> {
  const url = alchemyUrl(chain)!;
  let throttledSince: number | null = null;
  for (let attempt = 0; ; attempt++) {
    if (Date.now() > deadline) throw new Error("Alchemy: out of time");
    if (isDown(url)) throw new AlchemyUnavailable("Alchemy is unavailable right now");
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method: "alchemy_getAssetTransfers", params: [params] }),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });
    } catch (e) {
      markDown(url, BUSY_BENCH_MS, `unreachable (${(e as Error).name})`);
      throw new AlchemyUnavailable("Alchemy is unreachable");
    }
    const text = await res.text().catch(() => "");
    let j: { result?: Page; error?: { code: number; message: string } } = {};
    try {
      j = JSON.parse(text);
    } catch {
      j = { error: { code: res.status, message: text.slice(0, 200) } };
    }
    const refused = refusal(res.status, j.error?.code, j.error?.message);
    if (refused === "quota") {
      markDown(url, QUOTA_BENCH_MS, j.error?.message || `HTTP ${res.status}`);
      throw new AlchemyUnavailable(`Alchemy refused the key: ${j.error?.message ?? res.status}`);
    }
    // Compute-unit throttling is per second: back off (max 8 s), but not forever.
    if (refused === "throttle") {
      throttledSince ??= Date.now();
      if (Date.now() - throttledSince > MAX_THROTTLE_MS) {
        markDown(url, BUSY_BENCH_MS, "throttled for over a minute");
        throw new AlchemyUnavailable("Alchemy kept throttling");
      }
      await sleep(Math.min(8_000, 400 * 2 ** Math.min(attempt, 5)));
      continue;
    }
    if (j.error) throw new Error(`Alchemy: ${j.error.message}`);
    if (!res.ok) throw new Error(`Alchemy HTTP ${res.status}`);
    return j.result!;
  }
}

const toRaw = (t: AlchemyTransfer): RawTransfer | null =>
  t.to
    ? {
        from: t.from.toLowerCase(),
        to: t.to.toLowerCase(),
        value: t.rawContract.value && t.rawContract.value !== "0x" ? BigInt(t.rawContract.value) : 0n,
        block: Number(BigInt(t.blockNum)),
        tx: t.hash,
      }
    : null;

const transferQuery = (token: string) => ({ contractAddresses: [token], category: ["erc20"], order: "asc", withMetadata: false, excludeZeroValue: false });

/** The token's first ERC-20 transfer (usually its mint), or null if it has none. */
export async function firstTransfer(chain: ChainKey, token: string, toBlock: number, deadline: number): Promise<RawTransfer | null> {
  const page = await call(chain, { ...transferQuery(token), fromBlock: "0x0", toBlock: hex(toBlock), maxCount: "0x1" }, deadline);
  return page.transfers[0] ? toRaw(page.transfers[0]) : null;
}

/** Every Transfer of a token in [from, to], oldest first, 1,000 per page. Throws if time runs out. */
export async function range(chain: ChainKey, token: string, from: number, to: number, deadline: number): Promise<RawTransfer[]> {
  const out: RawTransfer[] = [];
  let pageKey: string | undefined;
  do {
    const page = await call(chain, { ...transferQuery(token), fromBlock: hex(from), toBlock: hex(to), maxCount: "0x3e8", ...(pageKey ? { pageKey } : {}) }, deadline);
    for (const t of page.transfers) {
      const r = toRaw(t);
      if (r) out.push(r);
    }
    pageKey = page.pageKey;
  } while (pageKey);
  return out;
}

/** First incoming native transfer (value > 0) for each wallet: its gas funder. */
export async function firstFunders(
  chain: ChainKey,
  wallets: string[],
  toBlock: number,
  deadline: number,
  concurrency = 4,
): Promise<{ funders: Record<string, string>; checked: number; unchecked: string[] }> {
  const found: Record<string, string> = {};
  let checked = 0;
  const failed: string[] = [];
  let unavailable: AlchemyUnavailable | null = null;
  const queue = [...wallets];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length && Date.now() < deadline && !unavailable) {
        const w = queue.shift()!;
        const page = await call(
          chain,
          { toAddress: w, category: ["external"], order: "asc", excludeZeroValue: true, withMetadata: false, fromBlock: "0x0", toBlock: hex(toBlock), maxCount: "0x1" },
          deadline,
        ).catch((e) => {
          if (e instanceof AlchemyUnavailable) unavailable = e;
          return null;
        });
        if (page) checked++;
        else failed.push(w);
        const t = page?.transfers[0];
        if (t?.from) found[w.toLowerCase()] = t.from.toLowerCase();
      }
    }),
  );
  // Nothing checked because Alchemy is out: let the caller try another source.
  if (unavailable && !checked) throw unavailable;
  return { funders: found, checked, unchecked: [...failed, ...queue] };
}
