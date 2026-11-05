import type { ChainKey } from "../types";
import type { RawLabel } from "./raw";

/**
 * Seed labels. Graph quality depends on these: an unlabelled exchange wallet acts as a
 * connector and merges unrelated holders. Extend via LABELS_JSON (same shape) without a deploy.
 */
const SEED: Partial<Record<ChainKey | "*", Record<string, RawLabel>>> = {
  "*": {
    "0x0000000000000000000000000000000000000000": { type: "burn", label: "Burn (0x0)" },
    "0x000000000000000000000000000000000000dead": { type: "burn", label: "Burn (0xdead)" },
    "0xdead000000000000000042069420694206942069": { type: "burn", label: "Burn" },
  },
  ethereum: {
    "0x28c6c06298d514db089934071355e5743bf21d60": { type: "cex", label: "Binance hot wallet" },
    "0x21a31ee1afc51d94c2efccaa2092ad1028285549": { type: "cex", label: "Binance hot wallet" },
    "0xdfd5293d8e347dfe59e90efd55b2956a1343963d": { type: "cex", label: "Binance hot wallet" },
    "0xf977814e90da44bfa03b6295a0616a897441acec": { type: "cex", label: "Binance" },
    "0x5a52e96bacdabb82fd05763e25335261b270efcb": { type: "cex", label: "Binance" },
    "0x71660c4005ba85c37ccec55d0c4493e66fe775d3": { type: "cex", label: "Coinbase" },
    "0x503828976d22510aad0201ac7ec88293211d23da": { type: "cex", label: "Coinbase" },
    "0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43": { type: "cex", label: "Coinbase" },
    "0x2910543af39aba0cd09dbb2d50200b3e800a63d2": { type: "cex", label: "Kraken" },
    "0x6cc5f688a315f3dc28a7781717a9a798a59fda7b": { type: "cex", label: "OKX" },
    "0xf89d7b9c864f589bbf53a82105107622b35eaa40": { type: "cex", label: "Bybit" },
    "0x000000000004444c5dc75cb358380d2e3de08a90": { type: "dex", label: "Uniswap v4 PoolManager" },
  },
  base: {
    "0x498581ff718922c3f8e6a244956af099b2652b2b": { type: "dex", label: "Uniswap v4 PoolManager" },
  },
};

let extra: Partial<Record<ChainKey | "*", Record<string, RawLabel>>> | null = null;
function extraLabels() {
  if (extra) return extra;
  try {
    extra = process.env.LABELS_JSON ? JSON.parse(process.env.LABELS_JSON) : {};
  } catch {
    extra = {};
  }
  return extra!;
}

export function seedLabel(chain: ChainKey, address: string): RawLabel | null {
  const a = address.toLowerCase();
  const x = extraLabels();
  return x[chain]?.[a] ?? x["*"]?.[a] ?? SEED[chain]?.[a] ?? SEED["*"]?.[a] ?? null;
}

const CEX_RE = /\b(binance|coinbase|kraken|okx|okex|bybit|kucoin|gate\.io|gateio|mexc|bitget|htx|huobi|crypto\.com|bitfinex|bitstamp|upbit|bithumb|gemini)\b/i;
const DEX_RE = /\b(pool|pair|uniswap|aerodrome|sushi|pancake|curve|balancer|lp token|amm|poolmanager)\b/i;
const BRIDGE_RE = /\b(bridge|gateway|portal|wormhole|layerzero|stargate)\b/i;

/** Label from explorer names / public tags. */
export function labelFromNames(names: string[]): RawLabel | null {
  for (const n of names) {
    if (CEX_RE.test(n)) return { type: "cex", label: n };
    if (BRIDGE_RE.test(n)) return { type: "bridge", label: n };
    if (DEX_RE.test(n)) return { type: "dex", label: n };
  }
  return null;
}
