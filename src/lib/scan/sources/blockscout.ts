import { CHAINS } from "../../chains";
import type { ChainKey } from "../../types";
import type { RawTransfer } from "../raw";

/**
 * Blockscout PRO API: one key covers all three chains by chain id.
 * GET https://api.blockscout.com/{chainId}/api/v2/...?apikey=KEY
 */
const key = () => process.env.BLOCKSCOUT_API_KEY;
/** Chain ids the key's plan does not cover (HTTP 402/403), learned at runtime. */
const unsupported = new Set<number>();
export const blockscoutEnabled = (chain?: ChainKey) => !!key() && (!chain || !unsupported.has(CHAINS[chain].id));

export class BlockscoutPlanError extends Error {}

async function get<T>(chain: ChainKey, path: string, params: Record<string, string> = {}): Promise<T | null> {
  const base = process.env.BLOCKSCOUT_BASE ?? "https://api.blockscout.com";
  const u = new URL(`${base}/${CHAINS[chain].id}/api/v2${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("apikey", key()!);
  const res = await fetch(u, { signal: AbortSignal.timeout(15_000), cache: "no-store", headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (res.status === 402 || res.status === 403) {
    unsupported.add(CHAINS[chain].id);
    throw new BlockscoutPlanError(`Blockscout plan does not cover ${CHAINS[chain].name}`);
  }
  if (!res.ok) throw new Error(`Blockscout ${path} HTTP ${res.status}`);
  return (await res.json()) as T;
}

interface BsAddress {
  hash: string;
  is_contract?: boolean;
  name?: string | null;
  public_tags?: { display_name?: string; label?: string }[];
  metadata?: { tags?: { name?: string; tagType?: string }[] } | null;
}

export interface BsHolder {
  address: string;
  balance: bigint;
  isContract: boolean;
  names: string[]; // contract name + public tags, for labelling
}

export async function tokenInfo(chain: ChainKey, token: string) {
  const t = await get<{ holders_count?: string; holders?: string; icon_url?: string | null }>(chain, `/tokens/${token}`);
  const a = await get<{ creator_address_hash?: string | null; creation_tx_hash?: string | null }>(chain, `/addresses/${token}`).catch(() => null);
  return {
    holderCount: t ? Number(t.holders_count ?? t.holders ?? NaN) || null : null,
    logo: t?.icon_url ?? null,
    deployer: a?.creator_address_hash?.toLowerCase() ?? null,
  };
}

const namesOf = (a: BsAddress) =>
  [a.name, ...(a.public_tags ?? []).map((t) => t.display_name ?? t.label), ...(a.metadata?.tags ?? []).map((t) => t.name)].filter(
    (x): x is string => !!x,
  );

/** Top holders, 50 per page via next_page_params. */
export async function holders(chain: ChainKey, token: string, limit: number): Promise<BsHolder[]> {
  const out: BsHolder[] = [];
  let params: Record<string, string> = {};
  while (out.length < limit) {
    const page = await get<{ items: { address: BsAddress; value: string }[]; next_page_params: Record<string, string | number> | null }>(
      chain,
      `/tokens/${token}/holders`,
      params,
    );
    if (!page) break;
    for (const it of page.items)
      out.push({ address: it.address.hash.toLowerCase(), balance: BigInt(it.value), isContract: !!it.address.is_contract, names: namesOf(it.address) });
    if (!page.next_page_params) break;
    params = Object.fromEntries(Object.entries(page.next_page_params).map(([k, v]) => [k, String(v)]));
  }
  return out.slice(0, limit);
}

/** Most recent token transfers. Only a partial window: used when no full replay is possible. */
export async function recentTransfers(chain: ChainKey, token: string, pages: number): Promise<RawTransfer[]> {
  const out: RawTransfer[] = [];
  let params: Record<string, string> = {};
  for (let i = 0; i < pages; i++) {
    const page = await get<{
      items: { from: { hash: string }; to: { hash: string }; total?: { value?: string }; block_number: number; transaction_hash: string }[];
      next_page_params: Record<string, string | number> | null;
    }>(chain, `/tokens/${token}/transfers`, params).catch(() => null);
    if (!page) break;
    for (const it of page.items)
      out.push({ from: it.from.hash.toLowerCase(), to: it.to.hash.toLowerCase(), value: BigInt(it.total?.value ?? "0"), block: it.block_number, tx: it.transaction_hash });
    if (!page.next_page_params) break;
    params = Object.fromEntries(Object.entries(page.next_page_params).map(([k, v]) => [k, String(v)]));
  }
  return out;
}
