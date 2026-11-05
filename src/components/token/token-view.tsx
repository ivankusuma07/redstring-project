"use client";

import { useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { StoredSnapshot } from "@/lib/types";
import type { HideKey } from "../graph/holder-graph";
import { AuditTab } from "./audit-tab";
import { HoldersTab } from "./holders-tab";
import { MapTab, type MapState } from "./map-tab";
import { MobileHeader, MobileOverview } from "./mobile-overview";
import { SealTab } from "./seal-tab";
import { ShareDialog } from "./share-dialog";
import { TokenHeader } from "./token-header";

export type Tab = "map" | "holders" | "audit" | "seal";
const TABS: [Tab, string, string][] = [
  ["map", "01 Map", "Overview"],
  ["holders", "02 Holders", "Holders"],
  ["audit", "03 Risk audit", "Audit"],
  ["seal", "04 Seal", "Seal"],
];

const MOBILE_Q = "(max-width: 767px)";
function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const q = window.matchMedia(MOBILE_Q);
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => window.matchMedia(MOBILE_Q).matches,
    () => false,
  );
}
const isTab = (t: string | null): t is Tab => !!t && TABS.some(([k]) => k === t);

export function TokenView({ rec, onRescan }: { rec: StoredSnapshot; onRescan: () => void }) {
  const s = rec.snapshot;
  const params = useSearchParams();
  const [tab, setTabState] = useState<Tab>(() => {
    const t = params.get("tab");
    return isTab(t) ? t : "map";
  });
  const [openedAt] = useState(() => Date.now());
  const [hide, setHide] = useState<Set<HideKey>>(new Set(["cex", "dex"]));
  const [selected, setSelected] = useState<string | null>(null);
  const [isolate, setIsolate] = useState<number | null>(null);
  const [share, setShare] = useState(false);
  const mobile = useIsMobile();

  const setTab = (t: Tab) => {
    setTabState(t);
    const u = new URL(window.location.href);
    if (t === "map") u.searchParams.delete("tab");
    else u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u);
  };

  const st: MapState = { hide, setHide, selected, setSelected, isolate, setIsolate };
  const canRescan = openedAt - Date.parse(s.createdAt) > 2 * 60_000;

  return (
    <main className="flex-1">
      {s.example && (
        <div className="border-b-2 border-ink bg-ink px-5 py-2 text-center font-mono text-xs text-white md:px-12">
          Example data. $EXAMPLE is an illustrative token, not a real asset. Paste any contract address to scan a real one.
        </div>
      )}
      {mobile ? (
        <MobileHeader s={s} />
      ) : (
        <div className="mx-auto max-w-[1600px] px-5 md:px-12">
          <TokenHeader rec={rec} compact={tab !== "map"} onRescan={onRescan} canRescan={canRescan} />
        </div>
      )}

      {!mobile && (
        <nav className="border-b-[6px] border-ink" aria-label="Token views">
          <div className="mx-auto flex max-w-[1600px] px-5 md:px-12" role="tablist">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`px-7 py-4 text-lg font-extrabold tracking-[-0.02em] ${tab === k ? "bg-ink text-white" : "hover:text-signal"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <div className="mx-auto max-w-[1600px]">
        {tab === "map" && (mobile ? <MobileOverview s={s} /> : <MapTab s={s} st={st} onShare={() => setShare(true)} />)}
        {tab === "holders" && (
          <HoldersTab
            s={s}
            onPick={(id) => {
              setSelected(id);
              setIsolate(null);
              if (!mobile) setTab("map");
            }}
          />
        )}
        {tab === "audit" && <AuditTab s={s} />}
        {tab === "seal" && <SealTab rec={rec} />}
        {mobile && tab !== "map" && <div className="h-24" />}
      </div>

      {mobile && (
        <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t-[6px] border-ink bg-white" aria-label="Token views">
          {TABS.map(([k, , m], i) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`py-3 text-center ${tab === k ? "bg-ink text-white" : ""}`} aria-current={tab === k ? "page" : undefined}>
              <span className="block font-mono text-[11px]">0{i + 1}</span>
              <span className="block font-extrabold">{m}</span>
            </button>
          ))}
        </nav>
      )}
      <ShareDialog s={s} open={share} onClose={() => setShare(false)} />
    </main>
  );
}
