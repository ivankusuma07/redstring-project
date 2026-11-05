import { shortAddr } from "../format";
import {
  EXEMPT_TYPES,
  type Cluster,
  type HolderLink,
  type HolderNode,
  type LinkKind,
  type Snapshot,
  type SupplySegment,
} from "../types";
import { ZERO, type RawScan } from "./raw";
import { computeScore } from "./score";

/** Union-find with path compression. */
export class DSU {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** A contract that moved tokens with this many holders is treated as a hub (router, staking, distributor) and never links wallets. */
const CONTRACT_HUB_DEGREE = 10;
/** A gas funder shared by more wallets than this is almost surely an exchange or bridge we have not labelled. */
const MAX_FUNDER_FANOUT = 60;

function toPct(balance: bigint, total: bigint): number {
  if (total <= 0n) return 0;
  return Number((balance * 1_000_000n) / total) / 10_000;
}

function toAmount(balance: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const whole = balance / base;
  const frac = balance % base;
  return Number(whole) + Number(frac) / Number(base);
}

export function analyze(raw: RawScan): Snapshot {
  const total = BigInt(raw.token.totalSupply);
  const deployer = raw.token.deployer?.toLowerCase() ?? null;

  // ---- nodes -------------------------------------------------------------
  const nodes: HolderNode[] = raw.holders.map((h, i) => {
    const id = h.address.toLowerCase();
    let lab = raw.labels[id] ?? null;
    if (!lab && id === deployer) lab = { type: "deployer", label: "Deployer" };
    if (!lab && h.isContract) lab = { type: "contract", label: "Contract" };
    const type = lab?.type ?? "wallet";
    return {
      id,
      rank: i + 1,
      balance: h.balance.toString(),
      amount: toAmount(h.balance, raw.token.decimals),
      pct: toPct(h.balance, total),
      type,
      label: lab?.label ?? null,
      exempt: EXEMPT_TYPES.includes(type),
      isContract: h.isContract,
      cluster: null,
      firstHeld: null,
      launchBuyer: false,
      fromDeployer: false,
      funder: raw.funders?.[id] ?? null,
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isExempt = (a: string) => {
    const n = byId.get(a);
    if (n) return n.exempt;
    const l = raw.labels[a];
    return !!l && EXEMPT_TYPES.includes(l.type);
  };
  const dexSet = new Set(
    Object.entries(raw.labels)
      .filter(([, l]) => l.type === "dex")
      .map(([a]) => a),
  );

  // ---- launch block + first held ----------------------------------------
  const transfers = [...raw.transfers].sort((a, b) => a.block - b.block);
  let launchBlock: number | null = null;
  for (const t of transfers) {
    if (t.from === ZERO) continue;
    if (dexSet.has(t.to) || dexSet.has(t.from)) {
      launchBlock = t.block;
      break;
    }
  }
  if (!raw.transfersComplete) launchBlock = null; // can't know the launch from a partial window

  for (const t of transfers) {
    const n = byId.get(t.to);
    if (!n) continue;
    if (!n.firstHeld) {
      n.firstHeld = { block: t.block, timestamp: raw.blockTimes[t.block] ?? null };
      if (launchBlock != null && t.block === launchBlock && dexSet.has(t.from)) n.launchBuyer = true;
    }
    if (deployer && t.from === deployer && t.to !== deployer) n.fromDeployer = true;
  }
  if (!raw.transfersComplete) for (const n of nodes) n.firstHeld = null; // window is partial: "first held" would lie

  // ---- edges --------------------------------------------------------------
  const links: HolderLink[] = [];

  // a. token transfers between holders
  const contractDegree = new Map<string, Set<string>>();
  const pairAgg = new Map<string, HolderLink>();
  for (const t of transfers) {
    if (t.from === t.to) continue;
    const a = byId.get(t.from);
    const b = byId.get(t.to);
    if (!a || !b || a.exempt || b.exempt) continue;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x.isContract) {
        if (!contractDegree.has(x.id)) contractDegree.set(x.id, new Set());
        contractDegree.get(x.id)!.add(y.id);
      }
    }
    const [s, d] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    const key = `${s}|${d}`;
    const prev = pairAgg.get(key);
    const amt = toAmount(t.value, raw.token.decimals);
    if (prev) {
      prev.count += 1;
      prev.amount = (prev.amount ?? 0) + amt;
    } else pairAgg.set(key, { source: s, target: d, kind: "transfer", count: 1, amount: amt });
  }
  const hubs = new Set([...contractDegree].filter(([, s]) => s.size >= CONTRACT_HUB_DEGREE).map(([a]) => a));
  for (const l of pairAgg.values()) if (!hubs.has(l.source) && !hubs.has(l.target)) links.push(l);

  // b. shared native funder (star around the largest member)
  if (raw.funders) {
    const groups = new Map<string, HolderNode[]>();
    for (const n of nodes) {
      if (n.exempt || !n.funder || isExempt(n.funder)) continue;
      if (!groups.has(n.funder)) groups.set(n.funder, []);
      groups.get(n.funder)!.push(n);
    }
    for (const [funder, members] of groups) {
      // the funder itself may be a holder
      const funderNode = byId.get(funder);
      if (funderNode && !funderNode.exempt) members.push(funderNode);
      const uniq = [...new Map(members.map((m) => [m.id, m])).values()];
      if (uniq.length < 2 || uniq.length > MAX_FUNDER_FANOUT) continue;
      uniq.sort((x, y) => y.pct - x.pct);
      const hub = uniq[0];
      for (const m of uniq.slice(1)) links.push({ source: hub.id, target: m.id, kind: "funder", count: 1, via: funder });
    }
  }

  // c. bought in the launch block
  if (launchBlock != null) {
    const snipers = nodes.filter((n) => n.launchBuyer && !n.exempt).sort((x, y) => y.pct - x.pct);
    if (snipers.length >= 2) {
      for (const m of snipers.slice(1))
        links.push({ source: snipers[0].id, target: m.id, kind: "same-block", count: 1, via: String(launchBlock) });
    }
  }

  // ---- clusters (DSU) ----------------------------------------------------
  const dsu = new DSU();
  for (const l of links) if (!isExempt(l.source) && !isExempt(l.target)) dsu.union(l.source, l.target);
  const comps = new Map<string, HolderNode[]>();
  for (const n of nodes) {
    if (n.exempt) continue;
    const r = dsu.find(n.id);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r)!.push(n);
  }
  const groups = [...comps.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({ members: g, pct: g.reduce((s, m) => s + m.pct, 0) }))
    .sort((a, b) => b.pct - a.pct);

  const clusters: Cluster[] = groups.map((g, i) => {
    const id = i + 1;
    const ids = new Set(g.members.map((m) => m.id));
    for (const m of g.members) m.cluster = id;
    const inner = links.filter((l) => ids.has(l.source) && ids.has(l.target));
    const kinds = [...new Set(inner.map((l) => l.kind))] as LinkKind[];
    const launchBuyers = g.members.filter((m) => m.launchBuyer).length;
    const hasDeployer = !!deployer && ids.has(deployer);
    const deployerLinked = hasDeployer || g.members.some((m) => m.fromDeployer);
    const funderCounts = new Map<string, number>();
    for (const m of g.members) if (m.funder) funderCounts.set(m.funder, (funderCounts.get(m.funder) ?? 0) + 1);
    const topFunder = [...funderCounts].sort((a, b) => b[1] - a[1])[0];
    const sharedFunder = topFunder && topFunder[1] >= Math.max(2, g.members.length * 0.6) ? topFunder[0] : null;
    const transferCount = inner.filter((l) => l.kind === "transfer").reduce((s, l) => s + l.count, 0);
    const movers = new Set(inner.filter((l) => l.kind === "transfer").flatMap((l) => [l.source, l.target])).size;
    const size = g.members.length;

    let title: string;
    let body: string;
    if (launchBuyers >= Math.ceil(size / 2)) {
      title = `${size} wallets, same block`;
      body = `${launchBuyers === size ? `All ${size}` : `${launchBuyers} of ${size}`} bought in block ${launchBlock?.toLocaleString("en-US")}, the same block liquidity was added.`;
      if (movers > 0) body += ` ${movers} have moved tokens between each other.`;
    } else if (deployerLinked) {
      title = hasDeployer ? `Deployer and ${size - 1} wallet${size - 1 === 1 ? "" : "s"}` : `${size} deployer-linked wallets`;
      const direct = g.members.filter((m) => m.fromDeployer).length;
      body = `The deployer sent tokens directly to ${direct} wallet${direct === 1 ? "" : "s"} in this group.`;
      if (kinds.includes("funder")) body += " Some share a gas funder.";
    } else if (sharedFunder) {
      title = `${size} wallets, one funder`;
      body = `Each was first funded with gas from ${shortAddr(sharedFunder)}.`;
      if (transferCount > 0) body += ` They also moved tokens between each other ${transferCount} times.`;
    } else {
      title = `${size} wallets, direct transfers`;
      body = `These wallets sent the token to each other ${transferCount} time${transferCount === 1 ? "" : "s"}.`;
    }
    return {
      id,
      size,
      pct: round2(g.pct),
      members: g.members.map((m) => m.id),
      kinds,
      deployerLinked,
      launchBuyers,
      sharedFunder,
      title,
      body,
    };
  });

  // ---- supply split -------------------------------------------------------
  const linked = round2(clusters.reduce((s, c) => s + c.pct, 0));
  const exemptBy = (t: string) => round2(nodes.filter((n) => n.type === t).reduce((s, n) => s + n.pct, 0));
  const exempt = round2(nodes.filter((n) => n.exempt).reduce((s, n) => s + n.pct, 0));
  const segments: SupplySegment[] = [];
  clusters.slice(0, 3).forEach((c) => segments.push({ key: `g${c.id}`, kind: "group", label: `Group ${c.id}`, pct: c.pct }));
  const other = round2(clusters.slice(3).reduce((s, c) => s + c.pct, 0));
  if (other > 0) segments.push({ key: "gx", kind: "groups-other", label: `${clusters.length - 3} more groups`, pct: other });
  for (const [kind, label] of [["dex", "DEX pool"], ["cex", "CEX"], ["burn", "Burn"], ["bridge", "Bridge"]] as const) {
    const v = exemptBy(kind);
    if (v > 0) segments.push({ key: kind, kind, label, pct: v });
  }
  const free = round2(Math.max(0, 100 - linked - exempt));
  segments.push({ key: "free", kind: "free", label: "Free float", pct: free });
  const top250 = round2(nodes.reduce((s, n) => s + n.pct, 0));

  const partial: Omit<Snapshot, "score"> = {
    version: 1,
    chain: raw.chain,
    token: raw.token,
    blockNumber: raw.blockNumber,
    createdAt: raw.createdAt,
    launchBlock,
    market: raw.market,
    nodes,
    links,
    clusters,
    supply: { linked, exempt, free, top250, segments },
    sources: raw.sources,
    limits: raw.limits,
    history: { complete: raw.transfersComplete, coverage: raw.transfersComplete ? 1 : Math.round((raw.historyCoverage ?? 0) * 1000) / 1000 },
    ...(raw.example ? { example: true } : {}),
  };
  return { ...partial, score: computeScore(partial) };
}

export const round2 = (v: number) => Math.round(v * 100) / 100;
