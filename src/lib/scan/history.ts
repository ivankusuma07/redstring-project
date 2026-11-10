import { gunzipSync, gzipSync } from "node:zlib";
import { CHAINS } from "../chains";
import type { ChainKey } from "../types";
import { ZERO, type RawTransfer } from "./raw";
import * as al from "./sources/alchemy";
import * as hs from "./sources/hypersync";
import * as rpc from "./sources/rpc";

/**
 * Stored, resumable transfer history.
 *
 * A token's Transfer log is read once and kept as chunks, each covering a closed block range.
 * A scan reads only the gaps (first block → confirmed tip) and saves every chunk as soon as it is
 * read, so an interrupted read resumes where it stopped and a rescan only reads new blocks. The
 * last REORG_DEPTH blocks are re-read every time and never stored.
 */

export interface Range {
  from: number;
  to: number;
}

export interface HistoryStore {
  meta(chain: ChainKey, token: string): Promise<{ firstBlock: number | null; first: RawTransfer | null; ranges: Range[] } | null>;
  setFirst(chain: ChainKey, token: string, firstBlock: number, first: RawTransfer | null): Promise<void>;
  addChunk(chain: ChainKey, token: string, range: Range, transfers: RawTransfer[]): Promise<void>;
  load(chain: ChainKey, token: string): Promise<RawTransfer[]>;
  funders(chain: ChainKey, wallets: string[]): Promise<Record<string, string>>;
  saveFunders(chain: ChainKey, funders: Record<string, string>): Promise<void>;
}

export const REORG_DEPTH = 50;

/** Blocks per stored chunk: roughly weeks of history, so a lost in-flight chunk costs little. */
// About three to four weeks of blocks per slice (BNB Chain ~0.75 s blocks, Arbitrum ~0.25 s).
const SLICE_BLOCKS: Record<ChainKey, number> = { robinhood: 5_000_000, base: 1_000_000, ethereum: 200_000, bnb: 3_000_000, arbitrum: 8_000_000 };

// ---- pure helpers --------------------------------------------------------------

/** Parts of `target` not covered by `covered` (ranges are inclusive). */
export function gaps(target: Range, covered: Range[]): Range[] {
  const out: Range[] = [];
  let cursor = target.from;
  for (const r of [...covered].sort((a, b) => a.from - b.from)) {
    if (r.to < cursor) continue;
    if (r.from > target.to) break;
    if (r.from > cursor) out.push({ from: cursor, to: Math.min(r.from - 1, target.to) });
    cursor = Math.max(cursor, r.to + 1);
    if (cursor > target.to) break;
  }
  if (cursor <= target.to) out.push({ from: cursor, to: target.to });
  return out;
}

/** Split a range into consecutive slices of at most `size` blocks. */
export function slices(r: Range, size: number): Range[] {
  const out: Range[] = [];
  for (let from = r.from; from <= r.to; from += size) out.push({ from, to: Math.min(r.to, from + size - 1) });
  return out;
}

export const span = (rs: Range[]) => rs.reduce((n, r) => n + (r.to - r.from + 1), 0);

/** Compact chunk encoding. Transaction hashes are kept for mints only (deployer detection). */
export function encodeChunk(ts: RawTransfer[]): Buffer {
  const rows = ts.map((t) => [t.from, t.to, t.value.toString(16), t.block, t.from === ZERO ? t.tx : 0]);
  return gzipSync(JSON.stringify(rows));
}

export function decodeChunk(buf: Buffer): RawTransfer[] {
  const rows = JSON.parse(gunzipSync(buf).toString("utf8")) as [string, string, string, number, string | 0][];
  return rows.map(([from, to, v, block, tx]) => ({ from, to, value: BigInt(`0x${v}`), block, tx: tx || null }));
}

// ---- in-memory store (local dev, CLI, tests) -----------------------------------------

