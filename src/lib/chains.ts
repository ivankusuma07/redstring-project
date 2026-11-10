import type { ChainKey } from "./types";

export interface ChainConfig {
  key: ChainKey;
  id: number;
  name: string;
  short: string;
  rpc: string;
  /** Endpoint for eth_getLogs history replay. Defaults to the public RPC, because free tiers of
   *  keyed providers (Alchemy) cap getLogs to ~10 blocks. */
  logsRpc: string;
  /** Public endpoints tried in order when the main RPC refuses or fails (quota, outage).
   *  Override with RPC_FALLBACK_<CHAIN>, comma-separated. */
  rpcFallbacks: string[];
  explorer: string; // human explorer base URL
  hypersync: string;
  dexscreener: string;
  /** Max block span for one eth_getLogs call on the default RPC. */
  logRange: number;
  /** Covered by the Blockscout PRO API (BNB Chain is not). */
  blockscout: boolean;
}

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined) || undefined;
const list = (k: string, fallback: string[]) =>
  env(k)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? fallback;

export const CHAINS: Record<ChainKey, ChainConfig> = {
  robinhood: {
    key: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    short: "Robinhood",
    rpc: env("RPC_ROBINHOOD") ?? "https://rpc.mainnet.chain.robinhood.com",
    logsRpc: env("RPC_LOGS_ROBINHOOD") ?? env("RPC_ROBINHOOD") ?? "https://rpc.mainnet.chain.robinhood.com",
    rpcFallbacks: list("RPC_FALLBACK_ROBINHOOD", []),
    explorer: env("EXPLORER_ROBINHOOD") ?? "https://robin.etherscan.io",
    hypersync: "https://robinhood.hypersync.xyz",
    dexscreener: "robinhood",
    logRange: 10_000_000,
    blockscout: true,
  },
  base: {
    key: "base",
    id: 8453,
    name: "Base",
    short: "Base",
    rpc: env("RPC_BASE") ?? "https://mainnet.base.org",
    logsRpc: env("RPC_LOGS_BASE") ?? "https://mainnet.base.org",
    rpcFallbacks: list("RPC_FALLBACK_BASE", ["https://mainnet.base.org", "https://base-rpc.publicnode.com"]),
    explorer: env("EXPLORER_BASE") ?? "https://basescan.org",
    hypersync: "https://base.hypersync.xyz",
    dexscreener: "base",
    logRange: 10_000,
    blockscout: true,
  },
  ethereum: {
    key: "ethereum",
    id: 1,
    name: "Ethereum",
    short: "Ethereum",
    rpc: env("RPC_ETHEREUM") ?? "https://ethereum-rpc.publicnode.com",
    logsRpc: env("RPC_LOGS_ETHEREUM") ?? "https://ethereum-rpc.publicnode.com",
    rpcFallbacks: list("RPC_FALLBACK_ETHEREUM", ["https://ethereum-rpc.publicnode.com", "https://eth.drpc.org"]),
    explorer: env("EXPLORER_ETHEREUM") ?? "https://etherscan.io",
    hypersync: "https://eth.hypersync.xyz",
    dexscreener: "ethereum",
    logRange: 10_000,
    blockscout: true,
  },
  bnb: {
    key: "bnb",
    id: 56,
    name: "BNB Chain",
    short: "BNB",
    rpc: env("RPC_BNB") ?? "https://bsc-rpc.publicnode.com",
    logsRpc: env("RPC_LOGS_BNB") ?? "https://bsc-rpc.publicnode.com",
    rpcFallbacks: list("RPC_FALLBACK_BNB", ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.bnbchain.org"]),
    explorer: env("EXPLORER_BNB") ?? "https://bscscan.com",
    hypersync: "https://bsc.hypersync.xyz",
    dexscreener: "bsc",
    logRange: 5_000,
    blockscout: false,
  },
  arbitrum: {
    key: "arbitrum",
    id: 42161,
    name: "Arbitrum",
    short: "Arbitrum",
    rpc: env("RPC_ARBITRUM") ?? "https://arb1.arbitrum.io/rpc",
    logsRpc: env("RPC_LOGS_ARBITRUM") ?? "https://arb1.arbitrum.io/rpc",
    rpcFallbacks: list("RPC_FALLBACK_ARBITRUM", ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one-rpc.publicnode.com"]),
    explorer: env("EXPLORER_ARBITRUM") ?? "https://arbiscan.io",
    hypersync: "https://arbitrum.hypersync.xyz",
    dexscreener: "arbitrum",
    logRange: 10_000,
    blockscout: true,
  },
};

export const CHAIN_LIST: ChainConfig[] = [CHAINS.robinhood, CHAINS.base, CHAINS.ethereum, CHAINS.bnb, CHAINS.arbitrum];

/** "Robinhood Chain, Base, Ethereum, BNB Chain and Arbitrum" (or "or"). */
export const chainNames = (join: "and" | "or" = "and") => {
  const n = CHAIN_LIST.map((c) => c.name);
  return `${n.slice(0, -1).join(", ")} ${join} ${n[n.length - 1]}`;
};

export function isChainKey(v: string): v is ChainKey {
  return Object.hasOwn(CHAINS, v);
}

export function chainByDexscreenerId(id: string): ChainConfig | undefined {
  return CHAIN_LIST.find((c) => c.dexscreener === id);
}

export const addressUrl = (chain: ChainKey, a: string) => `${CHAINS[chain].explorer}/address/${a}`;
export const tokenUrl = (chain: ChainKey, a: string) => `${CHAINS[chain].explorer}/token/${a}`;
export const txUrl = (chain: ChainKey, h: string) => `${CHAINS[chain].explorer}/tx/${h}`;
