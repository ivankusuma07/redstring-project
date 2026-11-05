import "server-only";
import { db, dbEnabled } from "./db";
import { decodeChunk, encodeChunk, memoryHistory, type HistoryStore, type Range } from "./scan/history";
import type { RawTransfer } from "./scan/raw";
import type { ChainKey } from "./types";

type StoredFirst = { from: string; to: string; value: string; block: number; tx: string | null };
const toJson = (t: RawTransfer | null): StoredFirst | null => (t ? { ...t, value: t.value.toString() } : null);
const fromJson = (t: StoredFirst | null): RawTransfer | null => (t ? { ...t, value: BigInt(t.value) } : null);

/** Postgres-backed history (production). */
class PgHistoryStore implements HistoryStore {
  async meta(chain: ChainKey, token: string) {
    const sql = await db();
    const [h] = await sql`select first_block, first_transfer from token_history where chain = ${chain} and address = ${token}`;
    const ranges = await sql`select from_block, to_block from transfer_chunks where chain = ${chain} and address = ${token} order by from_block`;
    if (!h && !ranges.length) return null;
    return {
      firstBlock: h?.first_block != null ? Number(h.first_block) : null,
      first: fromJson((h?.first_transfer as StoredFirst | null) ?? null),
      ranges: ranges.map((r): Range => ({ from: Number(r.from_block), to: Number(r.to_block) })),
    };
  }
  async setFirst(chain: ChainKey, token: string, firstBlock: number, first: RawTransfer | null) {
    const sql = await db();
    const f = toJson(first);
    await sql`insert into token_history (chain, address, first_block, first_transfer)
      values (${chain}, ${token}, ${firstBlock}, ${f ? sql.json(f) : null})
      on conflict (chain, address) do update set first_block = excluded.first_block, first_transfer = excluded.first_transfer, updated_at = now()`;
  }
  async addChunk(chain: ChainKey, token: string, range: Range, transfers: RawTransfer[]) {
    const sql = await db();
    await sql`insert into transfer_chunks (chain, address, from_block, to_block, n, data)
      values (${chain}, ${token}, ${range.from}, ${range.to}, ${transfers.length}, ${encodeChunk(transfers)})
      on conflict do nothing`;
    await sql`update token_history set updated_at = now() where chain = ${chain} and address = ${token}`;
  }
  async load(chain: ChainKey, token: string) {
    const sql = await db();
    const rows = await sql`select data from transfer_chunks where chain = ${chain} and address = ${token} order by from_block`;
    return rows.flatMap((r) => decodeChunk(r.data as Buffer));
  }
  async funders(chain: ChainKey, wallets: string[]) {
    if (!wallets.length) return {};
    const sql = await db();
    const rows = await sql`select wallet, funder from wallet_funders where chain = ${chain} and wallet = any(${wallets})`;
    return Object.fromEntries(rows.map((r) => [r.wallet as string, r.funder as string]));
  }
  async saveFunders(chain: ChainKey, funders: Record<string, string>) {
    const rows = Object.entries(funders).map(([wallet, funder]) => ({ chain, wallet, funder }));
    if (!rows.length) return;
    const sql = await db();
    await sql`insert into wallet_funders ${sql(rows)} on conflict do nothing`;
  }
}

const g = globalThis as unknown as { __rsPgHistory?: PgHistoryStore };
export function historyStore(): HistoryStore {
  if (!dbEnabled()) return memoryHistory();
  return (g.__rsPgHistory ??= new PgHistoryStore());
}
