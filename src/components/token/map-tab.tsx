"use client";

import { ArrowUpRight, Check } from "lucide-react";
import { addressUrl } from "@/lib/chains";
import { clusterShort, firstHeldLabel, groupLabel, holderLabel, whyLinked } from "@/lib/explain";
import { amount, shortAddr } from "@/lib/format";
import type { Snapshot } from "@/lib/types";
import { HolderGraph, type HideKey } from "../graph/holder-graph";
import { SupplyBar } from "../supply-bar";
import { CopyButton } from "./token-header";

export interface MapState {
  hide: Set<HideKey>;
  setHide: (h: Set<HideKey>) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  isolate: number | null;
  setIsolate: (id: number | null) => void;
}

const HIDE_OPTS: [HideKey, string][] = [
  ["cex", "Exchanges (CEX)"],
  ["dex", "DEX pools"],
  ["burn", "Burn addresses"],
  ["contract", "Contracts"],
];

export function HideToggles({ hide, setHide }: Pick<MapState, "hide" | "setHide">) {
  return (
    <fieldset>
      <legend className="mb-3 font-mono text-xs font-bold">Hide on map</legend>
      {HIDE_OPTS.map(([k, label]) => (
        <label key={k} className="flex cursor-pointer items-center gap-3 py-2 text-[17px]">
          <span className="relative grid size-6 shrink-0 place-items-center">
          <input
            type="checkbox"
            checked={hide.has(k)}
            onChange={(e) => {
              const n = new Set(hide);
              if (e.target.checked) n.add(k);
              else n.delete(k);
              setHide(n);
            }}
            className="peer absolute inset-0 size-6 cursor-pointer appearance-none border-2 border-ink bg-white checked:bg-ink"
          />
          <Check className="pointer-events-none relative size-4 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3.5} aria-hidden />
          </span>
          {label}
        </label>
      ))}
    </fieldset>
  );
}

export function GroupList({ s, st, max = 12 }: { s: Snapshot; st: MapState; max?: number }) {
  if (!s.clusters.length)
    return <p className="border-t-2 border-ink py-5 text-sm">No linked groups among the top {s.nodes.length} holders. No line, no link.</p>;
  return (
    <ul className="border-t-2 border-ink">
      {s.clusters.slice(0, max).map((c, i) => (
        <li key={c.id} className="border-b-2 border-ink">
          <button
            type="button"
            onClick={() => st.setIsolate(st.isolate === c.id ? null : c.id)}
            className={`grid w-full grid-cols-[1fr_auto] gap-x-3 py-4 text-left ${st.isolate === c.id ? "bg-[#f4f4f4]" : "hover:bg-[#f7f7f7]"}`}
            aria-pressed={st.isolate === c.id}
          >
            <span className="text-xl font-extrabold tracking-[-0.02em] whitespace-nowrap">Group {c.id}</span>
            <span className={`text-xl font-extrabold ${i === 0 ? "text-signal" : ""}`}>{c.pct.toFixed(1)}%</span>
            <span className="font-mono text-xs">{c.size} wallets</span>
            <span className="max-w-24 text-right font-mono text-xs">{clusterShort(c)}</span>
          </button>
        </li>
      ))}
      {s.clusters.length > max && <li className="py-3 font-mono text-xs text-g1">+ {s.clusters.length - max} smaller groups (see Holders)</li>}
    </ul>
  );
}