export class MemoryHistoryStore implements HistoryStore {
  private tokens = new Map<string, { firstBlock: number | null; first: RawTransfer | null; chunks: { range: Range; data: Buffer }[] }>();
  private funderMap = new Map<string, string>();
  private key = (c: ChainKey, t: string) => `${c}:${t}`;
  private entry(c: ChainKey, t: string) {
    const k = this.key(c, t);
    if (!this.tokens.has(k)) this.tokens.set(k, { firstBlock: null, first: null, chunks: [] });
    return this.tokens.get(k)!;
  }
  async meta(c: ChainKey, t: string) {
    const e = this.tokens.get(this.key(c, t));
    return e ? { firstBlock: e.firstBlock, first: e.first, ranges: e.chunks.map((x) => x.range) } : null;
  }
  async setFirst(c: ChainKey, t: string, firstBlock: number, first: RawTransfer | null) {
    Object.assign(this.entry(c, t), { firstBlock, first });
  }
  async addChunk(c: ChainKey, t: string, range: Range, transfers: RawTransfer[]) {
    this.entry(c, t).chunks.push({ range, data: encodeChunk(transfers) });
  }
  async load(c: ChainKey, t: string) {
    const e = this.tokens.get(this.key(c, t));
    return e ? [...e.chunks].sort((a, b) => a.range.from - b.range.from).flatMap((x) => decodeChunk(x.data)) : [];
  }
  async funders(c: ChainKey, wallets: string[]) {
    return Object.fromEntries(wallets.flatMap((w) => (this.funderMap.has(`${c}:${w}`) ? [[w, this.funderMap.get(`${c}:${w}`)!]] : [])));
  }
  async saveFunders(c: ChainKey, f: Record<string, string>) {
    for (const [w, x] of Object.entries(f)) this.funderMap.set(`${c}:${w}`, x);
  }
}

const g = globalThis as unknown as { __rsMemHistory?: MemoryHistoryStore };
export const memoryHistory = () => (g.__rsMemHistory ??= new MemoryHistoryStore());

// ---- sources ---------------------------------------------------------------------------

class OutOfTime extends Error {}

export interface Fetcher {
  name: string;
  /** Parallel slice reads that stay under the provider's rate limit. */
  concurrency: number;
  /** First block worth reading, plus the first transfer when the source knows it. null = no transfers. */
  first(deadline: number): Promise<{ block: number; transfer: RawTransfer | null } | null>;
  read(r: Range, deadline: number): Promise<RawTransfer[]>;
}

function rpcFetcher(chain: ChainKey, token: string, latest: number): Fetcher {
  return {
    name: "RPC log replay",
    concurrency: 2,
    first: async () => ({ block: await rpc.findDeployBlock(chain, token, latest), transfer: null }),
    read: async (r, deadline) => {
      try {
        return await rpc.replayTransfers(chain, token, r.from, r.to, { maxLogs: Number.MAX_SAFE_INTEGER, deadline });
      } catch (e) {
        if (e instanceof rpc.TooLargeError && Date.now() > deadline) throw new OutOfTime();
        throw e;
      }
    },
  };
}

function alchemyFetcher(chain: ChainKey, token: string, latest: number): Fetcher {
  return {
    name: "Alchemy",
    concurrency: 4,
    first: async (deadline) => {
      const t = await al.firstTransfer(chain, token, latest, deadline);
      return t ? { block: t.block, transfer: t } : null;
    },
    read: async (r, deadline) => {
      try {
        return await al.range(chain, token, r.from, r.to, deadline);
      } catch (e) {
        if (Date.now() > deadline) throw new OutOfTime();
        throw e;
      }
    },
  };
}

function hypersyncFetcher(chain: ChainKey, token: string, latest: number): Fetcher {
  return {
    name: "HyperSync",
    concurrency: 1,
    // HyperSync finds the first transfer itself; the RPC deploy-block search needs an archive node,
    // which the public fallbacks are not.
    first: async (deadline) => {
      const t = await hs.firstTransfer(chain, token, latest, deadline).catch(() => undefined);
      if (t !== undefined) return t ? { block: t.block, transfer: t } : null;
      return { block: await rpc.findDeployBlock(chain, token, latest), transfer: null };
    },
    read: async (r, deadline) => {
      const res = await hs.transfers(chain, token, r.to, { fromBlock: r.from, maxLogs: Number.MAX_SAFE_INTEGER, deadline });
      if (!res.complete) throw new OutOfTime();
      return res.transfers.filter((t) => t.block <= r.to);
    },
  };
}

/**
 * Sources in order of preference. Robinhood Chain's public RPC serves 10M-block getLogs windows,
 * so it goes first there; elsewhere Alchemy's Transfers API, then HyperSync, then public RPC.
 */
