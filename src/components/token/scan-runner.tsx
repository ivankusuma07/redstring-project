"use client";

import { API_BASE } from "@/lib/api-base";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CHAIN_LIST, CHAINS } from "@/lib/chains";
import { shortAddr } from "@/lib/format";
import type { ChainKey, ScanEvent, ScanStage, StoredSnapshot } from "@/lib/types";
import { Crow } from "../brand";
import { TokenView } from "./token-view";

type StageState = { status: "waiting" | "running" | "done" | "skipped"; detail?: string; progress?: number };
const STAGES: [ScanStage, string][] = [
  ["holders", "Holders fetched"],
  ["labels", "Labels applied"],
  ["links", "Linking wallets"],
  ["score", "Scoring"],
  ["seal", "Sealing on-chain"],
];
const initialStages = () => Object.fromEntries(STAGES.map(([k]) => [k, { status: "waiting" }])) as Record<ScanStage, StageState>;

export function ScanLoading({ stages = initialStages(), queued = null }: { stages?: Record<ScanStage, StageState>; queued?: number | null }) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-16" aria-live="polite" data-testid="scan-loading">
      <div className="font-mono text-xs">01 · Loading</div>
      <Crow className="mt-10 w-44" />
      <h1 className="display mt-8 text-[56px]">
        Pulling the
        <br />
        string…
      </h1>
      {queued != null && (
        <p className="mt-6 font-mono text-sm" role="status">
          In the queue · {queued === 0 ? "starting next" : `${queued} scan${queued === 1 ? "" : "s"} ahead`}
        </p>
      )}
      <ul className="mt-8 border-t-2 border-ink">
        {STAGES.map(([k, label]) => {
          const st = stages[k];
          const active = st.status === "running";
          return (
            <li key={k} className={`border-b border-ink py-3.5 ${st.status === "waiting" ? "text-g1" : ""}`}>
              <div className="flex items-baseline justify-between">
                <span className={`text-lg ${active ? "font-extrabold" : ""}`}>{label}</span>
                <span className="font-mono text-sm">
                  {st.status === "done"
                    ? `${st.detail ?? ""} ✓`
                    : st.status === "skipped"
                      ? (st.detail ?? "skipped")
                      : active
                        ? st.progress != null
                          ? `${Math.round(st.progress * 100)}%`
                          : "…"
                        : "waiting"}
                </span>
              </div>
              {active && st.progress != null && (
                <div className="mt-2 h-4 border-2 border-ink">
                  <div className="h-full bg-signal transition-[width] duration-300" style={{ width: `${Math.round(st.progress * 100)}%` }} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function NotFoundToken({ chain, address, message }: { chain: ChainKey; address: string; message?: string }) {
  const others = CHAIN_LIST.filter((c) => c.key !== chain);
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-16" data-testid="token-not-found">
      <div className="font-mono text-xs">02 · Token not found</div>
      <Crow className="mt-10 w-44" dropped />
      <h1 className="display mt-8 text-[52px]">No token at this address.</h1>
      <p className="mt-6 text-xl leading-snug">
        We couldn&apos;t find <code className="font-mono text-lg">{shortAddr(address)}</code> on {CHAINS[chain].name}. {message ?? "It may be on another chain, or the address is incomplete."}
      </p>
      <div className="mt-12 space-y-3">
        {others.map((c, i) => (
          <Link
            key={c.key}
            href={`/${c.key}/${address}`}
            className={`flex h-14 items-center justify-center font-extrabold ${i === 0 ? "bg-ink text-white hover:bg-signal" : "border-2 border-ink hover:bg-ink hover:text-white"}`}
          >
            Try {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ScanFailed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[560px] px-5 py-16" role="alert">
      <div className="font-mono text-xs">Scan stopped</div>
      <Crow className="mt-10 w-44" dropped />
      <h1 className="display mt-8 text-[52px]">The string snapped.</h1>
      <p className="mt-6 text-xl leading-snug">{message}</p>
      <div className="mt-12 space-y-3">
        <button type="button" onClick={onRetry} className="h-14 w-full bg-ink font-extrabold text-white hover:bg-signal">
          Try again
        </button>
        <Link href="/explore" className="flex h-14 items-center justify-center border-2 border-ink font-extrabold hover:bg-ink hover:text-white">
          Explore tokens
        </Link>
      </div>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function ScanRunner({ chain, address, initial }: { chain: ChainKey; address: string; initial: StoredSnapshot | null }) {
  const [rec, setRec] = useState<StoredSnapshot | null>(initial);
  const [stages, setStages] = useState(initialStages);
  const [queued, setQueued] = useState<number | null>(null);
  const [reading, setReading] = useState<{ progress?: number } | null>(null);
  const [error, setError] = useState<Extract<ScanEvent, { type: "error" }> | null>(null);
  const running = useRef(false);

  /** One request: returns true once the scan has finished (done or error), false if the stream dropped. */
  const attempt = useCallback(
    async (force: boolean): Promise<boolean> => {
      const res = await fetch(`${API_BASE}/api/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chain, address, force }) });
      if (res.status === 400) {
        setError(await res.json());
        return true;
      }
      if (!res.body) return false;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let prelim = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue; // heartbeat
          const ev = JSON.parse(line) as ScanEvent;
          if (ev.type === "queued") setQueued(ev.position);
          else if (ev.type === "stage") {
            setQueued(null);
            setStages((p) => ({ ...p, [ev.stage]: { status: ev.status, detail: ev.detail ?? p[ev.stage].detail, progress: ev.progress } }));
            if (prelim && ev.stage === "holders" && ev.status === "running") setReading({ progress: ev.progress });
          } else if (ev.type === "preliminary") {
            prelim = true;
            setRec(ev.data);
            setReading({});
          } else if (ev.type === "done") {
            setRec(ev.data);
            setReading(null);
            return true;
          } else {
            setReading(null);
            setError(ev);
            return true;
          }
        }
      }
    },
    [chain, address],
  );

  const scan = useCallback(
    async (force: boolean) => {
      if (running.current) return;
      running.current = true;
      try {
        // Scans run as server-side jobs: if the connection drops, reconnecting follows the same job.
        for (let tries = 0; ; tries++) {
          let finished = false;
          try {
            finished = await attempt(force && tries === 0);
          } catch {
            // network error: retry below
          }
          if (finished) return;
          if (tries >= 5) {
            setReading(null);
            setError({ type: "error", code: "failed", message: "Lost the connection while scanning. Try again." });
            return;
          }
          await sleep(2_000 * (tries + 1));
        }
      } finally {
        running.current = false;
      }
    },
    [attempt],
  );

  useEffect(() => {
    // Starts a streaming fetch; state updates happen asynchronously as events arrive.
    // A preliminary snapshot means the history is still (or should keep) being read: follow that job.
    if (!initial || initial.seal.status === "preliminary") scan(false);
  }, [initial, scan]);

  const restart = (force: boolean) => {
    if (running.current) return;
    setError(null);
    setStages(initialStages());
    setQueued(null);
    if (rec?.seal.status !== "preliminary") setRec(null);
    scan(force);
  };

  if (rec) return <TokenView key={rec.id + rec.snapshot.createdAt} rec={rec} onRescan={() => restart(true)} reading={reading} />;
  if (error?.code === "not_found") return <NotFoundToken chain={chain} address={address} />;
  if (error) return <ScanFailed message={error.message} onRetry={() => restart(false)} />;
  return <ScanLoading stages={stages} queued={queued} />;
}
