import { cacheLife } from "next/cache";
import { exampleSnapshot } from "./scan/example";
import { store } from "./store";
import type { ChainKey, Snapshot } from "./types";

/**
 * The real token shown as the sample on the landing page and behind "01 Map".
 * $ROBINHOOD on Robinhood Chain: fully read history, sealed on-chain.
 */
export const FEATURED: { chain: ChainKey; address: string } = {
  chain: "robinhood",
  address: "0x008df4b3e857d06c4603aeb11f267ccd32ce2005",
};
export const FEATURED_HREF = `/${FEATURED.chain}/${FEATURED.address}`;

/** Latest stored snapshot of the featured token, refreshed hourly. Falls back to the built-in sample if the backend is unreachable. */
export async function featuredSnapshot(): Promise<{ snapshot: Snapshot; real: boolean }> {
  "use cache";
  cacheLife("hours");
  const rec = await store()
    .latest(FEATURED.chain, FEATURED.address)
    .catch(() => null);
  return rec ? { snapshot: rec.snapshot, real: true } : { snapshot: exampleSnapshot(), real: false };
}
