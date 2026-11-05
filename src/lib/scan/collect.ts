import { CHAINS } from "../chains";
import type { ChainKey, ScanEvent } from "../types";
import { hotWalletNonce, hubCandidates, inferHubs, labelFromNames, seedLabel } from "./labels";
import { ZERO, type RawHolder, type RawLabel, type RawScan, type RawTransfer } from "./raw";
import * as al from "./sources/alchemy";
import * as bs from "./sources/blockscout";
import { market as dsMarket } from "./sources/dexscreener";
import * as hs from "./sources/hypersync";
import * as rpc from "./sources/rpc";

export const HOLDER_LIMIT = 250;
const MAX_REPLAY_LOGS = 400_000;

export class ScanError extends Error {
  constructor(
    public code: Extract<ScanEvent, { type: "error" }>["code"],
    message: string,
  ) {
    super(message);
  }
}

type Emit = (e: ScanEvent) => void;

/** Time one scan may spend collecting. 170 s fits a 300 s serverless limit; a VPS can allow more. */
const SCAN_BUDGET_MS = Number(process.env.SCAN_BUDGET_MS) || 170_000;

export async function collect(chain: ChainKey, address: string, emit: Emit, budgetMs = SCAN_BUDGET_MS): Promise<RawScan> {
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

  if (bs.blockscoutEnabled(chain)) {
    try {
      const [list, info] = await Promise.all([bs.holders(chain, token, HOLDER_LIMIT), bs.tokenInfo(chain, token)]);
      holders = list.map((h) => ({ address: h.address, balance: h.balance, isContract: h.isContract }));
      names = Object.fromEntries(list.map((h) => [h.address, h.names]));
      holderCount = info.holderCount;
      deployer = info.deployer;
      logo = info.logo;
      sources.push("Blockscout");
      emit({ type: "stage", stage: "holders", status: "running", detail: `${holders.length}`, progress: 0.3 });
    } catch (e) {
      // Plan gaps and outages fall back to HyperSync / RPC; the holder list is rebuilt from history.
      if (!(e instanceof bs.BlockscoutPlanError)) console.warn("[scan] blockscout failed", chain, (e as Error).message);
      holders = [];
      names = {};
    }
  }

  let transfers: RawTransfer[] = [];
  let complete = false;
  // Incomplete history kept for rebuilding the holder list when nothing else has one
  let partial = null as { transfers: RawTransfer[]; coverage: number; source: string; first: RawTransfer | null } | null; // assigned in closures below
  let rebuilt = false;
  let blockTimes: Record<number, number> = {};
  const onProgress = (p: number) => emit({ type: "stage", stage: "holders", status: "running", progress: Math.min(0.95, 0.3 + p * 0.65) });

  const viaHypersync = async () => {
    if (!hs.hypersyncEnabled() || complete) return;
    try {
      const r = await hs.transfers(chain, token, latest, { maxLogs: MAX_REPLAY_LOGS * 5, deadline, onProgress });
      transfers = r.transfers;
      blockTimes = r.blockTimes;
      complete = r.complete;
      sources.push("HyperSync");
    } catch (e) {
      limits.push(`HyperSync failed: ${(e as Error).message}`);
    }
  };
  const viaRpc = async () => {
    if (complete || Date.now() > deadline - 20_000) return; // no time left for a slow replay
    try {
      deployBlock = await rpc.findDeployBlock(chain, token, latest);
      transfers = await rpc.replayTransfers(chain, token, deployBlock, latest, { maxLogs: MAX_REPLAY_LOGS, deadline, onProgress });
      complete = true;
      if (!sources.includes("RPC log replay")) sources.push("RPC log replay");
    } catch (e) {
      if (!(e instanceof rpc.TooLargeError)) limits.push(`Log replay failed: ${(e as Error).message}`);
      transfers = [];
    }
  };
  const viaAlchemy = async () => {
    if (!al.alchemyEnabled(chain) || complete) return;
    try {
      const r = await al.transfers(chain, token, latest, { maxLogs: MAX_REPLAY_LOGS * 5, deadline: deadline - 75_000, onProgress }); // leave time for balances, labels and funders
      if (r.complete) {
        transfers = r.transfers;
        complete = true;
        if (r.firstBlock != null) deployBlock = r.firstBlock;
        sources.push("Alchemy");
      } else {
        partial = { transfers: r.transfers, coverage: r.coverage, source: "Alchemy", first: r.firstTransfer };
        limits.push(`Alchemy transfer history incomplete (${r.stopped === "time" ? "time limit" : r.stopped === "size" ? "size limit" : r.stopped}).`);
      }
    } catch (e) {
      limits.push(`Alchemy failed: ${(e as Error).message}`);
    }
  };
  // Chains whose RPC serves huge eth_getLogs ranges (Robinhood Chain) replay history for free and
  // keep the rate-limited HyperSync budget for gas funders. Elsewhere: Alchemy's Transfers API,
  // then HyperSync, then public-RPC replay.
  if (CHAINS[chain].logRange >= 1_000_000) {
    await viaRpc();
    await viaHypersync();
  } else {
    await viaAlchemy();
    // HyperSync's rate limit can't finish what Alchemy couldn't in the time left; skip it then.
    if (!al.alchemyEnabled(chain)) await viaHypersync();
    await viaRpc();
  }

  // No holder list and only part of the history: take the biggest net receivers in what was read
  // and check their real balances on-chain. Balances are exact; holders whose only receipts fall in
  // the unread range are missed, which the scan states.
  if (!holders.length && !complete && partial && partial.transfers.length) {
    const approx = [...rpc.balancesFrom(partial.transfers)].filter(([a, b]) => b > 0n && a !== ZERO);
    approx.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    const candidates = approx.slice(0, HOLDER_LIMIT * 4).map(([a]) => a);
    const exact = await rpc.balancesOf(chain, token, candidates, latest).catch(() => new Map<string, bigint>());
    const top = [...exact].filter(([, b]) => b > 0n).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0)).slice(0, HOLDER_LIMIT);
    if (top.length) {
      const codes = await rpc.getCodes(chain, top.map(([a]) => a));
      holders = top.map(([a, b]) => ({ address: a, balance: b, isContract: codes[a] ?? false }));
      transfers = partial.transfers;
      rebuilt = true;
      sources.push(partial.source);
      // replace the per-source "incomplete/failed" notes with one statement of what this scan covers
      const keep = limits.filter((l) => !/^(Alchemy transfer history incomplete|HyperSync failed|Log replay failed)/.test(l));
      limits.splice(0, limits.length, ...keep);
      limits.push(
        `Holder list rebuilt from ${partial.transfers.length.toLocaleString("en-US")} transfers (${Math.round(partial.coverage * 100)}% of the token's block range); balances checked on-chain. Holders who only received tokens in the unread range are missing, and launch-block buyers were not checked.`,
      );
    }
  }

  if (!holders.length) {
    if (!complete)
      throw new ScanError(
        "too_large",
        hs.hypersyncEnabled()
          ? `This token has more transfer history than the current data plan can read in one scan, and no holder list is available for ${CHAINS[chain].name}. It needs Blockscout coverage for this chain or a higher HyperSync rate limit.`
          : "This token has too much history to replay over a public RPC. Set BLOCKSCOUT_API_KEY or HYPERSYNC_TOKEN to scan it.",
      );
    const bal = rpc.balancesFrom(transfers);
    const positive = [...bal].filter(([a, b]) => b > 0n && a !== ZERO);
    holderCount = positive.length;
    positive.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    const top = positive.slice(0, HOLDER_LIMIT);
    const codes = await rpc.getCodes(chain, top.map(([a]) => a));
    holders = top.map(([a, b]) => ({ address: a, balance: b, isContract: codes[a] ?? false }));
  }
  if (!complete && !rebuilt && holders.length && partial?.transfers.length) {
    transfers = partial.transfers;
    if (!sources.includes(partial.source)) sources.push(partial.source);
    const keep = limits.filter((l) => !/^(Alchemy transfer history incomplete|HyperSync failed|Log replay failed)/.test(l));
    limits.splice(0, limits.length, ...keep);
    limits.push(
      `Links use ${partial.transfers.length.toLocaleString("en-US")} transfers (${Math.round(partial.coverage * 100)}% of the token's block range); the rest of the history was not read in time. Launch-block buyers not checked.`,
    );
  } else if (!complete && holders.length && bs.blockscoutEnabled(chain)) {
    transfers = await bs.recentTransfers(chain, token, 20).catch(() => []);
    limits.push(`Full transfer history unavailable; links use the latest ${transfers.length.toLocaleString("en-US")} transfers only. Launch-block buyers not checked.`);
  }
  if (!holders.length) throw new ScanError("not_found", "This token has no holders yet.");

  // Deployer = the account that sent the first mint. Explorers report the creating *contract* for
  // tokens made by a launchpad factory, which would hide the person who launched it.
  if (complete) {
    const firstMint = [...transfers].sort((a, b) => a.block - b.block).find((t) => t.from === ZERO && t.tx);
    const sender = firstMint?.tx ? await rpc.txSender(chain, firstMint.tx).catch(() => null) : null;
    if (sender) deployer = sender.toLowerCase();
    if (firstMint && deployBlock == null) deployBlock = firstMint.block;
  }
  // Partial history still knows the token's very first transfer; if it is a mint, its sender is the deployer.
  if (!complete && partial?.first?.from === ZERO && partial.first.tx) {
    const sender = await rpc.txSender(chain, partial.first.tx).catch(() => null);
    if (sender) deployer = sender.toLowerCase();
    if (deployBlock == null) deployBlock = partial.first.block;
  }
  if (deployer && (await rpc.getCodes(chain, [deployer]).catch(() => ({}) as Record<string, boolean>))[deployer]) deployer = null;
  emit({ type: "stage", stage: "holders", status: "done", detail: `${holders.length}` });

  // ---- labels -------------------------------------------------------------
  emit({ type: "stage", stage: "labels", status: "running" });
  const market = await marketP;
  if (market) sources.push("DexScreener");
  const labels: Record<string, RawLabel> = {};
  const pairs = new Set(market?.pairAddresses ?? []);
  for (const h of holders) {
    const l = seedLabel(chain, h.address, h.isContract) ?? labelFromNames(names[h.address] ?? []);
    if (l) labels[h.address] = l;
    else if (pairs.has(h.address)) labels[h.address] = { type: "dex", label: "DEX pool" };
  }
  const unknownContracts = holders.filter((h) => h.isContract && !labels[h.address]).map((h) => h.address);
  if (unknownContracts.length) for (const a of await rpc.poolLike(chain, unknownContracts)) labels[a] = { type: "dex", label: "DEX pool" };
  // Hubs no list knows: busy contracts (pools, routers, v4 pool managers) and busy EOAs with
  // exchange-scale nonces. See inferHubs().
  const holderHubs = hubCandidates({ holders, transfers, labels, funders: null });
  const holderNonces = await rpc.nonces(chain, holderHubs).catch(() => ({}));
  Object.assign(labels, inferHubs({ holders, transfers, labels, candidates: holderHubs, nonces: holderNonces, minNonce: hotWalletNonce(chain) }));
  if (deployer && !labels[deployer]) labels[deployer] = { type: "deployer", label: "Deployer" };
  emit({ type: "stage", stage: "labels", status: "done", detail: `${Object.keys(labels).length}` });

  // ---- link inputs: funders + timestamps --------------------------------
  emit({ type: "stage", stage: "links", status: "running", progress: 0.1 });
  let funders: Record<string, string> | null = null;
  const wallets = holders.filter((h) => !h.isContract && !labels[h.address]?.type.match(/cex|dex|burn|bridge/)).map((h) => h.address);
  if (al.alchemyEnabled(chain)) {
    try {
      const r = await al.firstFunders(chain, wallets, latest, Math.max(deadline, Date.now() + 45_000));
      funders = r.funders;
      if (!sources.includes("Alchemy")) sources.push("Alchemy");
      if (r.checked < wallets.length) limits.push(`Gas funders checked for ${r.checked} of ${wallets.length} wallets (time limit).`);
      emit({ type: "stage", stage: "links", status: "running", progress: 0.7 });
    } catch (e) {
      limits.push(`Gas-funder lookup failed: ${(e as Error).message}`);
    }
  } else if (hs.hypersyncEnabled()) {
    try {
      funders = await hs.firstFunders(chain, wallets, latest, deadline);
      if (!sources.includes("HyperSync")) sources.push("HyperSync");
      emit({ type: "stage", stage: "links", status: "running", progress: 0.7 });
    } catch (e) {
      limits.push(`Gas-funder lookup failed: ${(e as Error).message}`);
    }
  } else limits.push("Shared gas funders not checked (needs HYPERSYNC_TOKEN or an Alchemy RPC).");
  if (funders) Object.assign(labels, await labelFunders(chain, funders, labels));

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

/** Gas funders are rarely holders, so label them separately: known lists, then the nonce test. */
async function labelFunders(chain: ChainKey, funders: Record<string, string>, labels: Record<string, RawLabel>) {
  const out: Record<string, RawLabel> = {};
  const distinct = [...new Set(Object.values(funders))].filter((f) => !labels[f]);
  const listed = distinct.filter((f) => seedLabel(chain, f));
  const codes = listed.length ? await rpc.getCodes(chain, listed).catch(() => ({}) as Record<string, boolean>) : {};
  for (const f of listed) {
    const l = seedLabel(chain, f, codes[f] ?? false);
    if (l) out[f] = l;
  }
  const known = { ...labels, ...out };
  const candidates = hubCandidates({ holders: [], transfers: [], labels: known, funders });
  const ns = await rpc.nonces(chain, candidates).catch(() => ({}));
  return { ...out, ...inferHubs({ holders: [], transfers: [], labels: known, candidates, nonces: ns, minNonce: hotWalletNonce(chain) }) };
}
