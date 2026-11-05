import "server-only";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import type { ChainKey, RiskLevel, Seal, StoredSnapshot } from "./types";

export interface ExploreRow {
  id: string;
  chain: ChainKey;
  address: string;
  symbol: string;
  name: string;
  score: number;
  level: RiskLevel;
  largest: number;
  linked: number;
  exempt: number;
  holders: number | null;
  scannedAt: string;
  sealed: boolean;
}

export interface Store {
  latest(chain: ChainKey, address: string): Promise<StoredSnapshot | null>;
  put(rec: StoredSnapshot): Promise<void>;
  recent(limit: number): Promise<ExploreRow[]>;
  pendingSeals(): Promise<StoredSnapshot[]>;
  updateSeal(id: string, seal: Seal): Promise<void>;
}

export const rowOf = (r: StoredSnapshot): ExploreRow => ({
  id: r.id,
  chain: r.snapshot.chain,
  address: r.snapshot.token.address,
  symbol: r.snapshot.token.symbol,
  name: r.snapshot.token.name,
  score: r.snapshot.score.value,
  level: r.snapshot.score.level,
  largest: r.snapshot.clusters[0]?.pct ?? 0,
  linked: r.snapshot.supply.linked,
  exempt: r.snapshot.supply.exempt,
  holders: r.snapshot.token.holderCount,
  scannedAt: r.snapshot.createdAt,
  sealed: r.seal.status === "sealed",
});

// ---- File store (local dev, single instance) ------------------------------
class FileStore implements Store {
  private dir = process.env.DATA_DIR ?? (process.env.VERCEL ? "/tmp/redstring" : path.join(process.cwd(), ".data"));
  private file = (chain: string, address: string) => path.join(this.dir, `${chain}-${address.toLowerCase()}.json`);
  private async ensure() {
    await mkdir(this.dir, { recursive: true });
  }
  private async all(): Promise<StoredSnapshot[]> {
    await this.ensure();
    const files = (await readdir(this.dir)).filter((f) => f.endsWith(".json"));
    const out: StoredSnapshot[] = [];
    for (const f of files) {
      try {
        out.push(JSON.parse(await readFile(path.join(this.dir, f), "utf8")));
      } catch {}
    }
    return out;
  }
  async latest(chain: ChainKey, address: string) {
    try {
      return JSON.parse(await readFile(this.file(chain, address), "utf8")) as StoredSnapshot;
    } catch {
      return null;
    }
  }
  async put(rec: StoredSnapshot) {
    await this.ensure();
    await writeFile(this.file(rec.snapshot.chain, rec.snapshot.token.address), JSON.stringify(rec));
  }
  async recent(limit: number) {
    return (await this.all())
      .map(rowOf)
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
      .slice(0, limit);
  }
  async pendingSeals() {
    return (await this.all()).filter((r) => r.seal.status === "pending").sort((a, b) => a.snapshot.createdAt.localeCompare(b.snapshot.createdAt));
  }
  async updateSeal(id: string, seal: Seal) {
    const rec = (await this.all()).find((r) => r.id === id);
    if (rec) await this.put({ ...rec, seal });
  }
}

// ---- Postgres store (production) -----------------------------------------
class PgStore implements Store {
  private db = db;
  async latest(chain: ChainKey, address: string) {
    const sql = await this.db();
    const rows = await sql`select graph_json, seal_json, id from snapshots where chain = ${chain} and address = ${address.toLowerCase()} order by created_at desc limit 1`;
    return rows[0] ? { id: rows[0].id, snapshot: rows[0].graph_json, seal: rows[0].seal_json } : null;
  }
  async put(r: StoredSnapshot) {
    const sql = await this.db();
    const s = r.snapshot;
    await sql`insert into snapshots ${sql({
      id: r.id,
      chain: s.chain,
      address: s.token.address,
      symbol: s.token.symbol,
      created_at: s.createdAt,
      block_number: s.blockNumber,
      score: s.score.value,
      risk_level: s.score.level,
      top_cluster_pct: s.clusters[0]?.pct ?? 0,
      holder_count: s.token.holderCount,
      snapshot_hash: r.seal.snapshotHash,
      seal_status: r.seal.status,
      graph_json: sql.json(s as never),
      seal_json: sql.json(r.seal as never),
    })} on conflict (id) do nothing`;
  }
  async recent(limit: number) {
    const sql = await this.db();
    const rows = await sql`select distinct on (chain, address) id, graph_json, seal_json from snapshots order by chain, address, created_at desc`;
    return rows
      .map((x) => rowOf({ id: x.id, snapshot: x.graph_json, seal: x.seal_json }))
      .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
      .slice(0, limit);
  }
  async pendingSeals() {
    const sql = await this.db();
    const rows = await sql`select id, graph_json, seal_json from snapshots where seal_status = 'pending' order by created_at limit 512`;
    return rows.map((x) => ({ id: x.id, snapshot: x.graph_json, seal: x.seal_json }));
  }
  async updateSeal(id: string, seal: Seal) {
    const sql = await this.db();
    await sql`update snapshots set seal_json = ${sql.json(seal as never)}, seal_status = ${seal.status} where id = ${id}`;
  }
}

// ---- HTTP store (frontend deployment: reads from the backend API) ----------
/**
 * When the frontend runs apart from the backend (Vercel + VPS), it has no database. It reads
 * snapshots through the backend's public read endpoints; only the backend scans and writes.
 */
class HttpStore implements Store {
  constructor(private base: string) {}
  private async get<T>(path: string): Promise<T | null> {
    const res = await fetch(`${this.base}${path}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`backend ${res.status} for ${path}`);
    return (await res.json()) as T;
  }
  latest(chain: ChainKey, address: string) {
    return this.get<StoredSnapshot>(`/api/tokens/${chain}/${address.toLowerCase()}`);
  }
  async recent(limit: number) {
    return (await this.get<{ rows: ExploreRow[] }>(`/api/explore?limit=${limit}`))?.rows ?? [];
  }
  put(): Promise<void> {
    throw new Error("read-only store: scans run on the backend (BACKEND_URL)");
  }
  pendingSeals(): Promise<StoredSnapshot[]> {
    throw new Error("read-only store: sealing runs on the backend (BACKEND_URL)");
  }
  updateSeal(): Promise<void> {
    throw new Error("read-only store: sealing runs on the backend (BACKEND_URL)");
  }
}

/** Set on the frontend deployment only: the backend origin, e.g. https://api.example.com */
export const backendUrl = () => process.env.BACKEND_URL?.replace(/\/+$/, "") || null;

const g = globalThis as unknown as { __rsStore?: Store };
export function store(): Store {
  if (!g.__rsStore) {
    const backend = backendUrl();
    g.__rsStore = backend ? new HttpStore(backend) : process.env.DATABASE_URL ? new PgStore() : new FileStore();
  }
  return g.__rsStore;
}
