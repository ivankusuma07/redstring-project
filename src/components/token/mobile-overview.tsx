"use client";

import { X } from "lucide-react";
import { useState } from "react";
import { CHAINS } from "@/lib/chains";
import { clusterMobileShort } from "@/lib/explain";
import { int, shortAddr, usd } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { HolderGraph } from "../graph/holder-graph";
import { SupplyBar } from "../supply-bar";
import { ScoreBlock } from "./token-header";

export function MobileHeader({ s }: { s: Snapshot }) {
  return (
    <div className="px-5 pt-5">
      <div className="font-mono text-xs">
        {CHAINS[s.chain].short} · {shortAddr(s.token.address)}
      </div>
      <div className="flex items-end justify-between gap-3">
        <h1 className={`display min-w-0 truncate ${s.token.symbol.length > 6 ? "text-[34px]" : "text-[44px]"}`}>${s.token.symbol}</h1>
        <ScoreBlock value={s.score.value} level={s.score.level} size="sm" />
      </div>
    </div>
  );
}

export function MobileOverview({ s }: { s: Snapshot }) {
  const [mapOpen, setMapOpen] = useState(false);
  const m = s.market;
  return (
    <div className="px-5 pb-28">
      <dl className="mt-3 grid grid-cols-3 border-y-2 border-ink py-3">
        {[
          ["Mcap", usd(m?.marketCap)],
          ["Liquidity", usd(m?.liquidityUsd)],
          ["Holders", int(s.token.holderCount)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-xs">{k}</dt>
            <dd className="text-xl font-extrabold">{v}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mt-6 text-2xl font-extrabold tracking-[-0.02em]">Supply split</h2>
      <div className="mt-3">
        <SupplyBar segments={s.supply.segments} showLegend={false} height="h-8" />
        <div className="mt-2 flex justify-between font-mono text-xs">
          <span>
            <span className="text-signal">{s.supply.linked.toFixed(1)}%</span> linked
          </span>
          <span>
            <b>{s.supply.exempt.toFixed(1)}%</b> exempt
          </span>
          <span>
            <b>{s.supply.free.toFixed(1)}%</b> free
          </span>
        </div>
      </div>
      <div className="relative mt-6 h-44 border-2 border-ink">
        <HolderGraph snapshot={s} variant="preview" controls={false} minimap={false} legend={false} />
        <button type="button" onClick={() => setMapOpen(true)} className="absolute right-3 bottom-3 bg-ink px-4 py-2.5 font-extrabold text-white">
          Open map →
        </button>
      </div>
      <h2 className="mt-7 text-2xl font-extrabold tracking-[-0.02em]">Linked groups</h2>
      <ul className="mt-3 border-t-2 border-ink">
        {s.clusters.slice(0, 6).map((c, i) => (
          <li key={c.id} className="flex items-baseline justify-between gap-3 border-b-2 border-ink py-4">
            <span>
              <b className="text-xl font-extrabold">Group {c.id}</b>{" "}
              <span className="font-mono text-xs">
                {c.size} wallets · {clusterMobileShort(c)}
              </span>
            </span>
            <b className={`text-xl font-extrabold ${i === 0 ? "text-signal" : ""}`}>{c.pct.toFixed(1)}%</b>
          </li>
        ))}
        {!s.clusters.length && <li className="py-4 text-sm">No linked groups. No line, no link.</li>}
      </ul>
      {mapOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b-2 border-ink px-5 py-3">
            <span className="text-xl font-extrabold">${s.token.symbol} map</span>
            <button type="button" aria-label="Close map" onClick={() => setMapOpen(false)} className="grid size-11 place-items-center border-2 border-ink">
              <X className="size-5" />
            </button>
          </div>
          <div className="flex-1">
            {/* view-only on mobile: pan + pinch zoom, tap to highlight */}
            <HolderGraph snapshot={s} variant="preview" controls minimap={false} legend={false} />
          </div>
          <p className="border-t-2 border-ink px-5 py-3 font-mono text-[11px]">Pinch to zoom. Red line = link, dashed = shared funder, grey ring = exempt.</p>
        </div>
      )}
    </div>
  );
}
