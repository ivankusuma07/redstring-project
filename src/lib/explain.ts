import { daysAgo, shortAddr } from "./format";
import type { Cluster, HolderNode, Snapshot } from "./types";

/** Human words for each part of the map, shared by table, panel and cards. */

export function firstHeldLabel(n: HolderNode, s: Snapshot): string {
  if (!n.firstHeld) return "—";
  if (n.launchBuyer) return "Launch block";
  if (s.launchBlock != null && n.firstHeld.block <= s.launchBlock) return "Launch";
  if (n.firstHeld.timestamp) return daysAgo(n.firstHeld.timestamp, Date.parse(s.createdAt));
  return `Block ${n.firstHeld.block.toLocaleString("en-US")}`;
}

export function groupLabel(n: HolderNode): string {
  if (n.exempt) return "Exempt";
  if (n.cluster != null) return `Group ${n.cluster}`;
  return "Free float";
}

export function holderLabel(n: HolderNode): string {
  if (n.type === "cex") return n.label && n.label !== "CEX" ? n.label : "CEX hot wallet";
  if (n.type === "dex") return n.label ?? "DEX pool";
  if (n.type === "burn") return "Burn";
  if (n.type === "bridge") return n.label ?? "Bridge";
  if (n.type === "deployer") return "Deployer";
  if (n.type === "contract") return "Contract";
  return "—";
}

export function linkReason(n: HolderNode, s: Snapshot): string {
  if (n.exempt || n.cluster == null) return "—";
  if (n.type === "deployer") return "Deployed contract";
  const kinds = new Set(s.links.filter((l) => l.source === n.id || l.target === n.id).map((l) => l.kind));
  const parts: string[] = [];
  if (kinds.has("same-block") || n.launchBuyer) parts.push("Same block");
  if (n.fromDeployer) parts.push("Transfers from deployer");
  else if (kinds.has("transfer")) parts.push(parts.length ? "transfers" : "Transfers");
  if (kinds.has("funder")) parts.push(parts.length ? "shared funder" : "Shared funder");
  return parts.join(" · ") || "Linked";
}

export function clusterShort(c: Cluster): string {
  if (c.launchBuyers >= Math.ceil(c.size / 2)) return "Same-block buys";
  if (c.deployerLinked) return "Deployer-linked";
  if (c.sharedFunder) return "Shared funder";
  return "Transfers";
}

export function clusterMobileShort(c: Cluster): string {
  if (c.launchBuyers >= Math.ceil(c.size / 2)) return "same block";
  if (c.deployerLinked) return "deployer";
  if (c.sharedFunder) return "one funder";
  return "transfers";
}

export interface Reason {
  kind: "transfer" | "funder" | "same-block" | "deployer";
  text: string;
}

/** "Why it's linked" bullets for one wallet. */
export function whyLinked(n: HolderNode, s: Snapshot): Reason[] {
  const out: Reason[] = [];
  const byId = new Map(s.nodes.map((x) => [x.id, x]));
  const mine = s.links.filter((l) => l.source === n.id || l.target === n.id);
  const other = (l: (typeof mine)[number]) => byId.get(l.source === n.id ? l.target : l.source);

  const transfers = mine.filter((l) => l.kind === "transfer");
  if (transfers.length) {
    const count = transfers.reduce((a, l) => a + l.count, 0);
    const groups = new Set(transfers.map((l) => other(l)?.cluster).filter((g) => g != null));
    out.push({ kind: "transfer", text: `${count} token transfer${count === 1 ? "" : "s"} with ${groups.size ? `Group ${[...groups].join(", ")}` : "linked"} wallet${transfers.length === 1 ? "" : "s"}` });
  }
  if (n.funder) {
    const peers = s.nodes.filter((x) => x.id !== n.id && x.funder === n.funder && !x.exempt);
    if (peers.length && mine.some((l) => l.kind === "funder")) {
      out.push({ kind: "funder", text: `Same gas funder (${shortAddr(n.funder)}) as ${peers.length} other holder${peers.length === 1 ? "" : "s"}` });
    }
  }
  if (n.launchBuyer) {
    const others = s.nodes.filter((x) => x.launchBuyer && x.id !== n.id && !x.exempt).length;
    out.push({ kind: "same-block", text: `Bought in the launch block${others ? ` with ${others} other${others === 1 ? "" : "s"}` : ""}` });
  }
  if (n.fromDeployer) out.push({ kind: "deployer", text: "Received tokens directly from the deployer" });
  if (n.type === "deployer") out.push({ kind: "deployer", text: "Deployed the token contract" });
  return out;
}
