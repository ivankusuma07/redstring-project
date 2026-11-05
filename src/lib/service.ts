import "server-only";
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

const inflight = new Map<string, Promise<StoredSnapshot>>();

export async function runScan(
  chain: ChainKey,
  address: string,
  opts: { force?: boolean; client: string },
  emit: (e: ScanEvent) => void,
): Promise<void> {
  const addr = address.toLowerCase();
  if (chain === "robinhood" && isExampleAddress(addr)) {
    emit({ type: "done", data: exampleRecord(), cached: true });
    return;
  }

  const existing = await store().latest(chain, addr);
  const age = existing ? Date.now() - Date.parse(existing.snapshot.createdAt) : Infinity;
  if (existing && (age < (opts.force ? RESCAN_MIN_MS : CACHE_TTL_MS))) {
    emit({ type: "done", data: existing, cached: true });
    return;
  }

  const key = `${chain}:${addr}`;
  let job = inflight.get(key);
  if (!job) {
    if (!allow(`scan:${opts.client}`, Number(process.env.SCAN_RATE_LIMIT ?? 10), 10 * 60_000)) {
      emit({ type: "error", code: "rate_limited", message: "Too many scans from this connection. Wait a few minutes." });
      return;
    }
    job = (async () => {
      const raw = await collect(chain, addr, emit);
      emit({ type: "stage", stage: "score", status: "running" });
      const snapshot = analyze(raw);
      emit({ type: "stage", stage: "score", status: "done", detail: `${snapshot.score.value}` });
      const hash = snapshotHash(snapshot);
      const seal: Seal = {
        status: sealingConfigured() ? "pending" : "unconfigured",
        snapshotHash: hash,
        merkleRoot: null,
        proof: [],
        batchCount: null,
        txHash: null,
        anchorBlock: null,
        contract: null,
        sealedAt: null,
      };
      const rec: StoredSnapshot = { id: `${chain}-${addr}-${snapshot.blockNumber}`, snapshot, seal };
      await store().put(rec);
      emit({ type: "stage", stage: "seal", status: sealingConfigured() ? "done" : "skipped", detail: sealingConfigured() ? "queued" : "not configured" });
      return rec;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  try {
    emit({ type: "done", data: await job, cached: false });
  } catch (e) {
    if (e instanceof ScanError) emit({ type: "error", code: e.code, message: e.message });
    else {
      console.error("[scan] failed", chain, addr, e);
      emit({ type: "error", code: "failed", message: "The scan failed. A data provider may be down; try again shortly." });
    }
  }
}

export { EXAMPLE_ADDRESS };
