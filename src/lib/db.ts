import "server-only";
import type { Sql } from "postgres";

/** One Postgres pool per process (DATABASE_URL), migrated on first use. */
const g = globalThis as unknown as { __rsSql?: Sql; __rsMigrated?: Promise<void> };

export const dbEnabled = () => !!process.env.DATABASE_URL;

export async function db(): Promise<Sql> {
  if (!g.__rsSql) {
    const { default: postgres } = await import("postgres");
    g.__rsSql = postgres(process.env.DATABASE_URL!, { max: 8, prepare: false, onnotice: () => {} });
  }
  if (!g.__rsMigrated) g.__rsMigrated = migrate(g.__rsSql);
  await g.__rsMigrated;
  return g.__rsSql;
}

async function migrate(sql: Sql) {
  await sql`create table if not exists snapshots (
    id text primary key,
    chain text not null,
    address text not null,
    symbol text not null,
    created_at timestamptz not null,
    block_number bigint not null,
    score int not null,
    risk_level text not null,
    top_cluster_pct real not null,
    holder_count int,
    snapshot_hash text not null,
    seal_status text not null,
    graph_json jsonb not null,
    seal_json jsonb not null
  )`;
  await sql`create index if not exists snapshots_token_idx on snapshots (chain, address, created_at desc)`;
  await sql`create index if not exists snapshots_seal_idx on snapshots (seal_status) where seal_status = 'pending'`;

  // Stored transfer history: gzip chunks, each covering a closed block range.
  await sql`create table if not exists token_history (
    chain text not null,
    address text not null,
    first_block bigint,
    first_transfer jsonb,
    updated_at timestamptz not null default now(),
    primary key (chain, address)
  )`;
  await sql`create table if not exists transfer_chunks (
    chain text not null,
    address text not null,
    from_block bigint not null,
    to_block bigint not null,
    n int not null,
    data bytea not null,
    primary key (chain, address, from_block)
  )`;
  // A wallet's first gas funder never changes once it exists.
  await sql`create table if not exists wallet_funders (
    chain text not null,
    wallet text not null,
    funder text not null,
    primary key (chain, wallet)
  )`;

  await sql`create table if not exists scan_jobs (
    id bigserial primary key,
    chain text not null,
    address text not null,
    status text not null default 'queued',
    priority int not null default 0,
    force boolean not null default false,
    client text,
    stages jsonb not null default '{}'::jsonb,
    preliminary_id text,
    result_id text,
    error jsonb,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    finished_at timestamptz
  )`;
  await sql`create unique index if not exists scan_jobs_active_idx on scan_jobs (chain, address) where status in ('queued', 'running')`;
  await sql`create index if not exists scan_jobs_queue_idx on scan_jobs (priority desc, created_at) where status = 'queued'`;
}