export function NodePanel({ s, st, onShare }: { s: Snapshot; st: MapState; onShare: () => void }) {
  const n = s.nodes.find((x) => x.id === st.selected);
  if (!n)
    return (
      <div>
        <div className="font-mono text-xs font-bold">Nothing selected</div>
        <p className="mt-4 text-lg leading-snug">Click a dot to see who it is and why it&apos;s linked.</p>
        <p className="mt-4 font-mono text-xs leading-relaxed text-g1">
          Dot size is balance. Red lines are token transfers, dashed red lines a shared gas funder, black lines a buy in the launch block. Grey rings are exchanges, pools and burn
          addresses: they never link anyone.
        </p>
        <button type="button" onClick={onShare} className="mt-8 h-14 w-full border-2 border-ink font-extrabold hover:bg-ink hover:text-white">
          Share card
        </button>
      </div>
    );
  const reasons = whyLinked(n, s);
  const dash = { transfer: "border-t-[3px] border-signal", funder: "border-t-[3px] border-dashed border-signal", "same-block": "border-t-[3px] border-ink", deployer: "border-t-[3px] border-ink" };
  return (
    <div data-testid="node-panel">
      <div className={`font-mono text-xs font-bold ${n.cluster != null ? "text-signal" : ""}`}>Selected · {groupLabel(n)}</div>
      <div className="mt-5 flex items-center gap-2 border-b-2 border-ink pb-4">
        <span className="font-mono text-2xl">{shortAddr(n.id)}</span>
        <CopyButton value={n.id} />
        {!s.example && (
          <a href={addressUrl(s.chain, n.id)} target="_blank" rel="noreferrer" aria-label="Open address in explorer" className="hover:text-signal">
            <ArrowUpRight className="size-4" />
          </a>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 border-b border-ink py-4">
        <div>
          <dt className="font-mono text-xs">Balance</dt>
          <dd className="mt-1 text-2xl font-extrabold" title={`${amount(n.amount)} ${s.token.symbol}`}>
            {n.pct.toFixed(n.pct >= 1 ? 1 : 2)}%
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs">First buy</dt>
          <dd className="mt-1 text-2xl leading-tight font-extrabold">{firstHeldLabel(n, s)}</dd>
        </div>
      </dl>
      <dl className="grid grid-cols-2 gap-x-4 border-b border-ink py-4">
        <div>
          <dt className="font-mono text-xs">Gas funder</dt>
          <dd className="mt-1 font-mono text-lg">{n.funder ? shortAddr(n.funder) : "—"}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs">Label · rank</dt>
          <dd className="mt-1 text-lg font-extrabold">
            {holderLabel(n)} · #{n.rank}
          </dd>
        </div>
      </dl>
      <h3 className="mt-6 text-xl font-extrabold tracking-[-0.02em]">Why it&apos;s linked</h3>
      {reasons.length ? (
        <ul className="mt-3 space-y-3">
          {reasons.map((r, i) => (
            <li key={i} className="grid grid-cols-[28px_1fr] items-start gap-3 text-[17px] leading-snug">
              <i className={`mt-3 block w-6 ${dash[r.kind]}`} />
              {r.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[17px]">{n.exempt ? "Exempt wallets never link anyone." : "No line, no link. Nothing ties this wallet to another top holder."}</p>
      )}
      <div className="mt-8 space-y-3">
        {n.cluster != null && (
          <button
            type="button"
            onClick={() => st.setIsolate(st.isolate === n.cluster ? null : n.cluster)}
            className="h-14 w-full bg-ink font-extrabold text-white hover:bg-signal"
          >
            {st.isolate === n.cluster ? "Show all groups" : `Isolate Group ${n.cluster}`}
          </button>
        )}
        <button type="button" onClick={onShare} className="h-14 w-full border-2 border-ink font-extrabold hover:bg-ink hover:text-white">
          Share card
        </button>
      </div>
    </div>
  );
}

export function MapTab({ s, st, onShare }: { s: Snapshot; st: MapState; onShare: () => void }) {
  return (
    <>
      <section className="border-b-2 border-ink px-5 py-6 md:px-12">
        <SupplyBar segments={s.supply.segments} />
      </section>
      <section className="grid min-h-[760px] grid-cols-12 border-b-2 border-ink">
        <aside className="col-span-12 border-ink px-5 py-7 md:col-span-3 md:border-r-2 md:px-12 md:pr-7 xl:col-span-3 2xl:col-span-2">
          <h2 className="mb-5 text-3xl font-extrabold tracking-[-0.03em]">Linked groups</h2>
          <GroupList s={s} st={st} />
          <div className="mt-6">
            <HideToggles hide={st.hide} setHide={st.setHide} />
          </div>
        </aside>
        <div className="col-span-12 h-[640px] md:col-span-9 md:h-auto xl:col-span-6 2xl:col-span-7">
          <HolderGraph snapshot={s} hide={st.hide} selected={st.selected} onSelect={st.setSelected} isolate={st.isolate} />
        </div>
        <aside className="col-span-12 border-t-2 border-ink px-5 py-7 md:px-12 xl:col-span-3 xl:border-t-0 xl:border-l-2 xl:pl-7">
          <NodePanel s={s} st={st} onShare={onShare} />
        </aside>
      </section>
    </>
  );
}
