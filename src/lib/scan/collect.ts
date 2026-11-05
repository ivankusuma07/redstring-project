import type { ChainKey, ScanEvent } from "../types";
import { labelFromNames, seedLabel } from "./labels";
import { ZERO, type RawHolder, type RawLabel, type RawScan, type RawTransfer } from "./raw";
import * as bs from "./sources/blockscout";
import { market as dsMarket } from "./sources/dexscreener";
import * as hs from "./sources/hypersync";
import * as rpc from "./sources/rpc";

export const HOLDER_LIMIT = 250;
const MAX_REPLAY_LOGS = 400_000;
const HUB_PEERS = 25;

export class ScanError extends Error {
  constructor(
    public code: Extract<ScanEvent, { type: "error" }>["code"],
    message: string,
  ) {
    super(message);
  }
}

type Emit = (e: ScanEvent) => void;

export async function collect(chain: ChainKey, address: string, emit: Emit, budgetMs = 170_000): Promise<RawScan> {
  const token = address.toLowerCase();
  const deadline = Date.now() + budgetMs;
  const sources: string[] = [];
  const limits: string[] = [];

  emit({ type: "stage", stage: "holders", status: "running" });
  const latest = await rpc.blockNumber(chain).catch(() => {
    throw new ScanError("failed", "The chain RPC did not answer. Try again in a minute.");
  });
  const meta = await rpc.tokenMeta(chain, token, latest);
  if (!meta) throw new ScanError("not_found", "No ERC-20 token at this address.");
  sources.push("RPC");
  const marketP = dsMarket(chain, token);

  // ---- holders + transfers ---------------------------------------------
  let holders: RawHolder[] = [];
  let names: Record<string, string[]> = {};
  let holderCount: number | null = null;
  let deployer: string | null = null;
  let logo: string | null = null;
  let deployBlock: number | null = null;

  if (bs.blockscoutEnabled()) {
    const [list, info] = await Promise.all([bs.holders(chain, token, HOLDER_LIMIT), bs.tokenInfo(chain, token)]);
    holders = list.map((h) => ({ address: h.address, balance: h.balance, isContract: h.isContract }));
    names = Object.fromEntries(list.map((h) => [h.address, h.names]));
    holderCount = info.holderCount;
    deployer = info.deployer;
    logo = info.logo;
    sources.push("Blockscout");
    emit({ type: "stage", stage: "holders", status: "running", detail: `${holders.length}`, progress: 0.3 });
  }

  let transfers: RawTransfer[] = [];
  let complete = false;
  let blockTimes: Record<number, number> = {};
  const onProgress = (p: number) => emit({ type: "stage", stage: "holders", status: "running", progress: Math.min(0.95, 0.3 + p * 0.65) });

  if (hs.hypersyncEnabled()) {
    try {
      const r = await hs.transfers(chain, token, latest, { maxLogs: MAX_REPLAY_LOGS * 5, deadline, onProgress });
      transfers = r.transfers;
      blockTimes = r.blockTimes;
      complete = r.complete;
      sources.push("HyperSync");
    } catch (e) {
      limits.push(`HyperSync failed: ${(e as Error).message}`);
    }
  }
  if (!complete) {
    try {
      deployBlock = await rpc.findDeployBlock(chain, token, latest);
      transfers = await rpc.replayTransfers(chain, token, deployBlock, latest, { maxLogs: MAX_REPLAY_LOGS, deadline, onProgress });
      complete = true;
      if (!sources.includes("RPC log replay")) sources.push("RPC log replay");
    } catch (e) {
      if (!(e instanceof rpc.TooLargeError)) limits.push(`Log replay failed: ${(e as Error).message}`);
      transfers = [];
    }
  }

  if (!holders.length) {
    if (!complete)
      throw new ScanError(
        "too_large",
        "This token has too much history to replay over a public RPC. Set BLOCKSCOUT_API_KEY or HYPERSYNC_TOKEN to scan it.",
      );
    const bal = rpc.balancesFrom(transfers);
    const positive = [...bal].filter(([a, b]) => b > 0n && a !== ZERO);
    holderCount = positive.length;
    positive.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    const top = positive.slice(0, HOLDER_LIMIT);
    const codes = await rpc.getCodes(chain, top.map(([a]) => a));
    holders = top.map(([a, b]) => ({ address: a, balance: b, isContract: codes[a] ?? false }));
  }
  if (!complete && bs.blockscoutEnabled()) {
    transfers = await bs.recentTransfers(chain, token, 20);
    limits.push(`Full transfer history unavailable; links use the latest ${transfers.length.toLocaleString("en-US")} transfers only. Launch-block buyers not checked.`);
  }
  if (!holders.length) throw new ScanError("not_found", "This token has no holders yet.");

  // deployer: the sender of the first mint
  if (!deployer && complete) {
    const firstMint = [...transfers].sort((a, b) => a.block - b.block).find((t) => t.from === ZERO && t.tx);
    if (firstMint?.tx) deployer = await rpc.txSender(chain, firstMint.tx);
    if (firstMint && deployBlock == null) deployBlock = firstMint.block;
  }
  emit({ type: "stage", stage: "holders", status: "done", detail: `${holders.length}` });

  // ---- labels -------------------------------------------------------------
  emit({ type: "stage", stage: "labels", status: "running" });
  const market = await marketP;
  if (market) sources.push("DexScreener");
  const labels: Record<string, RawLabel> = {};
  const pairs = new Set(market?.pairAddresses ?? []);
  for (const h of holders) {
    const l = seedLabel(chain, h.address) ?? labelFromNames(names[h.address] ?? []);
    if (l) labels[h.address] = l;
    else if (pairs.has(h.address)) labels[h.address] = { type: "dex", label: "DEX pool" };
  }
  const unknownContracts = holders.filter((h) => h.isContract && !labels[h.address]).map((h) => h.address);
  if (unknownContracts.length) for (const a of await rpc.poolLike(chain, unknownContracts)) labels[a] = { type: "dex", label: "DEX pool" };
  // Contracts that traded with many distinct addresses are pools, routers or v4-style pool
  // managers (which hold liquidity for pools DexScreener lists by id, not address).
  const stillUnknown = new Set(holders.filter((h) => h.isContract && !labels[h.address]).map((h) => h.address));
  if (stillUnknown.size && transfers.length) {
    const peers = new Map<string, Set<string>>();
    for (const t of transfers)
      for (const [x, y] of [[t.from, t.to], [t.to, t.from]]) {
        if (!stillUnknown.has(x)) continue;
        if (!peers.has(x)) peers.set(x, new Set());
        peers.get(x)!.add(y);
      }
    for (const [a, s] of peers) if (s.size >= HUB_PEERS) labels[a] = { type: "dex", label: "Pool / router (inferred)" };
  }
  if (deployer && !labels[deployer]) labels[deployer] = { type: "deployer", label: "Deployer" };
  emit({ type: "stage", stage: "labels", status: "done", detail: `${Object.keys(labels).length}` });

  // ---- link inputs: funders + timestamps --------------------------------
  emit({ type: "stage", stage: "links", status: "running", progress: 0.1 });
  let funders: Record<string, string> | null = null;
  const wallets = holders.filter((h) => !h.isContract && !labels[h.address]?.type.match(/cex|dex|burn|bridge/)).map((h) => h.address);
  if (hs.hypersyncEnabled()) {
    try {
      funders = await hs.firstFunders(chain, wallets, latest, deadline);
      emit({ type: "stage", stage: "links", status: "running", progress: 0.7 });
    } catch (e) {
      limits.push(`Gas-funder lookup failed: ${(e as Error).message}`);
    }
  } else limits.push("Shared gas funders not checked (needs HYPERSYNC_TOKEN).");

  if (complete) {
    const holderSet = new Set(holders.map((h) => h.address));
    const first = new Map<string, number>();
    for (const t of transfers) if (holderSet.has(t.to) && !first.has(t.to)) first.set(t.to, t.block);
    const need = [...first.values()].filter((b) => blockTimes[b] == null);
    if (need.length) Object.assign(blockTimes, await rpc.blockTimes(chain, need).catch(() => ({})));
  }
  emit({ type: "stage", stage: "links", status: "done" });

  return {
    chain,
    token: {
      address: token,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      totalSupply: meta.totalSupply,
      holderCount,
      deployer,
      deployBlock,
      logo: logo ?? market?.logo ?? null,
    },
    blockNumber: latest,
    createdAt: new Date().toISOString(),
    holders,
    labels,
    transfers,
    transfersComplete: complete,
    funders,
    blockTimes,
    market,
    sources,
    limits,
  };
}
