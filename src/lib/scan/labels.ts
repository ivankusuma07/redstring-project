import { CHAINS } from "../chains";
import type { ChainKey } from "../types";
import DATA from "./labels.data.json";
import type { RawHolder, RawLabel, RawTransfer } from "./raw";

/**
 * Labels decide graph quality: an unlabelled exchange wallet acts as a connector and merges
 * unrelated holders. Lookup order:
 *   1. LABELS_JSON env (same shape as SEED) — fixes without a deploy
 *   2. SEED below — hand-checked infrastructure
 *   3. labels.data.json `chains` — Etherscan-family name tags for this chain (scripts/build-labels.ts)
 *   4. labels.data.json `exchangeEoa` — exchange wallets tagged on any EVM chain. An EOA is the
 *      same private key on every chain, so these apply wherever the address has no code.
 * Anything still unlabelled goes through inferHubs().
 */
const SEED: Partial<Record<ChainKey | "*", Record<string, RawLabel>>> = {
  "*": {
    "0x0000000000000000000000000000000000000000": { type: "burn", label: "Burn (0x0)" },
    "0x000000000000000000000000000000000000dead": { type: "burn", label: "Burn (0xdead)" },
    "0xdead000000000000000042069420694206942069": { type: "burn", label: "Burn" },
  },
  ethereum: {
    "0x000000000004444c5dc75cb358380d2e3de08a90": { type: "dex", label: "Uniswap v4 PoolManager" },
    "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": { type: "dex", label: "Uniswap v4 Universal Router" },
    "0x000000000022d473030f116ddee9f6b43ac78ba3": { type: "dex", label: "Permit2" },
  },
  base: {
    "0x498581ff718922c3f8e6a244956af099b2652b2b": { type: "dex", label: "Uniswap v4 PoolManager" },
    "0x6ff5693b99212da76ad316178a184ab56d299b43": { type: "dex", label: "Uniswap v4 Universal Router" },
    "0x000000000022d473030f116ddee9f6b43ac78ba3": { type: "dex", label: "Permit2" },
    // OP Stack predeploys
    "0x4200000000000000000000000000000000000010": { type: "bridge", label: "Base L2 Standard Bridge" },
    "0x4200000000000000000000000000000000000007": { type: "bridge", label: "Base L2 Cross-Domain Messenger" },
    "0x4200000000000000000000000000000000000014": { type: "bridge", label: "Base L2 ERC-721 Bridge" },
  },
  robinhood: {
    // Arbitrum Orbit precompiles
    "0x0000000000000000000000000000000000000064": { type: "bridge", label: "ArbSys (L2→L1 bridge)" },
  },
};

type DataFile = { chains: Record<string, Record<string, [RawLabel["type"], string]>>; exchangeEoa: Record<string, string> };
const data = DATA as unknown as DataFile;

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

/** Known label for an address, or null. `isContract` gates the cross-chain exchange list. */
export function seedLabel(chain: ChainKey, address: string, isContract = false): RawLabel | null {
  const a = address.toLowerCase();
  const x = extraLabels();
  const hit = x[chain]?.[a] ?? x["*"]?.[a] ?? SEED[chain]?.[a] ?? SEED["*"]?.[a];
  if (hit) return hit;
  const row = data.chains[String(CHAINS[chain].id)]?.[a];
  if (row) return { type: row[0], label: row[1] };
  const ex = isContract ? undefined : data.exchangeEoa[a];
  if (ex) return { type: "cex", label: ex };
  return null;
}

const CEX_RE = /\b(binance|coinbase|kraken|okx|okex|bybit|kucoin|gate\.io|gateio|mexc|bitget|htx|huobi|crypto\.com|bitfinex|bitstamp|upbit|bithumb|gemini|robinhood)\b/i;
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

// ---- inference for addresses no list knows ------------------------------------

/** Distinct transfer counterparties that make an address a hub candidate. */
export const HUB_PEERS = 25;
/** Holders sharing one gas funder that make the funder a hub candidate. */
export const FUNDER_HUB_WALLETS = 3;
/**
 * Minimum nonce for an unlabelled hub to count as an exchange. Hot wallets on mature chains send
 * hundreds of thousands to millions of transactions; a deployer seeding a wallet farm sends tens
 * to hundreds. Robinhood Chain is young, so its exchange wallets have far fewer (Nov 2026: the one
 * tagged Robinhood wallet active there had 516), hence the lower bar. HOT_WALLET_NONCE overrides.
 */
const HOT_WALLET_NONCE: Record<ChainKey, number> = { ethereum: 50_000, base: 50_000, robinhood: 10_000 };
export function hotWalletNonce(chain: ChainKey): number {
  const env = Number(process.env.HOT_WALLET_NONCE);
  return env > 0 ? env : HOT_WALLET_NONCE[chain];
}

export const INFERRED_POOL = "Pool / router (inferred)";
export const INFERRED_EXCHANGE = "High-activity wallet (likely exchange, inferred)";

/** Addresses whose transfer peer count makes them hub candidates (unlabelled only). */
export function transferPeers(transfers: RawTransfer[], candidates: Set<string>): Map<string, number> {
  const peers = new Map<string, Set<string>>();
  for (const t of transfers)
    for (const [x, y] of [
      [t.from, t.to],
      [t.to, t.from],
    ]) {
      if (!candidates.has(x) || x === y) continue;
      if (!peers.has(x)) peers.set(x, new Set());
      peers.get(x)!.add(y);
    }
  return new Map([...peers].map(([a, s]) => [a, s.size]));
}

/** EOAs worth a nonce lookup: busy transfer hubs and gas funders shared by several holders. */
export function hubCandidates(input: { holders: RawHolder[]; transfers: RawTransfer[]; labels: Record<string, RawLabel>; funders: Record<string, string> | null }) {
  const { holders, transfers, labels, funders } = input;
  const eoas = new Set(holders.filter((h) => !h.isContract && !labels[h.address]).map((h) => h.address));
  const busy = [...transferPeers(transfers, eoas)].filter(([, n]) => n >= HUB_PEERS).map(([a]) => a);
  const fan = new Map<string, number>();
  for (const f of Object.values(funders ?? {})) if (!labels[f]) fan.set(f, (fan.get(f) ?? 0) + 1);
  const sharedFunders = [...fan].filter(([, n]) => n >= FUNDER_HUB_WALLETS).map(([a]) => a);
  return [...new Set([...busy, ...sharedFunders])];
}

/**
 * Pure: labels hubs nothing else identified.
 *   - contracts with ≥ HUB_PEERS transfer peers → pool / router (v4-style pool managers hold
 *     liquidity for pools DexScreener lists by id, not address)
 *   - EOAs that are hub candidates and have nonce ≥ minNonce (hotWalletNonce) → likely exchange
 * Both become exempt, so they never link wallets.
 */
export function inferHubs(input: {
  holders: RawHolder[];
  transfers: RawTransfer[];
  labels: Record<string, RawLabel>;
  candidates: string[];
  nonces: Record<string, number>;
  minNonce: number;
}): Record<string, RawLabel> {
  const { holders, transfers, labels, candidates, nonces, minNonce } = input;
  const out: Record<string, RawLabel> = {};
  const contracts = new Set(holders.filter((h) => h.isContract && !labels[h.address]).map((h) => h.address));
  for (const [a, n] of transferPeers(transfers, contracts)) if (n >= HUB_PEERS) out[a] = { type: "dex", label: INFERRED_POOL };
  for (const a of candidates) if (!labels[a] && !out[a] && (nonces[a] ?? 0) >= minNonce) out[a] = { type: "cex", label: INFERRED_EXCHANGE };
  return out;
}
