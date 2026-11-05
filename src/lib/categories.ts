/**
 * Explore categories. There is no on-chain source for "meme vs DeFi", so this is a curated
 * map keyed by `chain:address`. Extend with CATEGORIES_JSON ({"base:0x…": "DeFi"}).
 */
export const CATEGORIES = ["Meme", "DeFi", "Infra", "Gaming"] as const;
export type Category = (typeof CATEGORIES)[number];

const SEED: Record<string, Category> = {
  "robinhood:0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b9f0e": "Meme",
  "robinhood:0x008df4b3e857d06c4603aeb11f267ccd32ce2005": "Meme",
  "base:0x4ed4e862860bed51a9570b96d89af5e1b0efefed": "Meme",
};

export function categoryOf(chain: string, address: string): Category | null {
  let extra: Record<string, Category> = {};
  try {
    extra = process.env.CATEGORIES_JSON ? JSON.parse(process.env.CATEGORIES_JSON) : {};
  } catch {}
  const k = `${chain}:${address.toLowerCase()}`;
  return extra[k] ?? SEED[k] ?? null;
}
