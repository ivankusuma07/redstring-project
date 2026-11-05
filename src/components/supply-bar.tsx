import type { SupplySegment } from "@/lib/types";

const GROUP_FILLS = ["bg-signal", "bg-ink", "bg-g1"];

export function segmentFill(seg: SupplySegment, groupIndex: number): string {
  switch (seg.kind) {
    case "group":
      return GROUP_FILLS[groupIndex] ?? "bg-g1";
    case "groups-other":
      return "stripes-red";
    case "dex":
      return "bg-g2";
    case "cex":
      return "bg-g3";
    case "burn":
    case "bridge":
      return "stripes-grey";
    default:
      return "bg-white";
  }
}

function withIndex(segments: SupplySegment[]) {
  let g = 0;
  return segments.map((s) => ({ s, fill: segmentFill(s, s.kind === "group" ? g++ : 0) }));
}

export function SupplyBar({
  segments,
  height = "h-9",
  border = "border-2",
  showLegend = true,
  big = false,
}: {
  segments: SupplySegment[];
  height?: string;
  border?: string;
  showLegend?: boolean;
  big?: boolean;
}) {
  const items = withIndex(segments);
  return (
    <div>
      <div className={`flex w-full overflow-hidden border-ink bg-white ${border} ${height}`} role="img" aria-label={segments.map((s) => `${s.label} ${s.pct.toFixed(1)}%`).join(", ")}>
        {items.map(({ s, fill }) =>
          s.kind === "free" ? null : (
            <div key={s.key} className={`${fill} h-full shrink-0`} style={{ width: `${Math.max(0, s.pct)}%` }} title={`${s.label} · ${s.pct.toFixed(2)}%`} />
          ),
        )}
      </div>
      {showLegend &&
        (big ? (
          <div className="mt-6 grid grid-cols-2 gap-y-6 md:grid-cols-5">
            {items.map(({ s }, i) => (
              <div key={s.key}>
                <div className={`text-3xl font-extrabold tracking-[-0.03em] md:text-4xl ${i === 0 && s.kind === "group" ? "text-signal" : s.kind === "dex" || s.kind === "cex" ? "text-g1" : ""}`}>
                  {s.pct.toFixed(s.pct >= 10 ? 0 : 1)}%
                </div>
                <div className="mt-1 font-mono text-xs">{s.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <ul className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
            {items.map(({ s }, i) => (
              <li key={s.key}>
                <span className={i === 0 && s.kind === "group" ? "text-signal" : s.kind === "group" || s.kind === "free" ? "font-bold" : "text-g1"}>{s.pct.toFixed(1)}%</span>{" "}
                <span className={s.kind === "dex" || s.kind === "cex" || s.kind === "burn" ? "text-g1" : ""}>{s.label}</span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}

/** Compact three-part bar for tables: linked / exempt / free. */
export function MiniSplit({ linked, exempt }: { linked: number; exempt: number }) {
  return (
    <div className="flex h-4 w-full max-w-52 border-2 border-ink bg-white" title={`${linked.toFixed(1)}% linked · ${exempt.toFixed(1)}% exempt`}>
      <div className="h-full bg-signal" style={{ width: `${linked}%` }} />
      <div className="h-full bg-g2" style={{ width: `${exempt}%` }} />
    </div>
  );
}
