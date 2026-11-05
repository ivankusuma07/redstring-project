import type { RiskLevel, ScoreFactor, Snapshot } from "../types";

const r1 = (v: number) => Math.round(v * 10) / 10;
const f1 = (v: number) => `${v.toFixed(1)}%`;

export function levelFor(score: number): RiskLevel {
  return score >= 70 ? "LOW" : score >= 40 ? "MODERATE" : "HIGH";
}

/** v1 formula from the brief (§5). Start at 100, each factor takes points off. */
export function computeScore(s: Omit<Snapshot, "score">): Snapshot["score"] {
  const factors: ScoreFactor[] = [];
  const clusters = s.clusters;
  const largest = clusters[0];

  // 1. Largest linked group
  factors.push({
    key: "largest",
    label: "Largest linked group",
    detail: largest ? `Group ${largest.id} · ${largest.size} wallets` : "No linked groups",
    value: f1(largest?.pct ?? 0),
    rule: "−1.5 × %",
    points: -Math.min(40, 1.5 * (largest?.pct ?? 0)),
  });

  // 2. Deployer-linked supply
  const dep = clusters.filter((c) => c.deployerLinked);
  let depPct = dep.reduce((a, c) => a + c.pct, 0);
  const deployerNode = s.token.deployer ? s.nodes.find((n) => n.id === s.token.deployer && n.cluster == null && !n.exempt) : undefined;
  if (deployerNode) depPct += deployerNode.pct;
  factors.push({
    key: "deployer",
    label: "Deployer-linked supply",
    detail: dep.length
      ? `${dep.map((c) => `Group ${c.id}`).join(", ")} · ${dep.reduce((a, c) => a + c.size, 0)} wallets`
      : deployerNode
        ? "Deployer wallet"
        : s.token.deployer
          ? "None found"
          : "Deployer unknown",
    value: f1(depPct),
    rule: "−2 × %",
    points: -Math.min(25, 2 * depPct),
  });

  // 3. Launch-block buyers still holding
  const snipers = s.nodes.filter((n) => n.launchBuyer && !n.exempt);
  const sniperPct = snipers.reduce((a, n) => a + n.pct, 0);
  factors.push({
    key: "launch",
    label: "Launch-block buyers",
    detail: s.launchBlock == null ? "Launch block unknown" : snipers.length ? `${snipers.length} wallets still holding` : "None still holding",
    value: f1(sniperPct),
    rule: "−1 × %",
    points: -Math.min(15, sniperPct),
  });

  // 4. Groups with 5+ wallets
  const big = clusters.filter((c) => c.size >= 5);
  factors.push({
    key: "big-groups",
    label: "Groups with 5+ wallets",
    detail: big.length ? `Group${big.length > 1 ? "s" : ""} ${joinAnd(big.map((c) => String(c.id)))}` : "None",
    value: String(big.length),
    rule: "−2 each",
    points: -Math.min(10, 2 * big.length),
  });

  // 5. Fresh-wallet farms: 5+ wallets that share one gas funder
  const farms = clusters.filter((c) => c.sharedFunder && c.size >= 5);
  const farmPct = farms.reduce((a, c) => a + c.pct, 0);
  factors.push({
    key: "farms",
    label: "Fresh-wallet farms",
    detail: farms.length ? `${farms.map((c) => `Group ${c.id}`).join(", ")} · one gas funder` : s.nodes.some((n) => n.funder) ? "None" : "Funders not checked",
    value: f1(farmPct),
    rule: "−1 × %",
    points: -Math.min(10, farmPct),
  });

  // 6. Top 10 non-exempt holders
  const top10 = s.nodes
    .filter((n) => !n.exempt)
    .slice(0, 10)
    .reduce((a, n) => a + n.pct, 0);
  factors.push({
    key: "top10",
    label: "Top 10 non-exempt holders",
    detail: "",
    value: f1(top10),
    rule: "−0.5 × (% − 20)",
    points: top10 > 20 ? -Math.min(30, 0.5 * (top10 - 20)) : 0,
  });

  // 7. Liquidity vs market cap
  const liq = s.market?.liquidityUsd ?? null;
  const mcap = s.market?.marketCap ?? null;
  const ratio = liq != null && mcap ? (liq / mcap) * 100 : null;
  factors.push({
    key: "liquidity",
    label: "Liquidity vs market cap",
    detail: ratio == null ? "No market data" : "",
    value: ratio == null ? "—" : f1(ratio),
    rule: "−10 if under 5%",
    points: ratio != null && ratio < 5 ? -10 : 0,
  });

  for (const f of factors) f.points = r1(f.points) || 0;
  const totalPenalty = r1(-factors.reduce((a, f) => a + f.points, 0));
  const value = Math.max(0, Math.min(100, Math.round(100 - totalPenalty)));
  const level = levelFor(value);
  return { value, level, factors, totalPenalty, summary: summarize(value, level, factors, s) };
}

function summarize(value: number, level: RiskLevel, factors: ScoreFactor[], s: Omit<Snapshot, "score">): string {
  const parts: string[] = [];
  if (level === "MODERATE" && value >= 65) parts.push(`${70 - value} point${70 - value === 1 ? "" : "s"} short of Low risk.`);
  else if (level === "HIGH" && value >= 35) parts.push(`${40 - value} point${40 - value === 1 ? "" : "s"} short of Moderate.`);
  else parts.push(`${level === "LOW" ? "Low" : level === "MODERATE" ? "Moderate" : "High"} risk.`);

  const worst = [...factors].sort((a, b) => a.points - b.points)[0];
  if (!worst || worst.points === 0) {
    parts.push("No linked groups or concentration penalties among the top holders.");
    return parts.join(" ");
  }
  const g = s.clusters[0];
  if (worst.key === "largest" && g) {
    const how = g.launchBuyers >= g.size / 2 ? "bought in the launch block" : g.deployerLinked ? "is linked to the deployer" : g.sharedFunder ? "shares one gas funder" : "moves tokens between its own wallets";
    parts.push(`The biggest drag is a ${g.size}-wallet group that ${how} and still holds ${g.pct.toFixed(1)}% of supply.`);
  } else {
    parts.push(`The biggest drag is ${worst.label.toLowerCase()} (${worst.value}, ${worst.points.toFixed(1)} points).`);
  }
  return parts.join(" ");
}

function joinAnd(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
