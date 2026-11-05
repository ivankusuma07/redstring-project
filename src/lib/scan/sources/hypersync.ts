import { CHAINS } from "../../chains";
import type { ChainKey } from "../../types";
import type { RawTransfer } from "../raw";
import { TRANSFER_TOPIC } from "./rpc";

/** Envio HyperSync JSON API. Needs a (free) API token in HYPERSYNC_TOKEN. */
const token = () => process.env.HYPERSYNC_TOKEN;
export const hypersyncEnabled = () => !!token();

type Num = number | string;
const num = (v: Num | undefined | null) =>
  v == null ? 0 : typeof v === "number" ? v : Number(BigInt(v));
const big = (v: Num | undefined | null) =>
  v == null || v === "0x" ? 0n : BigInt(v);

interface HsLog {
  block_number?: Num;
  transaction_hash?: string;
  topic1?: string;
  topic2?: string;
  topic3?: string | null;
  data?: string;
}
interface HsTx {
  block_number?: Num;
  from?: string;
  to?: string;
  value?: Num;
}
interface HsBlock {
  number?: Num;
  timestamp?: Num;
}
interface HsBatch {
  logs?: HsLog[];
  transactions?: HsTx[];
  blocks?: HsBlock[];
}
interface HsResponse {
  data: HsBatch[] | HsBatch;
  next_block: number;
  archive_height?: number;
}

/**
 * HyperSync meters requests per token (e.g. 15,000 units / 60 s at 1,000 per query). One budget is
 * shared by every scan in this process: when the window is spent, queries wait for the reset
 * instead of failing. Waits never run past the caller's deadline.
 */
const budget = { pauseUntil: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HypersyncBudgetError extends Error {}

async function query(
  chain: ChainKey,
  body: unknown,
  deadline = Date.now() + 120_000,
): Promise<HsResponse> {
  for (let attempt = 0; ; attempt++) {
    const wait = budget.pauseUntil - Date.now();
    if (wait > 0) {
      if (Date.now() + wait > deadline)
        throw new HypersyncBudgetError(
          "HyperSync rate limit: out of time waiting for the next window",
        );
      await sleep(wait);
    }
    const res = await fetch(`${CHAINS[chain].hypersync}/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const resetMs =
      (Number.isFinite(reset) && reset > 0 ? reset : 10) * 1000 + 250;
    if (res.status === 429) {
      budget.pauseUntil = Math.max(budget.pauseUntil, Date.now() + resetMs);
      if (attempt >= 8) throw new HypersyncBudgetError("HyperSync rate limit");
      continue;
    }
    if (!res.ok) throw new Error(`HyperSync HTTP ${res.status}`);
    const remaining = Number(res.headers.get("x-ratelimit-remaining"));
    const cost = Number(res.headers.get("x-ratelimit-cost")) || 1000;
    if (Number.isFinite(remaining) && remaining < cost)
      budget.pauseUntil = Math.max(budget.pauseUntil, Date.now() + resetMs);
    return (await res.json()) as HsResponse;
  }
}

const batches = (r: HsResponse): HsBatch[] =>
  Array.isArray(r.data) ? r.data : [r.data];
const topicAddr = (t: string) => `0x${t.slice(-40)}`.toLowerCase();

/** Full Transfer history for a token, plus block timestamps. */
export async function transfers(
  chain: ChainKey,
  tokenAddr: string,
  toBlock: number,
  opts: { maxLogs: number; deadline: number; onProgress?: (p: number) => void },
): Promise<{
  transfers: RawTransfer[];
  blockTimes: Record<number, number>;
  complete: boolean;
}> {
  const out: RawTransfer[] = [];
  const times: Record<number, number> = {};
  let from = 0;
  while (from < toBlock) {
    if (Date.now() > opts.deadline || out.length > opts.maxLogs)
      return { transfers: out, blockTimes: times, complete: false };
    const r = await query(
      chain,
      {
        from_block: from,
        to_block: toBlock + 1,
        max_num_logs: 100_000,
        logs: [{ address: [tokenAddr], topics: [[TRANSFER_TOPIC]] }],
        field_selection: {
          log: [
            "block_number",
            "transaction_hash",
            "topic1",
            "topic2",
            "topic3",
            "data",
          ],
          block: ["number", "timestamp"],
        },
      },
      opts.deadline,
    );
    for (const b of batches(r)) {
      for (const l of b.logs ?? []) {
        if (!l.topic1 || !l.topic2 || l.topic3) continue;
        out.push({
          from: topicAddr(l.topic1),
          to: topicAddr(l.topic2),
          value: big(l.data?.slice(0, 66)),
          block: num(l.block_number),
          tx: l.transaction_hash ?? null,
        });
      }
      for (const bl of b.blocks ?? [])
        times[num(bl.number)] = num(bl.timestamp);
    }
    if (!r.next_block || r.next_block <= from) break;
    from = r.next_block;
    opts.onProgress?.(from / toBlock);
  }
  return { transfers: out, blockTimes: times, complete: true };
}

/** First incoming native transfer (value > 0) for each wallet: its gas funder. */
export async function firstFunders(
  chain: ChainKey,
  wallets: string[],
  toBlock: number,
  deadline: number,
): Promise<Record<string, string>> {
  const pending = new Set(wallets.map((w) => w.toLowerCase()));
  const found: Record<string, string> = {};
  let from = 0;
  for (let page = 0; page < 40 && pending.size && from < toBlock; page++) {
    if (Date.now() > deadline) break;
    const r = await query(
      chain,
      {
        from_block: from,
        to_block: toBlock + 1,
        transactions: [{ to: [...pending] }],
        field_selection: {
          transaction: ["block_number", "from", "to", "value"],
        },
      },
      deadline,
    );
    for (const b of batches(r))
      for (const t of b.transactions ?? []) {
        const to = t.to?.toLowerCase();
        if (!to || !pending.has(to) || big(t.value) === 0n || !t.from) continue;
        found[to] = t.from.toLowerCase();
        pending.delete(to);
      }
    if (!r.next_block || r.next_block <= from) break;
    from = r.next_block;
  }
  return found;
}
