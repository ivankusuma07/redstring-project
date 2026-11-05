"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { firstHeldLabel, groupLabel, holderLabel, linkReason } from "@/lib/explain";
import { amount, shortAddr } from "@/lib/format";
import type { HolderNode, Snapshot } from "@/lib/types";

type Filter = "all" | "linked" | "noexempt";
type SortKey = "rank" | "group" | "pct";
const PAGE = 25;

function csv(s: Snapshot, rows: HolderNode[]) {
  const head = ["rank", "address", "label", "group", "balance", "pct_supply", "first_held", "link_reason", "funder"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((n) => [n.rank, n.id, holderLabel(n), groupLabel(n), amount(n.amount).replace(/,/g, ""), n.pct, firstHeldLabel(n, s), linkReason(n, s), n.funder ?? ""].map(esc).join(","));
  const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${s.token.symbol.toLowerCase()}-holders-${s.blockNumber}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function HoldersTab({ s, onPick }: { s: Snapshot; onPick: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    let r = s.nodes;
    if (filter === "linked") r = r.filter((n) => n.cluster != null);
    if (filter === "noexempt") r = r.filter((n) => !n.exempt);
    const val = (n: HolderNode) => (sort.key === "rank" ? n.rank : sort.key === "pct" ? -n.pct : (n.cluster ?? (n.exempt ? 1e6 : 1e5)));
    return [...r].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [s, filter, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  const fbtn = (f: Filter, label: string) => (
    <button
      type="button"
      onClick={() => {
        setFilter(f);
        setPage(0);
      }}
      aria-pressed={filter === f}
      className={`h-12 border-2 border-ink px-4 font-bold ${filter === f ? "bg-ink text-white" : "hover:bg-[#f3f3f3]"}`}
    >
      {label}
    </button>
  );
  const sortBtn = (key: SortKey, label: string, align = "text-left") => (
    <button
      type="button"
      className={`inline-flex items-center gap-1 ${align}`}
      onClick={() => setSort((p) => ({ key, dir: p.key === key ? ((-p.dir) as 1 | -1) : 1 }))}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sort.key === key ? sort.dir === 1 ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : null}
    </button>
  );

  return (
    <section className="px-5 py-8 md:px-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="display text-[40px] md:text-[56px]">Top {s.nodes.length} holders</h2>
        <div className="flex flex-wrap gap-2.5">
          {fbtn("all", "All")}
          {fbtn("linked", "Linked only")}
          {fbtn("noexempt", "Hide exempt")}
          <button type="button" onClick={() => csv(s, rows)} className="h-12 border-2 border-ink px-4 font-bold hover:bg-ink hover:text-white">
            Export CSV
          </button>
        </div>
      </div>
      <div className="mt-6 overflow-x-auto border-t-[6px] border-ink">
        <table className="w-full min-w-[960px] border-collapse text-left">
          <thead className="font-mono text-xs">
            <tr className="border-b-2 border-ink">
              <th className="w-14 py-4 pr-3 text-right font-bold">{sortBtn("rank", "#")}</th>
              <th className="py-4 pl-4 font-bold">Address</th>
              <th className="py-4 font-bold">Label</th>
              <th className="py-4 font-bold">{sortBtn("group", "Group")}</th>
              <th className="py-4 text-right font-bold">Balance</th>
              <th className="py-4 pl-6 text-right font-bold">{sortBtn("pct", "% supply")}</th>
              <th className="py-4 pl-6 font-bold">First held</th>
              <th className="py-4 font-bold">Link reason</th>
            </tr>
          </thead>
          <tbody>
            {view.map((n) => (
              <tr key={n.id} className="cursor-pointer border-b border-ink hover:bg-[#f7f7f7]" onClick={() => onPick(n.id)} data-testid="holder-row">
                <td className="py-3.5 pr-3 text-right font-mono text-sm">{n.rank}</td>
                <td className="py-3.5 pl-4 font-mono text-sm">{shortAddr(n.id)}</td>
                <td className="py-3.5 text-[17px]">{holderLabel(n)}</td>
                <td className={`py-3.5 text-[17px] ${n.cluster === 1 ? "font-extrabold text-signal" : n.cluster != null ? "font-extrabold" : "text-g1"}`}>{groupLabel(n)}</td>
                <td className="py-3.5 text-right font-mono text-sm">{amount(n.amount)}</td>
                <td className={`py-3.5 pl-6 text-right font-mono text-sm ${n.cluster === 1 ? "text-signal" : ""}`}>{n.pct.toFixed(2)}%</td>
                <td className="py-3.5 pl-6 font-mono text-sm">{firstHeldLabel(n, s)}</td>
                <td className="py-3.5 text-[17px]">{linkReason(n, s)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="font-mono text-sm">
          Showing {rows.length ? page * PAGE + 1 : 0}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}
        </p>
        <div className="flex gap-2">
          {Array.from({ length: pages }, (_, i) => i)
            .filter((i) => Math.abs(i - page) <= 2 || i === pages - 1 || i === 0)
            .map((i) => (
              <button
                type="button"
                key={i}
                onClick={() => setPage(i)}
                className={`size-12 border-2 border-ink font-mono text-sm ${i === page ? "bg-ink text-white" : "hover:bg-[#f3f3f3]"}`}
                aria-current={i === page ? "page" : undefined}
              >
                {i + 1}
              </button>
            ))}
          <button
            type="button"
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            className="h-12 border-2 border-ink px-5 font-mono text-sm disabled:border-g3 disabled:text-g2"
          >
            Next →
          </button>
        </div>
      </div>
      {s.limits.length > 0 && (
        <ul className="mt-8 space-y-1 font-mono text-xs text-g1">
          {s.limits.map((l) => (
            <li key={l}>Note: {l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
