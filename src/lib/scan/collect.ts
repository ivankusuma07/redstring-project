import { CHAINS } from "../chains";
import type { ChainKey, ScanEvent } from "../types";
import { hotWalletNonce, hubCandidates, inferHubs, labelFromNames, seedLabel } from "./labels";
import { memoryHistory, readHistory, type HistoryResult, type HistoryStore } from "./history";
import { ZERO, type RawHolder, type RawLabel, type RawScan, type RawTransfer } from "./raw";
import * as al from "./sources/alchemy";
import * as bs from "./sources/blockscout";
import { market as dsMarket } from "./sources/dexscreener";
import * as hs from "./sources/hypersync";
import * as rpc from "./sources/rpc";

export const HOLDER_LIMIT = 250;

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

/** Time kept after the history read for balances, labels and gas funders. */
const RESERVE_MS = 60_000;

export async function collect(
  chain: ChainKey,
  address: string,
  emit: Emit,
  opts: { budgetMs?: number; store?: HistoryStore } = {},
): Promise<RawScan> {
  const budgetMs = opts.budgetMs ?? SCAN_BUDGET_MS;
  const store = opts.store ?? memoryHistory();
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

  // ---- transfer history: stored chunks + whatever is new since the last scan ----
  const onProgress = (p: number) => emit({ type: "stage", stage: "holders", status: "running", progress: Math.min(0.95, 0.3 + p * 0.65) });
  let history: HistoryResult | null = null;
  try {
    // keep time for balances, labels and funders after the read
    history = await readHistory(chain, token, latest, { store, deadline: deadline - Math.min(RESERVE_MS, budgetMs * 0.3), onProgress });
    if (history.source && history.transfers.length && !sources.includes(history.source)) sources.push(history.source);
  } catch (e) {
    console.warn("[scan] history read failed", chain, token, e);
    limits.push(`Transfer history unavailable: ${(e as Error).message}`);
  }
  let transfers: RawTransfer[] = history?.transfers ?? [];
  const complete = !!history?.complete;
  const coverage = history?.coverage ?? 0;
  const pctRead = `${Math.floor(coverage * 100)}% of the token's block range`;

  if (!holders.length && complete) {
    // Full history: balances are exact
    const positive = [...rpc.balancesFrom(transfers)].filter(([a, b]) => b > 0n && a !== ZERO);
    holderCount = positive.length;
    positive.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    const top = positive.slice(0, HOLDER_LIMIT);
    const codes = await rpc.getCodes(chain, top.map(([a]) => a));
    holders = top.map(([a, b]) => ({ address: a, balance: b, isContract: codes[a] ?? false }));
  } else if (!holders.length && transfers.length) {
    // Partial history and no holder list: the biggest net receivers in what was read, with their
    // real balances checked on-chain. Holders whose only receipts are in the unread range are missed.
    const approx = [...rpc.balancesFrom(transfers)].filter(([a, b]) => b > 0n && a !== ZERO);
    approx.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0));
    const candidates = approx.slice(0, HOLDER_LIMIT * 4).map(([a]) => a);
    const exact = await rpc.balancesOf(chain, token, candidates, latest).catch(() => new Map<string, bigint>());
    const top = [...exact].filter(([, b]) => b > 0n).sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0)).slice(0, HOLDER_LIMIT);
    const codes = top.length ? await rpc.getCodes(chain, top.map(([a]) => a)) : {};
    holders = top.map(([a, b]) => ({ address: a, balance: b, isContract: codes[a] ?? false }));
    if (holders.length)
      limits.push(
        `Preliminary: holder list rebuilt from ${transfers.length.toLocaleString("en-US")} transfers (${pctRead}); balances checked on-chain. Holders who only received tokens in the unread range are missing, and launch-block buyers were not checked.`,
      );
  } else if (holders.length && !complete && transfers.length) {
    limits.push(`Preliminary: links use ${transfers.length.toLocaleString("en-US")} transfers (${pctRead}); the rest of the history is still being read. Launch-block buyers not checked.`);
  } else if (holders.length && !transfers.length && bs.blockscoutEnabled(chain)) {
    transfers = await bs.recentTransfers(chain, token, 20).catch(() => []);
    limits.push(`Full transfer history unavailable; links use the latest ${transfers.length.toLocaleString("en-US")} transfers only. Launch-block buyers not checked.`);
  }

  if (!holders.length) {
    if (!transfers.length && !complete)
      throw new ScanError("too_large", `No data source could read this token's history on ${CHAINS[chain].name} right now. Try again shortly.`);
    throw new ScanError("not_found", "This token has no holders yet.");
  }

  // Deployer = the account that sent the first mint. Explorers report the creating *contract* for
  // tokens made by a launchpad factory, which would hide the person who launched it.
  const firstMint = history?.first?.from === ZERO && history.first.tx ? history.first : complete ? transfers.find((t) => t.from === ZERO && t.tx) : undefined;
  if (firstMint?.tx) {
    const sender = await rpc.txSender(chain, firstMint.tx).catch(() => null);
    if (sender) deployer = sender.toLowerCase();
  }
  deployBlock = history?.firstBlock ?? firstMint?.block ?? null;
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
  // A wallet's first funder never changes once it exists: reuse what earlier scans found.
  const cached = await store.funders(chain, wallets).catch(() => ({}) as Record<string, string>);
  const missing = wallets.filter((w) => !cached[w]);
  const funderDeadline = Math.max(deadline, Date.now() + 45_000);
  let found: Record<string, string> | null = null;
  // Alchemy first; whatever it couldn't check (quota gone, throttled) goes to HyperSync.
  let todo = missing;
  if (todo.length && al.alchemyEnabled(chain)) {
    try {
      const r = await al.firstFunders(chain, todo, latest, funderDeadline);
      found = r.funders;
      if (!sources.includes("Alchemy")) sources.push("Alchemy");
      todo = al.alchemyEnabled(chain) ? [] : r.unchecked;
      if (!todo.length && r.checked < missing.length) limits.push(`Gas funders checked for ${wallets.length - missing.length + r.checked} of ${wallets.length} wallets (time limit).`);
    } catch (e) {
      if (!(e instanceof al.AlchemyUnavailable)) {
        limits.push(`Gas-funder lookup failed: ${(e as Error).message}`);
        todo = [];
      }
    }
  }
  if (todo.length && !al.alchemyEnabled(chain) && hs.hypersyncEnabled()) {
    try {
      found = { ...found, ...(await hs.firstFunders(chain, todo, latest, funderDeadline)) };
      if (!sources.includes("HyperSync")) sources.push("HyperSync");
    } catch (e) {
      limits.push(`Gas-funder lookup failed: ${(e as Error).message}`);
    }
  } else if (!missing.length) found = {};
  else if (todo.length)
    limits.push(
      al.alchemyUrl(chain)
        ? `Shared gas funders not checked for ${todo.length} of ${wallets.length} wallets (Alchemy unavailable right now, no HYPERSYNC_TOKEN).`
        : "Shared gas funders not checked (needs HYPERSYNC_TOKEN or an Alchemy RPC).",
    );
  if (found) {
    await store.saveFunders(chain, found).catch(() => undefined);
    funders = { ...cached, ...found };
  } else if (Object.keys(cached).length) funders = cached;
  emit({ type: "stage", stage: "links", status: "running", progress: 0.7 });
  if (funders) Object.assign(labels, await labelFunders(chain, funders, labels));

  const blockTimes: Record<number, number> = {};
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
    historyCoverage: coverage,
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
