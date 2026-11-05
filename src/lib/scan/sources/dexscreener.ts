import { CHAINS, chainByDexscreenerId } from "../../chains";
import type { ChainKey, MarketData } from "../../types";

interface DsPair {
  chainId: string;
  pairAddress: string;
  url: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
}

const BASE = "https://api.dexscreener.com";

export async function market(chain: ChainKey, token: string): Promise<MarketData | null> {
  try {
    const res = await fetch(`${BASE}/tokens/v1/${CHAINS[chain].dexscreener}/${token}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return null;
    const pairs = ((await res.json()) as DsPair[]).filter((p) => p.baseToken.address.toLowerCase() === token.toLowerCase());
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = pairs[0];
    return {
      priceUsd: best.priceUsd ? Number(best.priceUsd) : null,
      change24h: best.priceChange?.h24 ?? null,
      marketCap: best.marketCap ?? best.fdv ?? null,
      liquidityUsd: pairs.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0),
      volume24h: pairs.reduce((s, p) => s + (p.volume?.h24 ?? 0), 0),
      pairUrl: best.url,
      logo: best.info?.imageUrl ?? null,
      pairAddresses: pairs.map((p) => p.pairAddress.toLowerCase()).filter((a) => a.length === 42),
    };
  } catch {
    return null;
  }
}

export interface SearchHit {
  chain: ChainKey;
  address: string;
  symbol: string;
  name: string;
  liquidityUsd: number;
  logo: string | null;
}

export async function search(q: string): Promise<SearchHit[]> {
  try {
    const res = await fetch(`${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!res.ok) return [];
    const { pairs = [] } = (await res.json()) as { pairs?: DsPair[] };
    const seen = new Map<string, SearchHit>();
    for (const p of pairs) {
      const c = chainByDexscreenerId(p.chainId);
      if (!c) continue;
      const key = `${c.key}:${p.baseToken.address.toLowerCase()}`;
      const liq = p.liquidity?.usd ?? 0;
      const prev = seen.get(key);
      if (prev) prev.liquidityUsd += liq;
      else seen.set(key, { chain: c.key, address: p.baseToken.address.toLowerCase(), symbol: p.baseToken.symbol, name: p.baseToken.name, liquidityUsd: liq, logo: p.info?.imageUrl ?? null });
    }
    return [...seen.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 8);
  } catch {
    return [];
  }
}
