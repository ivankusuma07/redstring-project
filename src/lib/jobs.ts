import "server-only";
import { db } from "./db";
import { ScanError } from "./scan/collect";
import { maybeFlush } from "./seal/anchor";
import { buildSnapshot, scanErrorEvent } from "./service";
import type { ChainKey, ScanEvent, ScanStage, StoredSnapshot } from "./types";

/**
 * Background scan jobs (Postgres queue + in-process workers).
 *
 * A job runs in two phases. Phase 1 has the normal scan budget; if the transfer history is not
 * fully read by then, its result is stored as a *preliminary* snapshot (shown, never sealed) and
 * phase 2 keeps reading — resuming from the stored chunks — for up to JOB_BUDGET_MS, then stores
 * the final snapshot. Requests only follow jobs, so a dropped connection loses nothing.
 */

const JOB_BUDGET_MS = Number(process.env.JOB_BUDGET_MS) || 30 * 60_000;
const POLL_MS = 1_000;
const FOLLOW_MAX_MS = 45 * 60_000;

type StageState = { status: "running" | "done" | "skipped"; detail?: string; progress?: number };
interface JobRow {
  id: string;
  chain: ChainKey;
  address: string;
  status: "queued" | "running" | "done" | "failed";
  priority: number;
  created_at: Date;
  stages: Partial<Record<ScanStage, StageState>>;
  preliminary_id: string | null;
  result_id: string | null;
  error: Extract<ScanEvent, { type: "error" }> | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function record(id: string): Promise<StoredSnapshot | null> {
  const sql = await db();
  const [r] = await sql`select id, graph_json, seal_json from snapshots where id = ${id}`;
  return r ? { id: r.id, snapshot: r.graph_json, seal: r.seal_json } : null;
}

// ---- queue -------------------------------------------------------------------------

/**
 * Returns the active job for this token, creating one if there is none. `canStart` is only
 * consulted when a new job would be created (rate limiting); returns null when it refuses.
 */
export async function enqueue(
  chain: ChainKey,
  address: string,
  opts: { force?: boolean; client?: string; priority?: number; canStart?: () => boolean } = {},
): Promise<string | null> {
  const sql = await db();
  const priority = opts.priority ?? 0;
  const active = async () => {
    const [j] = await sql`select id from scan_jobs where chain = ${chain} and address = ${address} and status in ('queued', 'running')`;
    if (!j) return null;
    // a visitor waiting on a prewarm job lifts it to their priority
    await sql`update scan_jobs set priority = greatest(priority, ${priority}) where id = ${j.id} and status = 'queued'`;
    return String(j.id);
  };
  const found = await active();
  if (found) return found;
  if (opts.canStart && !opts.canStart()) return null;
  const [row] = await sql`insert into scan_jobs (chain, address, priority, force, client)
    values (${chain}, ${address}, ${priority}, ${!!opts.force}, ${opts.client ?? null})
    on conflict (chain, address) where status in ('queued', 'running') do nothing
    returning id`;
  wake();
  return row ? String(row.id) : active();
}

/** Stream a job's progress as ScanEvents until it finishes, fails or the client goes away. */
export async function followJob(id: string, emit: (e: ScanEvent) => void, signal?: AbortSignal): Promise<void> {
  const sql = await db();
  const sent: Record<string, string> = {};
  let prelim: string | null = null;
  let position = -1;
  const until = Date.now() + FOLLOW_MAX_MS;
  while (!signal?.aborted && Date.now() < until) {
    const [j] = (await sql`select * from scan_jobs where id = ${id}`) as unknown as JobRow[];
    if (!j) return emit({ type: "error", code: "failed", message: "The scan job disappeared. Try again." });

    if (j.status === "queued") {
      const [{ n }] = await sql`select count(*)::int as n from scan_jobs where status = 'running'
        or (status = 'queued' and (priority > ${j.priority} or (priority = ${j.priority} and created_at < ${j.created_at})))`;
      if (n !== position) emit({ type: "queued", position: (position = n) });
    }
    for (const [stage, st] of Object.entries(j.stages ?? {}) as [ScanStage, StageState][]) {
      const key = JSON.stringify(st);
      if (sent[stage] !== key) {
        sent[stage] = key;
        emit({ type: "stage", stage, ...st });
      }
    }
    if (j.preliminary_id && j.preliminary_id !== prelim && j.status === "running") {
      prelim = j.preliminary_id;
      const rec = await record(prelim);
      if (rec) emit({ type: "preliminary", data: rec });
    }
    if (j.status === "done") {
      const rec = j.result_id ? await record(j.result_id) : null;
      return emit(rec ? { type: "done", data: rec, cached: false } : { type: "error", code: "failed", message: "The scan finished without a result." });
    }
    if (j.status === "failed") return emit(j.error ?? { type: "error", code: "failed", message: "The scan failed." });
    await sleep(POLL_MS);
  }
}

// ---- workers -----------------------------------------------------------------------

const g = globalThis as unknown as { __rsWorkers?: boolean; __rsWake?: (() => void)[] };
const waiters = (g.__rsWake ??= []);
function wake() {
  for (const w of waiters.splice(0)) w();
}
const idle = (ms: number) => new Promise<void>((r) => {
  const t = setTimeout(done, ms);
  function done() {
    clearTimeout(t);
    const i = waiters.indexOf(done);
    if (i >= 0) waiters.splice(i, 1);
    r();
  }
  waiters.push(done);
});

async function claim(): Promise<JobRow | null> {
  const sql = await db();
  const [j] = (await sql`update scan_jobs set status = 'running', started_at = now()
    where id = (select id from scan_jobs where status = 'queued' order by priority desc, created_at limit 1 for update skip locked)
    returning *`) as unknown as JobRow[];
  return j ?? null;
}

async function runJob(job: JobRow) {
  const sql = await db();
  const stages: Partial<Record<ScanStage, StageState>> = {};
  let lastWrite = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = async () => {
    timer = null;
    lastWrite = Date.now();
    await sql`update scan_jobs set stages = ${sql.json(stages as never)} where id = ${job.id}`.catch(() => undefined);
  };
  const emit = (e: ScanEvent) => {
    if (e.type !== "stage") return;
    stages[e.stage] = { status: e.status, ...(e.detail != null ? { detail: e.detail } : { detail: stages[e.stage]?.detail }), ...(e.progress != null ? { progress: e.progress } : {}) };
    if (timer) return;
    timer = setTimeout(write, Math.max(0, 1_000 - (Date.now() - lastWrite)));
  };
  const settle = async () => {
    if (timer) clearTimeout(timer);
    await write();
  };

  try {
    // Phase 1 may end before anything usable was read (busy token, slow provider): go on to phase 2.
    let rec = await buildSnapshot(job.chain, job.address, emit).catch((e) => {
      if (e instanceof ScanError && e.code === "too_large") return null;
      throw e;
    });
    console.log(`[jobs] ${job.chain}:${job.address} phase 1 ${rec ? rec.seal.status : "read nothing"} (${Math.round((rec?.snapshot.history?.coverage ?? 0) * 100)}%)`);
    if (!rec) rec = await buildSnapshot(job.chain, job.address, emit, JOB_BUDGET_MS);
    else if (rec.seal.status === "preliminary") {
      await settle();
      await sql`update scan_jobs set preliminary_id = ${rec.id} where id = ${job.id}`;
      for (const k of Object.keys(stages) as ScanStage[]) if (k !== "holders") delete stages[k];
      rec = await buildSnapshot(job.chain, job.address, emit, JOB_BUDGET_MS);
    }
    await settle();
    await sql`update scan_jobs set status = 'done', result_id = ${rec.id}, finished_at = now() where id = ${job.id}`;
    maybeFlush().catch(() => undefined);
  } catch (e) {
    await settle();
    const err = scanErrorEvent(e, job.chain, job.address);
    await sql`update scan_jobs set status = 'failed', error = ${sql.json(err as never)}, finished_at = now() where id = ${job.id}`;
  }
}

async function loop(n: number) {
  for (;;) {
    let job: JobRow | null = null;
    try {
      job = await claim();
    } catch (e) {
      console.error(`[jobs] worker ${n}: claim failed`, (e as Error).message);
    }
    if (job) await runJob(job);
    else await idle(5_000);
  }
}

/** Start the in-process workers once per server. Jobs left running by a restart are re-queued. */
export function startWorkers() {
  if (g.__rsWorkers) return;
  g.__rsWorkers = true;
  const n = Math.max(1, Number(process.env.WORKERS) || 2);
  (async () => {
    const sql = await db();
    await sql`update scan_jobs set status = 'queued', started_at = null where status = 'running'`;
    // keep the job table small: finished jobs only matter while someone follows them
    await sql`delete from scan_jobs where finished_at < now() - interval '7 days'`;
    for (let i = 0; i < n; i++) void loop(i);
    console.log(`[jobs] ${n} workers started`);
  })().catch((e) => {
    g.__rsWorkers = false;
    console.error("[jobs] could not start workers", e);
  });
}
