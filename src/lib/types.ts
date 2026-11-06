export type ChainKey = "robinhood" | "base" | "ethereum" | "bnb" | "arbitrum";

/** What a holder address is. Exempt types never act as connectors. */
export type HolderType =
  | "cex"
  | "dex"
  | "burn"
  | "bridge"
  | "contract"
  | "deployer"
  | "wallet";

export const EXEMPT_TYPES: HolderType[] = ["cex", "dex", "burn", "bridge"];

/** Why two wallets are linked. Kept on every link so the UI can explain it. */
export type LinkKind = "transfer" | "funder" | "same-block";

export interface HolderNode {
  id: string; // lowercase address
  rank: number;
  balance: string; // raw integer string (token units)
  amount: number; // human units (balance / 10^decimals)
  pct: number; // % of total supply, 0..100
  type: HolderType;
  label: string | null;
  exempt: boolean;
  isContract: boolean;
  cluster: number | null; // cluster id, null = free float / exempt
  firstHeld: { block: number; timestamp: number | null } | null;
  launchBuyer: boolean; // bought from a pool in the launch block
  fromDeployer: boolean; // received tokens directly from the deployer
  funder: string | null; // first native-gas funder, when known
}

export interface HolderLink {
  source: string;
  target: string;
  kind: LinkKind;
  count: number; // e.g. number of transfers
  amount?: number; // tokens moved (transfer links)
  via?: string; // shared funder address, or launch block number
}

export interface Cluster {
  id: number; // 1 = largest by % of supply
  size: number;
  pct: number;
  members: string[];
  kinds: LinkKind[];
  deployerLinked: boolean;
  launchBuyers: number;
  sharedFunder: string | null; // set when most members share one funder
  title: string;
  body: string;
}

export interface SupplySegment {
  key: string;
  kind: "group" | "groups-other" | "dex" | "cex" | "burn" | "bridge" | "free";
  label: string;
  pct: number;
}

export interface ScoreFactor {
  key: string;
  label: string;
  detail: string;
  value: string;
  rule: string;
  points: number; // negative or zero
}

export type RiskLevel = "LOW" | "MODERATE" | "HIGH";

export interface MarketData {
  priceUsd: number | null;
  change24h: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  pairUrl: string | null;
  logo: string | null;
  pairAddresses: string[];
}

export interface TokenMeta {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string; // raw integer string
  holderCount: number | null;
  deployer: string | null;
  deployBlock: number | null;
  logo: string | null;
}

export interface Snapshot {
  version: 1;
  chain: ChainKey;
  token: TokenMeta;
  blockNumber: number;
  createdAt: string; // ISO
  launchBlock: number | null;
  market: MarketData | null;
  nodes: HolderNode[];
  links: HolderLink[];
  clusters: Cluster[];
  supply: {
    linked: number;
    exempt: number;
    free: number;
    top250: number; // % of supply covered by the scanned holders
    segments: SupplySegment[];
  };
  score: {
    value: number;
    level: RiskLevel;
    factors: ScoreFactor[];
    totalPenalty: number;
    summary: string;
  };
  sources: string[]; // which providers produced this data
  limits: string[]; // honest notes about what was not checked
  /** How much of the token's transfer history this snapshot used. Absent on older snapshots. */
  history?: { complete: boolean; coverage: number };
  example?: boolean; // illustrative example data, not a real token
}

/** "preliminary": built from part of the history; never sealed, replaced when the full read finishes. */
export type SealStatus = "pending" | "sealed" | "unconfigured" | "example" | "failed" | "preliminary";

export interface Seal {
  status: SealStatus;
  snapshotHash: string;
  merkleRoot: string | null;
  proof: string[];
  batchCount: number | null;
  txHash: string | null;
  anchorBlock: number | null;
  contract: string | null;
  sealedAt: string | null;
  error?: string;
}

export interface StoredSnapshot {
  id: string;
  snapshot: Snapshot;
  seal: Seal;
}

export type ScanStage = "holders" | "labels" | "links" | "score" | "seal";

export type ScanEvent =
  | { type: "stage"; stage: ScanStage; status: "running" | "done" | "skipped"; detail?: string; progress?: number }
  | { type: "queued"; position: number }
  | { type: "preliminary"; data: StoredSnapshot }
  | { type: "done"; data: StoredSnapshot; cached: boolean }
  | { type: "error"; code: "not_found" | "not_configured" | "too_large" | "rate_limited" | "invalid" | "failed"; message: string };
