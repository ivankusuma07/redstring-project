import { CHAINS } from "../../chains";
import type { ChainKey } from "../../types";
import type { RawTransfer } from "../raw";

/**
 * Alchemy Transfers API (alchemy_getAssetTransfers). Enabled when RPC_<CHAIN> is an Alchemy URL.
 * Free-tier eth_getLogs is capped at ~10 blocks, so history comes from this API instead:
 * 1,000 transfers per page, read as parallel block slices.
 */
export function alchemyUrl(chain: ChainKey): string | null {
  const url = CHAINS[chain].rpc;
  try {
    return new URL(url).hostname.endsWith(".alchemy.com") ? url : null;
  } catch {
    return null;
  }
}
export const alchemyEnabled = (chain: ChainKey) => !!alchemyUrl(chain);

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
  for (let attempt = 0; ; attempt++) {
    if (Date.now() > deadline) throw new Error("Alchemy: out of time");
    const res = await fetch(alchemyUrl(chain)!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method: "alchemy_getAssetTransfers", params: [params] }),
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
    });
    // Compute-unit throttling is per second: keep backing off (max 8 s) until the deadline.
    if (res.status === 429 || res.status === 503) {
      await sleep(Math.min(8_000, 400 * 2 ** Math.min(attempt, 5)));
      continue;
    }
    if (!res.ok) throw new Error(`Alchemy HTTP ${res.status}`);
    const j = (await res.json()) as { result?: Page; error?: { code: number; message: string } };
    if (j.error) {
      if (j.error.code === 429) {
        await sleep(Math.min(8_000, 400 * 2 ** Math.min(attempt, 5)));
        continue;
      }
      throw new Error(`Alchemy: ${j.error.message}`);
    }
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

/** Full ERC-20 Transfer history of a token, oldest first. `complete` is false if time or size ran out. */
export async function transfers(
  chain: ChainKey,
  token: string,
  toBlock: number,
  opts: { maxLogs: number; deadline: number; onProgress?: (p: number) => void; slices?: number; workers?: number },
): Promise<{ transfers: RawTransfer[]; complete: boolean; firstBlock: number | null; stopped?: string; coverage: number; firstTransfer: RawTransfer | null }> {
  const base = { contractAddresses: [token], category: ["erc20"], order: "asc", withMetadata: false, excludeZeroValue: false };
  const first = await call(chain, { ...base, fromBlock: "0x0", toBlock: hex(toBlock), maxCount: "0x1" }, opts.deadline);
  if (!first.transfers.length) return { transfers: [], complete: true, firstBlock: null, coverage: 1, firstTransfer: null };
  const start = Number(BigInt(first.transfers[0].blockNum));

  // Many equal block slices drained by a small worker pool: dense ranges don't leave workers idle,
  // and the pool size stays under the plan's compute-unit throughput (more workers only throttle).
  const n = Math.max(1, Math.min(opts.slices ?? 32, toBlock - start + 1));
  const workers = opts.workers ?? 4;
  const step = Math.ceil((toBlock - start + 1) / n);
  const parts: RawTransfer[][] = Array.from({ length: n }, () => []);
  let count = 0;
  let finished = 0;
  const covered = new Array<number>(n).fill(0); // blocks read per slice
  let next = 0;
  let stop: string | null = null;

  const drain = async (i: number) => {
    const out = parts[i];
    const from = start + i * step;
    const to = Math.min(toBlock, from + step - 1);
    if (from > to) return;
    let pageKey: string | undefined;
    do {
      if (stop) return;
      if (Date.now() > opts.deadline) {
        stop = "time";
        return;
      }
      const page = await call(chain, { ...base, fromBlock: hex(from), toBlock: hex(to), maxCount: "0x3e8", ...(pageKey ? { pageKey } : {}) }, opts.deadline).catch((e) => {
        stop = (e as Error).message;
        return null;
      });
      if (!page) return;
      for (const t of page.transfers) {
        const r = toRaw(t);
        if (r) out.push(r);
      }
      count += page.transfers.length;
      if (count > opts.maxLogs) stop = "size";
      const last = page.transfers.at(-1);
      if (last) covered[i] = Number(BigInt(last.blockNum)) - from + 1;
      pageKey = page.pageKey;
    } while (pageKey);
    covered[i] = to - from + 1;
    finished++;
    opts.onProgress?.(finished / n);
  };
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (next < n && !stop) await drain(next++);
    }),
  );
  return { transfers: parts.flat(), complete: !stop, firstBlock: start, stopped: stop ?? undefined, coverage: covered.reduce((a, b) => a + b, 0) / (toBlock - start + 1), firstTransfer: toRaw(first.transfers[0]) };
}

/** First incoming native transfer (value > 0) for each wallet: its gas funder. */
export async function firstFunders(
  chain: ChainKey,
  wallets: string[],
  toBlock: number,
  deadline: number,
  concurrency = 4,
): Promise<{ funders: Record<string, string>; checked: number }> {
  const found: Record<string, string> = {};
  let checked = 0;
  const queue = [...wallets];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length && Date.now() < deadline) {
        const w = queue.shift()!;
        const page = await call(
          chain,
          { toAddress: w, category: ["external"], order: "asc", excludeZeroValue: true, withMetadata: false, fromBlock: "0x0", toBlock: hex(toBlock), maxCount: "0x1" },
          deadline,
        ).catch(() => null);
        if (page) checked++;
        const t = page?.transfers[0];
        if (t?.from) found[w.toLowerCase()] = t.from.toLowerCase();
      }
    }),
  );
  return { funders: found, checked };
}
