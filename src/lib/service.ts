import "server-only";
import { dbEnabled } from "./db";
import { historyStore } from "./history-store";
import { enqueue, followJob } from "./jobs";
import { allow } from "./ratelimit";
import { analyze } from "./scan/analyze";
import { collect, ScanError } from "./scan/collect";
import { EXAMPLE_ADDRESS, exampleSnapshot, isExampleAddress } from "./scan/example";
import { sealingConfigured } from "./seal/anchor";
import { snapshotHash } from "./seal/hash";
import { store } from "./store";
import type { ChainKey, ScanEvent, Seal, StoredSnapshot } from "./types";

export const CACHE_TTL_MS = 15 * 60_000;
export const RESCAN_MIN_MS = 2 * 60_000;

export function exampleRecord(): StoredSnapshot {
  const snapshot = exampleSnapshot();
  return {
    id: "example",
    snapshot,
    seal: {
      status: "example",
      snapshotHash: snapshotHash(snapshot),
      merkleRoot: null,
      proof: [],
      batchCount: null,
      txHash: null,
      anchorBlock: null,
      contract: null,
      sealedAt: null,
    },
  };
}

export async function getStored(chain: ChainKey, address: string): Promise<StoredSnapshot | null> {
  if (chain === "robinhood" && isExampleAddress(address)) return exampleRecord();
  return store().latest(chain, address.toLowerCase());
}

/**
 * Collect, score and store one snapshot. Only a snapshot built from the complete transfer
 * history is queued for sealing; a partial one is stored as "preliminary" and never sealed.
 */
export async function buildSnapshot(chain: ChainKey, addr: string, emit: (e: ScanEvent) => void, budgetMs?: number): Promise<StoredSnapshot> {
  const raw = await collect(chain, addr, emit, { budgetMs, store: historyStore() });
  emit({ type: "stage", stage: "score", status: "running" });
  const snapshot = analyze(raw);
  emit({ type: "stage", stage: "score", status: "done", detail: `${snapshot.score.value}` });
  const preliminary = !raw.transfersComplete;
  const seal: Seal = {
    status: preliminary ? "preliminary" : sealingConfigured() ? "pending" : "unconfigured",
    snapshotHash: snapshotHash(snapshot),
    merkleRoot: null,
    proof: [],
    batchCount: null,
    txHash: null,
    anchorBlock: null,
    contract: null,
    sealedAt: null,
  };
  const rec: StoredSnapshot = { id: `${chain}-${addr}-${snapshot.blockNumber}${preliminary ? `-p${Date.now().toString(36)}` : ""}`, snapshot, seal };
  await store().put(rec);
  emit({
    type: "stage",
    stage: "seal",
    status: seal.status === "pending" ? "done" : "skipped",
    detail: seal.status === "pending" ? "queued" : preliminary ? "after full read" : "not configured",
  });
  return rec;
}

export function scanErrorEvent(e: unknown, chain: ChainKey, addr: string): Extract<ScanEvent, { type: "error" }> {
  if (e instanceof ScanError) return { type: "error", code: e.code, message: e.message };
  console.error("[scan] failed", chain, addr, e);
  return { type: "error", code: "failed", message: "The scan failed. A data provider may be down; try again shortly." };
}

const inflight = new Map<string, Promise<StoredSnapshot>>();

export async function runScan(
  chain: ChainKey,
  address: string,
  opts: { force?: boolean; client: string; signal?: AbortSignal },
  emit: (e: ScanEvent) => void,
): Promise<void> {
  const addr = address.toLowerCase();
  if (chain === "robinhood" && isExampleAddress(addr)) {
    emit({ type: "done", data: exampleRecord(), cached: true });
    return;
  }

  const existing = await store().latest(chain, addr);
  const age = existing ? Date.now() - Date.parse(existing.snapshot.createdAt) : Infinity;
  const fresh = existing && existing.seal.status !== "preliminary" && age < (opts.force ? RESCAN_MIN_MS : CACHE_TTL_MS);
  if (existing && fresh) {
    emit({ type: "done", data: existing, cached: true });
    return;
  }
  const limit = () => allow(`scan:${opts.client}`, Number(process.env.SCAN_RATE_LIMIT ?? 10), 10 * 60_000);
  const limited: ScanEvent = { type: "error", code: "rate_limited", message: "Too many scans from this connection. Wait a few minutes." };

  // With a database: scans are background jobs that outlive the request. Following one is free;
  // only starting a new one counts against the rate limit.
  if (dbEnabled()) {
    const job = await enqueue(chain, addr, { force: !!opts.force, client: opts.client, canStart: limit });
    if (!job) return emit(limited);
    if (existing?.seal.status === "preliminary") emit({ type: "preliminary", data: existing });
    await followJob(job, emit, opts.signal);
    return;
  }

  // No database (local dev): run inline, history kept in memory.
  const key = `${chain}:${addr}`;
  let job = inflight.get(key);
  if (!job) {
    if (!limit()) return emit(limited);
    job = buildSnapshot(chain, addr, emit).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    emit({ type: "done", data: await job, cached: false });
  } catch (e) {
    emit(scanErrorEvent(e, chain, addr));
  }
}

export { EXAMPLE_ADDRESS };
