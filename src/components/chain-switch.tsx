"use client";

import { Check, ChevronDown } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CHAIN_LIST, CHAINS } from "@/lib/chains";
import { CHAIN_COLOR, FEATURED_BY_CHAIN } from "@/lib/featured-chains";
import type { ChainKey } from "@/lib/types";
import { useDefaultChain } from "./search";

function Swatch({ chain }: { chain: ChainKey }) {
  return <span aria-hidden className="size-3 shrink-0 border border-ink" style={{ background: CHAIN_COLOR[chain] }} />;
}

/**
 * Network picker beside the logo.
 * On a map page it shows that token's chain, and picking another chain opens that chain's featured map.
 * Elsewhere it sets the default chain used when you paste an address into search.
 */
export function ChainSwitch() {
  const router = useRouter();
  const params = useParams<{ chain?: string }>();
  const pageChain = params.chain && params.chain in CHAINS ? (params.chain as ChainKey) : null;
  const [defaultChain, setDefaultChain] = useDefaultChain();
  const current = pageChain ?? defaultChain;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const pick = (c: ChainKey) => {
    setOpen(false);
    setDefaultChain(c);
    if (pageChain && c !== pageChain) router.push(`/${c}/${FEATURED_BY_CHAIN[c]}`);
  };

  const toggle = () => {
    setActive(Math.max(0, CHAIN_LIST.findIndex((c) => c.key === current)));
    setOpen((o) => !o);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % CHAIN_LIST.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + CHAIN_LIST.length) % CHAIN_LIST.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(CHAIN_LIST[active].key);
    }
  };

  return (
    <div ref={root} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Network: ${CHAINS[current].name}`}
        data-testid="chain-switch"
        className={`flex h-12 items-center gap-2.5 border-2 border-ink px-3 font-mono text-sm md:h-[52px] md:px-4 ${open ? "bg-ink text-white" : "bg-white hover:bg-[#f3f3f3]"}`}
      >
        <Swatch chain={current} />
        <span className="hidden font-bold sm:inline">{CHAINS[current].name}</span>
        <span className="font-bold sm:hidden">{CHAINS[current].short}</span>
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2.5} />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1.5 w-[260px] border-2 border-ink bg-white shadow-[4px_4px_0_#0a0a0a]">
          <div className="border-b border-ink px-4 py-2.5 font-mono text-[11px] font-bold tracking-[0.08em] text-g1">
            {pageChain ? "SWITCH NETWORK" : "DEFAULT NETWORK"}
          </div>
          <ul id={listId} role="listbox" aria-label="Network">
            {CHAIN_LIST.map((c, i) => {
              const selected = c.key === current;
              return (
                <li key={c.key} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(c.key)}
                    data-testid={`chain-option-${c.key}`}
                    className={`flex w-full items-center gap-3 border-b border-g3 px-4 py-3 text-left last:border-b-0 ${i === active ? "bg-ink text-white" : ""}`}
                  >
                    <Swatch chain={c.key} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-extrabold">{c.name}</span>
                      <span className={`block font-mono text-[11px] ${i === active ? "text-white/70" : "text-g1"}`}>EVM · chain {c.id}</span>
                    </span>
                    {selected && <Check className="size-4 text-signal" strokeWidth={3} />}
                  </button>
                </li>
              );
            })}
          </ul>
          {pageChain && <p className="border-t border-ink px-4 py-2.5 font-mono text-[11px] leading-snug text-g1">Opens a featured map on that network. Paste an address to map any token.</p>}
        </div>
      )}
    </div>
  );
}

/** Static stand-in while the route params resolve. */
export function ChainSwitchFallback() {
  return <div aria-hidden className="h-12 w-[150px] shrink-0 border-2 border-ink md:h-[52px] md:w-[190px]" />;
}
