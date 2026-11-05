/**
 * Stored, resumable transfer history: gap maths, chunk encoding, and resume-after-timeout.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeChunk, encodeChunk, gaps, MemoryHistoryStore, readHistory, REORG_DEPTH, slices, span, type Fetcher, type Range } from "../src/lib/scan/history";
import { ZERO, type RawTransfer } from "../src/lib/scan/raw";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";

test("gaps: uncovered parts of a range", () => {
  assert.deepEqual(gaps({ from: 0, to: 99 }, []), [{ from: 0, to: 99 }]);
  assert.deepEqual(gaps({ from: 0, to: 99 }, [{ from: 0, to: 99 }]), []);
  assert.deepEqual(
    gaps({ from: 0, to: 99 }, [
      { from: 40, to: 59 },
      { from: 10, to: 19 },
    ]),
    [
      { from: 0, to: 9 },
      { from: 20, to: 39 },
      { from: 60, to: 99 },
    ],
  );
  // covered ranges reaching outside the target are clipped
  assert.deepEqual(gaps({ from: 50, to: 99 }, [{ from: 0, to: 60 }, { from: 90, to: 200 }]), [{ from: 61, to: 89 }]);
});

test("slices and span", () => {
  assert.deepEqual(slices({ from: 0, to: 24 }, 10), [
    { from: 0, to: 9 },
    { from: 10, to: 19 },
    { from: 20, to: 24 },
  ]);
  assert.equal(span([{ from: 0, to: 9 }, { from: 20, to: 24 }]), 15);
});

test("chunk encoding round-trips; tx hashes kept for mints only", () => {
  const ts: RawTransfer[] = [
    { from: ZERO, to: A, value: 10n ** 24n, block: 5, tx: "0xmint" },
    { from: A, to: B, value: 123n, block: 9, tx: "0xtransfer" },
  ];
  const back = decodeChunk(encodeChunk(ts));
  assert.deepEqual(back, [ts[0], { ...ts[1], tx: null }]);
});

/** A fake source with one transfer every 10 blocks that can be told to stop after N slice reads. */
function fakeFetcher(firstBlock: number, opts: { budget?: number } = {}) {
  let reads = 0;
  const ranges: Range[] = [];
  const f: Fetcher = {
    name: "fake",
    concurrency: 1,
    first: async () => ({ block: firstBlock, transfer: { from: ZERO, to: A, value: 1000n, block: firstBlock, tx: "0xmint" } }),
    read: async (r) => {
      if (opts.budget != null && reads >= opts.budget) throw new Error("rate limited");
      reads++;
      ranges.push(r);
      const out: RawTransfer[] = [];
      for (let b = Math.ceil(r.from / 10) * 10; b <= r.to; b += 10) out.push(b === firstBlock ? { from: ZERO, to: A, value: 1000n, block: b, tx: "0xmint" } : { from: A, to: B, value: 1n, block: b, tx: null });
      return out;
    },
  };
  return { f, ranges, setBudget: (n?: number) => (opts.budget = n == null ? undefined : reads + n) };
}

test("readHistory: partial read, then resume, then only new blocks", async () => {
  const store = new MemoryHistoryStore();
  const chain = "ethereum" as const; // 200k-block slices
  const token = "0x00000000000000000000000000000000000000cc";
  const first = 1_000_000;
  const latest = first + 1_000_000; // five slices + an unconfirmed tip
  const src = fakeFetcher(first, { budget: 2 });

  // 1. the source gives out after two slices: partial, not complete, first mint known
  const r1 = await readHistory(chain, token, latest, { store, deadline: Date.now() + 60_000, fetchers: [src.f] });
  assert.equal(r1.complete, false);
  assert.ok(r1.coverage > 0.35 && r1.coverage < 0.45, `coverage ${r1.coverage}`);
  assert.equal(r1.first?.tx, "0xmint");
  assert.equal(r1.transfers[0].block, first);

  // 2. resume: only the gaps are read, history becomes complete
  src.setBudget();
  const before = src.ranges.length;
  const r2 = await readHistory(chain, token, latest, { store, deadline: Date.now() + 60_000, fetchers: [src.f] });
  assert.equal(r2.complete, true);
  assert.equal(r2.coverage, 1);
  const resumed = src.ranges.slice(before);
  assert.equal(resumed[0].from, first + 2 * 200_000, "resumes after the stored slices");
  assert.equal(r2.transfers.length, (latest - first) / 10 + 1);
  assert.ok(r2.transfers.every((t, i, a) => i === 0 || a[i - 1].block <= t.block), "sorted by block");

  // 3. later scan: confirmed new blocks + the tip only; the unconfirmed tip is never stored
  const later = latest + 500;
  const n = src.ranges.length;
  const r3 = await readHistory(chain, token, later, { store, deadline: Date.now() + 60_000, fetchers: [src.f] });
  assert.equal(r3.complete, true);
  const newReads = src.ranges.slice(n);
  assert.deepEqual(newReads[0], { from: latest - REORG_DEPTH + 1, to: later - REORG_DEPTH });
  assert.deepEqual(newReads[1], { from: later - REORG_DEPTH + 1, to: later });
  assert.equal(r3.transfers.length, (later - first) / 10 + 1);
  const meta = await store.meta(chain, token);
  assert.ok(meta!.ranges.every((r) => r.to <= later - REORG_DEPTH), "tip not stored");
});

test("readHistory: a failing source falls back to the next one per slice", async () => {
  const store = new MemoryHistoryStore();
  const bad = fakeFetcher(0, { budget: 0 });
  const good = fakeFetcher(0);
  const r = await readHistory("ethereum", "0x00000000000000000000000000000000000000dd", 400_100, { store, deadline: Date.now() + 60_000, fetchers: [bad.f, good.f] });
  assert.equal(r.complete, true);
  assert.equal(bad.ranges.length, 0);
  assert.ok(good.ranges.length >= 2);
});

test("readHistory: token with no transfers", async () => {
  const none: Fetcher = { name: "none", concurrency: 1, first: async () => null, read: async () => [] };
  const r = await readHistory("base", "0x00000000000000000000000000000000000000ee", 1000, { store: new MemoryHistoryStore(), deadline: Date.now() + 1000, fetchers: [none] });
  assert.equal(r.complete, true);
  assert.equal(r.transfers.length, 0);
});
