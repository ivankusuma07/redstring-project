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
