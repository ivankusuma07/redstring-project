"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/types";

export function ShareDialog({ s, open, onClose }: { s: Snapshot; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const path = `/${s.chain}/${s.example ? "example" : s.token.address}`;
  const url = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  const img = `${path}/opengraph-image`;
  const text = `$${s.token.symbol}: ${s.score.value}/100. Largest linked group holds ${(s.clusters[0]?.pct ?? 0).toFixed(1)}% of supply. Pull the string.`;
  const via = "RedstringRH";

  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(760px,94vw)] border-[3px] border-ink bg-white p-0 backdrop:bg-ink/60">
      <div className="flex items-center justify-between border-b-2 border-ink px-6 py-4">
        <h2 className="text-2xl font-extrabold tracking-[-0.02em]">Share card</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-10 place-items-center border-2 border-ink hover:bg-ink hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      <div className="p-6">
        {open && <img src={img} alt={`Share card for $${s.token.symbol}`} className="aspect-[1200/630] w-full border-2 border-ink" />}
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&via=${via}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-12 items-center bg-ink px-6 font-extrabold text-white hover:bg-signal"
          >
            Post on X
          </a>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard?.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            className="h-12 border-2 border-ink px-6 font-extrabold hover:bg-ink hover:text-white"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a href={img} download={`${s.token.symbol.toLowerCase()}-redstring.png`} className="inline-flex h-12 items-center border-2 border-ink px-6 font-extrabold hover:bg-ink hover:text-white">
            Download PNG
          </a>
        </div>
      </div>
    </dialog>
  );
}
