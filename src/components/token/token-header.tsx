"use client";

import { ArrowUpRight, Check, Copy, RotateCw } from "lucide-react";
import { useState } from "react";
import { CHAINS, tokenUrl } from "@/lib/chains";
import { ago, int, levelLabel, shortAddr, usd } from "@/lib/format";
import type { StoredSnapshot } from "@/lib/types";

export function CopyButton({ value, label = "Copy address" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        await navigator.clipboard?.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="inline-grid size-5 place-items-center align-middle hover:text-signal"
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Stat({ label, value, sub, tip }: { label: string; value: string; sub?: React.ReactNode; tip: string }) {
  return (
    <div title={tip}>
      <div className="font-mono text-xs">{label}</div>
      <div className="mt-1.5 text-[28px] leading-none font-extrabold tracking-[-0.03em] xl:text-[34px]">{value}</div>
      {sub ? <div className="mt-1 font-mono text-[11px]">{sub}</div> : null}
    </div>
  );
}

export function ScoreBlock({ value, level, size = "lg" }: { value: number; level: "LOW" | "MODERATE" | "HIGH"; size?: "lg" | "sm" }) {
  return (
    <div className="flex items-end gap-2" title="Decentralization score, 0–100. See Risk audit for how it is built.">
      <span className={`display ${level === "HIGH" ? "text-signal" : ""} ${size === "lg" ? "text-[96px] xl:text-[120px]" : "text-[56px] md:text-[64px]"}`}>{value}</span>
      <span className="mb-1.5 font-mono text-sm leading-tight">
        /100
        <br />
        <b className={level === "HIGH" ? "text-signal" : ""}>{levelLabel(level)}</b>
      </span>
    </div>
  );
}

export function TokenHeader({
  rec,
  compact,
  onRescan,
  canRescan,
}: {
  rec: StoredSnapshot;
  compact: boolean;
  onRescan: () => void;
  canRescan: boolean;
}) {
  const s = rec.snapshot;
  const chain = CHAINS[s.chain];
  const m = s.market;
  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[13px]">
      <span>{chain.name}</span>
      <span>·</span>
      <span>{s.example ? shortAddr(s.token.address) : shortAddr(s.token.address)}</span>
      {!s.example && (
        <>
          <CopyButton value={s.token.address} />
          <a href={tokenUrl(s.chain, s.token.address)} target="_blank" rel="noreferrer" aria-label="Open in explorer" className="hover:text-signal">
            <ArrowUpRight className="inline size-3.5" />
          </a>
        </>
      )}
      {!compact && (
        <>
          <span>·</span>
          <span>Scanned at block {s.blockNumber.toLocaleString("en-US")}</span>
          {!s.example && <span className="text-g1">({ago(s.createdAt)} ago)</span>}
          {!s.example && (
            <button
              type="button"
              onClick={onRescan}
              disabled={!canRescan}
              title={canRescan ? "Scan again now" : "Scanned under 2 minutes ago"}
              className="ml-2 inline-flex items-center gap-1 border border-ink px-2 py-0.5 hover:bg-ink hover:text-white disabled:border-g3 disabled:text-g2 disabled:hover:bg-transparent"
            >
              <RotateCw className="size-3" /> Rescan
            </button>
          )}
        </>
      )}
    </div>
  );

  if (compact)
    return (
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <h1 className="display text-[44px] md:text-[64px]">${s.token.symbol}</h1>
          <div className="mb-1.5">{meta}</div>
        </div>
        <ScoreBlock value={s.score.value} level={s.score.level} size="sm" />
      </div>
    );

  return (
    <div className="grid grid-cols-12 items-end gap-6 pt-8 pb-7">
      <div className="col-span-12 lg:col-span-5">
        {meta}
        <div className="mt-2 flex items-center gap-4">
          {s.token.logo && <img src={s.token.logo} alt="" className="size-14 border-2 border-ink object-cover md:size-16" />}
          <h1
            className={`display min-w-0 truncate ${s.token.symbol.length > 8 ? "text-[44px] md:text-[56px] xl:text-[64px]" : s.token.symbol.length > 6 ? "text-[52px] md:text-[64px] xl:text-[80px]" : "text-[56px] md:text-[80px] xl:text-[96px]"}`}
            title={`$${s.token.symbol}`}
          >
            ${s.token.symbol}
          </h1>
        </div>
        <p className="mt-2 text-xl md:text-2xl">{s.token.name}</p>
      </div>
      <div className="col-span-12 border-t-2 border-ink pt-4 md:col-span-9 lg:col-span-5">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Stat
            label="Price"
            value={usd(m?.priceUsd)}
            tip="Price of the most liquid pair on DexScreener."
            sub={
              m?.change24h != null ? (
                <span className={m.change24h < 0 ? "text-signal" : ""}>
                  {m.change24h > 0 ? "+" : ""}
                  {m.change24h.toFixed(1)}% 24h
                </span>
              ) : undefined
            }
          />
          <Stat label="Market cap" value={usd(m?.marketCap)} tip="DexScreener market cap (or FDV when circulating supply is unknown)." />
          <Stat label="Liquidity" value={usd(m?.liquidityUsd)} tip="Sum of USD liquidity across all DEX pairs DexScreener lists for this token." />
          <Stat label="Holders" value={int(s.token.holderCount)} tip="Addresses with a non-zero balance at the scanned block." />
        </div>
      </div>
      <div className="col-span-12 flex md:col-span-3 md:justify-end lg:col-span-2">
        <ScoreBlock value={s.score.value} level={s.score.level} />
      </div>
    </div>
  );
}
