import type { ChainKey, HolderType, MarketData, TokenMeta } from "../types";

/** One ERC-20 Transfer, decoded. */
export interface RawTransfer {
  from: string;
  to: string;
  value: bigint;
  block: number;
  tx: string | null;
}

export interface RawHolder {
  address: string;
  balance: bigint;
  isContract: boolean;
}

export interface RawLabel {
  type: HolderType;
  label: string | null;
}

/** Everything the network phase collects. `analyze()` turns it into a Snapshot without I/O. */
export interface RawScan {
  chain: ChainKey;
  token: TokenMeta;
  blockNumber: number;
  createdAt: string;
  holders: RawHolder[]; // sorted by balance desc, top N
  labels: Record<string, RawLabel>;
  transfers: RawTransfer[]; // may be partial, see transfersComplete
  transfersComplete: boolean;
  /** Share of the token's block range whose transfers were read (1 when complete). */
  historyCoverage?: number;
  funders: Record<string, string> | null; // holder -> first native funder
  blockTimes: Record<number, number>; // block -> unix seconds
  market: MarketData | null;
  sources: string[];
  limits: string[];
  example?: boolean;
}

export const ZERO = "0x0000000000000000000000000000000000000000";
