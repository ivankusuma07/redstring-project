import type { ChainKey } from "./types";

export interface ChainConfig {
  key: ChainKey;
  id: number;
  name: string;
  short: string;
  rpc: string;
  explorer: string; // human explorer base URL
  hypersync: string;
  dexscreener: string;
  /** Max block span for one eth_getLogs call on the default RPC. */
  logRange: number;
}

const env = (k: string) => (typeof process !== "undefined" ? process.env[k] : undefined) || undefined;

export const CHAINS: Record<ChainKey, ChainConfig> = {
  robinhood: {
    key: "robinhood",
    id: 4663,
    name: "Robinhood Chain",
    short: "Robinhood",
    rpc: env("RPC_ROBINHOOD") ?? "https://rpc.mainnet.chain.robinhood.com",
    explorer: env("EXPLORER_ROBINHOOD") ?? "https://robin.etherscan.io",
    hypersync: "https://robinhood.hypersync.xyz",
    dexscreener: "robinhood",
    logRange: 10_000_000,
  },
  base: {
    key: "base",
    id: 8453,
    name: "Base",
    short: "Base",
    rpc: env("RPC_BASE") ?? "https://mainnet.base.org",
    explorer: env("EXPLORER_BASE") ?? "https://basescan.org",
    hypersync: "https://base.hypersync.xyz",
    dexscreener: "base",
    logRange: 10_000,
  },
  ethereum: {
    key: "ethereum",
    id: 1,
    name: "Ethereum",
    short: "Ethereum",
    rpc: env("RPC_ETHEREUM") ?? "https://ethereum-rpc.publicnode.com",
    explorer: env("EXPLORER_ETHEREUM") ?? "https://etherscan.io",
    hypersync: "https://eth.hypersync.xyz",
    dexscreener: "ethereum",
    logRange: 10_000,
  },
};

export const CHAIN_LIST: ChainConfig[] = [CHAINS.robinhood, CHAINS.base, CHAINS.ethereum];

export function isChainKey(v: string): v is ChainKey {
  return v === "robinhood" || v === "base" || v === "ethereum";
}

export function chainByDexscreenerId(id: string): ChainConfig | undefined {
  return CHAIN_LIST.find((c) => c.dexscreener === id);
}

export const addressUrl = (chain: ChainKey, a: string) => `${CHAINS[chain].explorer}/address/${a}`;
export const tokenUrl = (chain: ChainKey, a: string) => `${CHAINS[chain].explorer}/token/${a}`;
export const txUrl = (chain: ChainKey, h: string) => `${CHAINS[chain].explorer}/tx/${h}`;