export function fetchersFor(chain: ChainKey, token: string, latest: number): Fetcher[] {
  const list: Fetcher[] = [];
  if (CHAINS[chain].logRange >= 1_000_000) {
    list.push(rpcFetcher(chain, token, latest));
    if (hs.hypersyncEnabled()) list.push(hypersyncFetcher(chain, token, latest));
  } else {
    if (al.alchemyEnabled(chain)) list.push(alchemyFetcher(chain, token, latest));
    if (hs.hypersyncEnabled()) list.push(hypersyncFetcher(chain, token, latest));
    list.push(rpcFetcher(chain, token, latest));
  }
  return list;
}

// ---- reading -----------------------------------------------------------------------------

export interface HistoryResult {
  transfers: RawTransfer[]; // oldest first
  complete: boolean; // every block from the first transfer to the tip is read
  coverage: number; // 0–1 share of that block range read
  first: RawTransfer | null; // the token's first transfer, when known
  firstBlock: number | null;
  source: string | null;
  read: number; // transfers fetched by this call (excluding stored ones)
}

export async function readHistory(
  chain: ChainKey,
  token: string,
  latest: number,
  opts: { store: HistoryStore; deadline: number; onProgress?: (p: number) => void; fetchers?: Fetcher[] },
): Promise<HistoryResult> {
  const { store, deadline } = opts;
  const fetchers = opts.fetchers ?? fetchersFor(chain, token, latest);
  const confirmed = latest - REORG_DEPTH;
  let meta = await store.meta(chain, token);

  // 1. Where history starts
  let source: Fetcher | null = null;
  if (meta?.firstBlock == null) {
    for (const f of fetchers) {
      try {
        const first = await f.first(deadline);
        if (!first) return { transfers: [], complete: true, coverage: 1, first: null, firstBlock: null, source: f.name, read: 0 };
        await store.setFirst(chain, token, first.block, first.transfer);
        source = f;
        break;
      } catch {
        // try the next source
      }
    }
    meta = await store.meta(chain, token);
    if (meta?.firstBlock == null) throw new Error("No data source could locate this token's history.");
  }
  const firstBlock = meta.firstBlock!;
  const target: Range = { from: firstBlock, to: Math.max(firstBlock, confirmed) };
  const total = Math.max(1, target.to - target.from + 1);

  // 2. Read the gaps slice by slice, saving each one; the first source that works carries on.
  const todo = gaps(target, meta.ranges).flatMap((gap) => slices(gap, SLICE_BLOCKS[chain]));
  let covered = span(meta.ranges.filter((r) => r.to >= target.from));
  let read = 0;
  let stopped = false;
  let next = 0;
  const run = async (f: Fetcher) => {
    while (!stopped && next < todo.length) {
      if (Date.now() > deadline) {
        stopped = true;
        return;
      }
      const slice = todo[next++];
      let got: RawTransfer[] | null = null;
      for (const alt of [f, ...fetchers.filter((x) => x !== f)]) {
        try {
          got = await alt.read(slice, deadline);
          break;
        } catch (e) {
          if (e instanceof OutOfTime) {
            stopped = true;
            return;
          }
          // provider error: fall through to the next source for this slice
        }
      }
      if (!got) {
        stopped = true;
        return;
      }
      await store.addChunk(chain, token, slice, got);
      read += got.length;
      covered += slice.to - slice.from + 1;
      opts.onProgress?.(covered / total);
    }
  };
  const primary = source ?? fetchers[0];
  if (todo.length) await Promise.all(Array.from({ length: primary.concurrency }, () => run(primary)));

  // 3. Unconfirmed tip: always fresh, never stored
  let tip: RawTransfer[] = [];
  if (latest > target.to) {
    for (const f of fetchers) {
      try {
        tip = await f.read({ from: target.to + 1, to: latest }, Math.max(deadline, Date.now() + 20_000));
        break;
      } catch {
        // tip is best effort
      }
    }
  }

  const after = await store.meta(chain, token);
  const remaining = gaps(target, after?.ranges ?? []);
  const stored = await store.load(chain, token);
  const transfers = [...stored, ...tip].sort((a, b) => a.block - b.block); // stable: keeps log order within a block
  return {
    transfers,
    complete: remaining.length === 0,
    coverage: Math.min(1, 1 - span(remaining) / total),
    // the earliest loaded transfer is the token's first only if the start of the range was read
    first: after?.first ?? (remaining.some((r) => r.from === target.from) ? null : (transfers[0] ?? null)),
    firstBlock,
    source: primary.name,
    read,
  };
}
