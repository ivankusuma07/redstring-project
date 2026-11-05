"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MiniSplit } from "@/components/supply-bar";
import { CHAIN_LIST, CHAINS } from "@/lib/chains";
import { ago, int, levelLabel } from "@/lib/format";
import type { ChainKey, RiskLevel } from "@/lib/types";

export interface Row {
  chain: ChainKey;
  address: string;
  href: string;
  symbol: string;
  score: number;
  level: RiskLevel;
  largest: number;
  linked: number;
  exempt: number;
  holders: number | null;
  scannedAt: string;
  category: string | null;
  example: boolean;
}

type Sort = "newest" | "score-asc" | "score-desc" | "largest";
const CATS = ["Meme", "DeFi", "Infra", "Gaming"];

export function ExploreTable({ rows, pinned }: { rows: Row[]; pinned?: React.ReactNode }) {
  const [chain, setChain] = useState<ChainKey | "all">("all");
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [limit, setLimit] = useState(25);

  const view = useMemo(() => {
    let r = rows.filter((x) => (chain === "all" || x.chain === chain) && (!cat || x.category === cat));
    r = [...r].sort((a, b) =>
      sort === "newest" ? b.scannedAt.localeCompare(a.scannedAt) : sort === "score-asc" ? a.score - b.score : sort === "score-desc" ? b.score - a.score : b.largest - a.largest,
    );
    return r;
  }, [rows, chain, cat, sort]);

  const seg = (k: ChainKey | "all", label: string, first = false) => (
    <button
      key={k}
      type="button"
      onClick={() => setChain(k)}
      aria-pressed={chain === k}
      className={`h-[52px] border-2 border-ink px-5 font-bold ${first ? "" : "-ml-0.5"} ${chain === k ? "bg-ink text-white" : "hover:bg-[#f3f3f3]"}`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pb-8 md:px-12">
        <div className="flex flex-wrap">
          {seg("all", "All chains", true)}
          {CHAIN_LIST.map((c) => seg(c.key, c.name))}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(cat === c ? null : c)}
              aria-pressed={cat === c}
              className={`h-[52px] border-2 border-ink px-4 font-bold ${cat === c ? "bg-ink text-white" : "hover:bg-[#f3f3f3]"}`}
            >
              {c}
            </button>
          ))}
          <label className="flex h-[52px] items-center border-2 border-ink px-4">
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-transparent pr-2 font-mono text-sm outline-none">
              <option value="newest">Newest scan</option>
              <option value="score-asc">Riskiest first</option>
              <option value="score-desc">Safest first</option>
              <option value="largest">Largest group</option>
            </select>
          </label>
        </div>
      </div>
      <div className="border-t-[6px] border-ink">{pinned}</div>
      <div className="overflow-x-auto px-5 md:px-12">
        <table className="w-full min-w-[980px] border-collapse text-left">
          <thead className="font-mono text-xs">
            <tr className="border-b-2 border-ink">
              <th className="px-3 py-5 font-bold">Token</th>
              <th className="py-5 font-bold">Chain</th>
              <th className="py-5 font-bold">Category</th>
              <th className="py-5 text-right font-bold">Score</th>
              <th className="py-5 text-right font-bold">Largest group</th>
              <th className="py-5 pl-7 font-bold">Supply split</th>
              <th className="py-5 text-right font-bold">Holders</th>
              <th className="px-3 py-5 text-right font-bold">Scanned</th>
            </tr>
          </thead>
          <tbody>
            {view.slice(0, limit).map((r) => (
              <tr key={`${r.chain}:${r.address}`} className="border-b border-ink hover:bg-[#f7f7f7]">
                <td className="px-3 py-4">
                  <Link href={r.href} className="text-xl font-extrabold tracking-[-0.02em] hover:text-signal">
                    ${r.symbol}
                  </Link>
                  {r.example && <span className="ml-2 border border-ink px-1.5 py-0.5 font-mono text-[10px]">EXAMPLE</span>}
                </td>
                <td className="py-4 font-mono text-sm">{CHAINS[r.chain].short}</td>
                <td className="py-4 text-[17px]">{r.category ?? "—"}</td>
                <td className="py-4 text-right font-mono text-sm">
                  <b className={r.level === "HIGH" ? "text-signal" : ""}>{r.score}</b> {levelLabel(r.level)}
                </td>
                <td className={`py-4 text-right font-mono text-sm ${r.largest >= 5 ? "text-signal" : ""}`}>{r.largest.toFixed(1)}%</td>
                <td className="py-4 pl-7">
                  <MiniSplit linked={r.linked} exempt={r.exempt} />
                </td>
                <td className="py-4 text-right font-mono text-sm">{int(r.holders)}</td>
                <td className="px-3 py-4 text-right font-mono text-sm">{r.example ? "example" : ago(r.scannedAt)}</td>
              </tr>
            ))}
            {!view.length && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-lg">
                  Nothing scanned here yet. Paste a contract address in the search bar to map one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-6 font-mono text-sm md:px-12">
        <div className="flex flex-wrap gap-6">
          <span className="flex items-center gap-2">
            <i className="block size-4 bg-signal" /> Linked groups
          </span>
          <span className="flex items-center gap-2">
            <i className="block size-4 bg-g2" /> Exempt (CEX / DEX / burn)
          </span>
          <span className="flex items-center gap-2">
            <i className="block size-4 border-2 border-ink" /> Free float
          </span>
        </div>
        {view.length > limit && (
          <button type="button" onClick={() => setLimit((l) => l + 25)} className="underline underline-offset-4">
            Load more →
          </button>
        )}
      </div>
    </>
  );
}
