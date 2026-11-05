"use client";

import { Search as SearchIcon, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CHAIN_LIST, CHAINS } from "@/lib/chains";
import { isAddress, shortAddr, usd } from "@/lib/format";
import type { ChainKey } from "@/lib/types";

interface Hit {
  chain: ChainKey;
  address: string;
  symbol: string;
  name: string;
  liquidityUsd: number;
}

const CHAIN_KEY = "rs.chain";

const chainListeners = new Set<() => void>();
function readChain(): ChainKey {
  const v = localStorage.getItem(CHAIN_KEY);
  return v && v in CHAINS ? (v as ChainKey) : "robinhood";
}

export function useDefaultChain(): [ChainKey, (c: ChainKey) => void] {
  const chain = useSyncExternalStore(
    (cb) => {
      chainListeners.add(cb);
      return () => chainListeners.delete(cb);
    },
    readChain,
    () => "robinhood" as ChainKey,
  );
  return [
    chain,
    (c) => {
      localStorage.setItem(CHAIN_KEY, c);
      chainListeners.forEach((l) => l());
    },
  ];
}

function useHits(q: string, chain: ChainKey): { hits: Hit[]; loading: boolean } {
  const v = q.trim();
  const term = v.replace(/^\$/, "");
  const addressHits = useMemo(() => {
    if (!isAddress(v)) return null;
    const order = [chain, ...CHAIN_LIST.map((c) => c.key).filter((k) => k !== chain)];
    return order.map((c) => ({ chain: c, address: v.toLowerCase(), symbol: "", name: `Scan on ${CHAINS[c].name}`, liquidityUsd: 0 }));
  }, [v, chain]);
  const [fetched, setFetched] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] });
  useEffect(() => {
    if (isAddress(v) || term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(v)}`, { signal: ctrl.signal });
        const j = (await r.json()) as { hits: Hit[] };
        setFetched({ q: v, hits: j.hits });
      } catch {}
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [v, term]);
  if (addressHits) return { hits: addressHits, loading: false };
  if (term.length < 2) return { hits: [], loading: false };
  return fetched.q === v ? { hits: fetched.hits, loading: false } : { hits: [], loading: true };
}

function Results({ hits, active, onPick, loading, q, listId }: { hits: Hit[]; active: number; onPick: (h: Hit) => void; loading: boolean; q: string; listId: string }) {
  if (!q.trim()) return null;
  return (
    <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-50 -mt-0.5 max-h-96 overflow-auto border-2 border-ink bg-white">
      {hits.map((h, i) => (
        <li key={`${h.chain}:${h.address}`} role="option" aria-selected={i === active}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(h)}
            className={`flex w-full items-baseline justify-between gap-4 border-b border-g3 px-4 py-3 text-left last:border-b-0 ${i === active ? "bg-ink text-white" : "hover:bg-[#f3f3f3]"}`}
          >
            <span className="min-w-0 truncate">
              {h.symbol ? <span className="font-extrabold">${h.symbol}</span> : null} <span className={h.symbol ? "text-sm" : "font-bold"}>{h.name}</span>
            </span>
            <span className="shrink-0 font-mono text-xs">
              {CHAINS[h.chain].short} · {h.address === "example" ? "example" : shortAddr(h.address)}
              {h.liquidityUsd ? ` · ${usd(h.liquidityUsd)} liq` : ""}
            </span>
          </button>
        </li>
      ))}
      {!hits.length && (
        <li className="px-4 py-3 font-mono text-xs text-g1">{loading ? "Searching…" : isAddress(q.trim()) ? "" : "No match on Robinhood Chain, Base or Ethereum. Paste the contract address."}</li>
      )}
    </ul>
  );
}

function useSearchBox(onDone?: () => void) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rawActive, setActive] = useState(0);
  const [chain, setChain] = useDefaultChain();
  const { hits, loading } = useHits(q, chain);
  const active = Math.max(0, Math.min(rawActive, hits.length - 1));
  const pick = (h: Hit) => {
    setOpen(false);
    setQ("");
    onDone?.();
    router.push(`/${h.chain}/${h.address}`);
  };
  const submit = () => {
    const v = q.trim();
    if (hits[active]) pick(hits[active]);
    else if (isAddress(v)) pick({ chain, address: v.toLowerCase(), symbol: "", name: "", liquidityUsd: 0 });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(hits.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") setOpen(false);
  };
  const setQuery = (v: string) => {
    setQ(v);
    setActive(0);
  };
  return { q, setQ: setQuery, open, setOpen, active, hits, loading, pick, submit, onKeyDown, chain, setChain };
}

/** Header search with ⌘K. */
export function HeaderSearch() {
  const s = useSearchBox();
  const ref = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { setOpen } = s;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
  return (
    <div className="flex min-w-0 flex-1 items-stretch gap-6">
      <div className="relative min-w-0 flex-1">
        <label className="flex h-[52px] items-center border-2 border-ink bg-white px-4">
          <span className="sr-only">Search token or address</span>
          <input
            ref={ref}
            value={s.q}
            onChange={(e) => {
              s.setQ(e.target.value);
              s.setOpen(true);
            }}
            onFocus={() => s.setOpen(true)}
            onBlur={() => setTimeout(() => s.setOpen(false), 120)}
            onKeyDown={s.onKeyDown}
            placeholder="Search token or address"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-g1"
            role="combobox"
            aria-expanded={s.open}
            aria-controls={listId}
            data-testid="header-search"
          />
          <kbd className="ml-3 hidden font-mono text-[11px] text-g1 sm:block">⌘K</kbd>
        </label>
        {s.open && <Results hits={s.hits} active={s.active} onPick={s.pick} loading={s.loading} q={s.q} listId={listId} />}
      </div>
      <label className="hidden h-[52px] items-center border-2 border-ink px-4 lg:flex">
        <span className="sr-only">Default chain for addresses</span>
        <select value={s.chain} onChange={(e) => s.setChain(e.target.value as ChainKey)} className="bg-transparent pr-2 font-mono text-sm outline-none">
          {CHAIN_LIST.map((c) => (
            <option key={c.key} value={c.key}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Mobile: icon button that opens a full-width search sheet. */
export function MobileSearch() {
  const [open, setOpen] = useState(false);
  const s = useSearchBox(() => setOpen(false));
  const listId = useId();
  return (
    <>
      <button type="button" aria-label="Search" onClick={() => setOpen(true)} className="grid size-12 place-items-center border-2 border-ink">
        <SearchIcon className="size-5" strokeWidth={2.5} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <input
                autoFocus
                value={s.q}
                onChange={(e) => s.setQ(e.target.value)}
                onKeyDown={s.onKeyDown}
                placeholder="0x… / $TICKER"
                className="h-12 w-full border-2 border-ink px-3 font-mono text-sm outline-none"
              />
              <Results hits={s.hits} active={s.active} onPick={s.pick} loading={s.loading} q={s.q} listId={listId} />
            </div>
            <button type="button" aria-label="Close search" onClick={() => setOpen(false)} className="grid size-12 place-items-center border-2 border-ink">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** Landing hero search: "Contract address or ticker" + red "Map it". */
export function HeroSearch() {
  const s = useSearchBox();
  const listId = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        s.submit();
      }}
      className="relative"
    >
      <label htmlFor="hero-q" className="mb-2 block font-mono text-xs font-bold">
        Contract address or ticker
      </label>
      <div className="flex border-[3px] border-ink bg-white p-[3px]">
        <input
          id="hero-q"
          value={s.q}
          onChange={(e) => {
            s.setQ(e.target.value);
            s.setOpen(true);
          }}
          onFocus={() => s.setOpen(true)}
          onBlur={() => setTimeout(() => s.setOpen(false), 120)}
          onKeyDown={s.onKeyDown}
          placeholder="0x… / $TICKER"
          className="h-14 min-w-0 flex-1 bg-transparent px-5 font-mono text-base outline-none placeholder:text-g1"
          autoComplete="off"
          data-testid="hero-search"
        />
        <button type="submit" className="bg-signal px-8 font-extrabold text-white hover:bg-ink">
          Map it
        </button>
      </div>
      {s.open && <Results hits={s.hits} active={s.active} onPick={s.pick} loading={s.loading} q={s.q} listId={listId} />}
    </form>
  );
}
