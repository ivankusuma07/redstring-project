"use client";

import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from "d3-force";
import { Maximize2, Minimize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { amount, pct, shortAddr } from "@/lib/format";
import type { HolderNode, LinkKind, Snapshot } from "@/lib/types";

export type HideKey = "cex" | "dex" | "burn" | "contract";

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
  n: HolderNode;
  ax: number;
  ay: number;
}
interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: LinkKind;
}

const INK = "#0a0a0a";
const RED = "#d10600";
const G2 = "#9a9a9a";
const WORLD = 1000;

/** Small deterministic hash → [0,1) so layouts are stable between renders. */
function h01(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const radiusOf = (n: HolderNode) => 3 + Math.sqrt(Math.max(0, n.pct)) * 11;

function hiddenBy(n: HolderNode, hide: Set<HideKey>) {
  if (n.type === "cex") return hide.has("cex");
  if (n.type === "dex") return hide.has("dex");
  if (n.type === "burn" || n.type === "bridge") return hide.has("burn");
  if (n.isContract && n.type === "contract") return hide.has("contract");
  return false;
}

const exemptLabel = (n: HolderNode) => (n.type === "cex" ? "CEX" : n.type === "dex" ? "DEX pool" : n.type === "burn" ? "Burn" : n.type === "bridge" ? "Bridge" : "");

export interface HolderGraphProps {
  snapshot: Snapshot;
  hide?: Set<HideKey>;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  isolate?: number | null;
  controls?: boolean;
  minimap?: boolean;
  legend?: boolean;
  /** "hero" settles slowly and ignores clicks. */
  variant?: "full" | "hero" | "preview";
  className?: string;
}

export function HolderGraph({
  snapshot,
  hide = new Set(),
  selected = null,
  onSelect,
  isolate = null,
  controls = true,
  minimap = true,
  legend = true,
  variant = "full",
  className = "",
}: HolderGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const view = useRef({ k: 1, x: 0, y: 0, w: 0, h: 0, fitted: false });
  const state = useRef({ hide, selected, isolate, hover: null as string | null });
  const frame = useRef(0);
  const neighbours = useRef(new Map<string, Set<string>>());
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<HolderNode | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const onSelectRef = useRef(onSelect);

  useLayoutEffect(() => {
    state.current.hide = hide;
    state.current.selected = selected;
    state.current.isolate = isolate;
    onSelectRef.current = onSelect;
  });

  const clusterIds = useMemo(() => snapshot.clusters.slice(0, 8).map((c) => c.id), [snapshot]);

  // ---------- drawing ------------------------------------------------------
  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const { k, x, y, w, h } = view.current;
    const dpr = window.devicePixelRatio || 1;
    const { hide: hd, selected: sel, isolate: iso, hover } = state.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    const px = 1 / k;
    // Hover focus: the wallet under the pointer (or the selected one), what it links to, and its group.
    const focusId = variant === "full" ? (hover ?? sel) : null;
    let focus: Set<string> | null = null;
    if (focusId) {
      focus = new Set([focusId, ...(neighbours.current.get(focusId) ?? [])]);
      const fc = nodesRef.current.find((s) => s.id === focusId)?.n.cluster;
      if (fc != null) for (const s of nodesRef.current) if (s.n.cluster === fc) focus.add(s.id);
    }
    const dim = (n: HolderNode) => (iso != null && n.cluster !== iso) || (focus != null && !focus.has(n.id));

    // links
    for (const l of linksRef.current) {
      const a = l.source;
      const b = l.target;
      if (hiddenBy(a.n, hd) || hiddenBy(b.n, hd)) continue;
      ctx.globalAlpha = focus ? (a.id === focusId || b.id === focusId || (focus.has(a.id) && focus.has(b.id)) ? 1 : 0.06) : dim(a.n) && dim(b.n) ? 0.08 : 1;
      ctx.strokeStyle = l.kind === "same-block" ? INK : RED;
      ctx.lineWidth = (l.kind === "transfer" ? 2 : 1.6) * px;
      ctx.setLineDash(l.kind === "funder" ? [6 * px, 5 * px] : []);
      ctx.beginPath();
      ctx.moveTo(a.x!, a.y!);
      ctx.lineTo(b.x!, b.y!);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // nodes
    for (const s of nodesRef.current) {
      const n = s.n;
      if (hiddenBy(n, hd)) continue;
      ctx.globalAlpha = dim(n) ? 0.12 : 1;
      ctx.beginPath();
      if (n.exempt) {
        ctx.arc(s.x!, s.y!, s.r, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 2.5 * px;
        ctx.strokeStyle = G2;
        ctx.setLineDash(n.type === "burn" ? [4 * px, 3 * px] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (n.cluster != null) {
        ctx.arc(s.x!, s.y!, s.r, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
      } else if (n.isContract) {
        ctx.rect(s.x! - s.r * 0.88, s.y! - s.r * 0.88, s.r * 1.76, s.r * 1.76);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 1.8 * px;
        ctx.strokeStyle = INK;
        ctx.stroke();
      } else {
        ctx.arc(s.x!, s.y!, Math.max(s.r, 3.2 * px), 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.lineWidth = 1.8 * px;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
      if (n.id === sel || n.id === hover) {
        ctx.beginPath();
        ctx.arc(s.x!, s.y!, s.r + (n.id === sel ? 7 : 4) * px, 0, Math.PI * 2);
        ctx.lineWidth = (n.id === sel ? 2.8 : 1.5) * px;
        ctx.strokeStyle = n.id === sel ? RED : INK;
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // labels in screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "600 12px var(--font-jetbrains), ui-monospace, monospace";
    ctx.textBaseline = "alphabetic";
    if (variant !== "preview" || w >= 500) {
      for (const c of snapshot.clusters) {
        if (!clusterIds.includes(c.id)) continue;
        let minX = Infinity,
          minY = Infinity;
        for (const s of nodesRef.current)
          if (s.n.cluster === c.id) {
            minX = Math.min(minX, s.x! - s.r);
            minY = Math.min(minY, s.y! - s.r);
          }
        if (!Number.isFinite(minX)) continue;
        ctx.globalAlpha = (iso != null && iso !== c.id) || (focus != null && !nodesRef.current.some((s) => s.n.cluster === c.id && focus.has(s.id))) ? 0.2 : 1;
        ctx.fillStyle = iso === c.id ? RED : INK;
        ctx.fillText(`GROUP ${c.id} — ${c.pct.toFixed(1)}%`, minX * k + x, minY * k + y - 12);
      }
      ctx.globalAlpha = 1;
      // Rank labels under the nodes, biggest holders first, skipping any that would overlap.
      ctx.font = "500 11px var(--font-jetbrains), ui-monospace, monospace";
      ctx.textAlign = "center";
      const taken: [number, number, number, number][] = [];
      const order = [...nodesRef.current].sort((a, b) => {
        const fa = focus?.has(a.id) ? 0 : 1;
        const fb = focus?.has(b.id) ? 0 : 1;
        return fa - fb || a.n.rank - b.n.rank;
      });
      for (const s of order) {
        const n = s.n;
        if (hiddenBy(n, hd)) continue;
        const inFocus = focus?.has(n.id) ?? false;
        const sr = s.r * k;
        // small wallets get a label once zoomed in enough, or when they are part of the focus
        if (!inFocus && sr < (n.exempt ? 4 : 5)) continue;
        const text = n.exempt ? `${exemptLabel(n)} · #${n.rank}` : `#${n.rank}`;
        const tx = s.x! * k + x;
        const ty = s.y! * k + y + sr + 14;
        if (tx < -40 || ty < -20 || tx > w + 40 || ty > h + 20) continue;
        const tw = ctx.measureText(text).width + 6;
        const box: [number, number, number, number] = [tx - tw / 2, ty - 11, tx + tw / 2, ty + 3];
        if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
        taken.push(box);
        ctx.globalAlpha = dim(n) ? 0.15 : 1;
        ctx.fillStyle = n.id === focusId ? RED : inFocus ? INK : "#595959";
        ctx.fillText(text, tx, ty);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "start";
    }

    // tooltip follows its node through pans, zooms and the simulation
    const tipEl = tipRef.current;
    if (tipEl) {
      const s = hover ? nodesRef.current.find((n) => n.id === hover) : null;
      if (s && s.x != null) {
        const sx = s.x * k + x;
        const sy = s.y! * k + y;
        const tw = tipEl.offsetWidth;
        const th = tipEl.offsetHeight;
        const gap = s.r * k + 12;
        const left = sx + gap + tw > w - 8 ? sx - gap - tw : sx + gap;
        const top = Math.max(8, Math.min(h - th - 8, sy - th / 2));
        tipEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        tipEl.style.visibility = "visible";
      } else tipEl.style.visibility = "hidden";
    }

    // minimap
    const mini = miniRef.current;
    if (mini) {
      const mctx = mini.getContext("2d")!;
      const mw = mini.clientWidth;
      const mh = mini.clientHeight;
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, mw, mh);
      const ms = Math.min(mw, mh) / (WORLD * 1.1);
      const ox = mw / 2;
      const oy = mh / 2;
      for (const s of nodesRef.current) {
        if (hiddenBy(s.n, hd)) continue;
        mctx.fillStyle = s.n.exempt ? G2 : s.n.cluster != null ? (s.n.cluster === iso ? RED : INK) : "#cfcfcf";
        const r = Math.max(1, s.r * ms);
        mctx.fillRect(ox + s.x! * ms - r / 2, oy + s.y! * ms - r / 2, r, r);
      }
      // viewport
      const vx0 = (0 - x) / k;
      const vy0 = (0 - y) / k;
      mctx.strokeStyle = RED;
      mctx.lineWidth = 1.5;
      mctx.strokeRect(ox + vx0 * ms, oy + vy0 * ms, (w / k) * ms, (h / k) * ms);
    }
  }, [snapshot, clusterIds, variant]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  // ---------- simulation ---------------------------------------------------
  useEffect(() => {
    const clusters = snapshot.clusters;
    const ringR = clusters.length <= 1 ? 0 : WORLD * 0.2;
    const anchorOf = new Map<number, [number, number]>();
    clusters.forEach((c, i) => {
      // biggest groups near the centre, smaller ones further out
      const ring = i < 6 ? ringR : WORLD * 0.3;
      const a = (i / Math.min(clusters.length, 6)) * Math.PI * 2 - Math.PI / 2 + (i >= 6 ? 0.4 : 0);
      anchorOf.set(c.id, [Math.cos(a) * ring, Math.sin(a) * ring]);
    });
    const exempt = snapshot.nodes.filter((n) => n.exempt);
    const nodes: SimNode[] = snapshot.nodes.map((n) => {
      let ax: number, ay: number;
      if (n.cluster != null) [ax, ay] = anchorOf.get(n.cluster)!;
      else if (n.exempt) {
        const i = exempt.indexOf(n);
        const a = Math.PI * 0.15 + (i / Math.max(1, exempt.length)) * Math.PI * 0.7; // lower-right arc
        ax = Math.cos(a) * WORLD * 0.36;
        ay = Math.sin(a) * WORLD * 0.36;
      } else {
        const a = h01(n.id) * Math.PI * 2;
        const d = Math.sqrt(0.15 + h01(n.id, 7) * 0.85) * WORLD * 0.47;
        ax = Math.cos(a) * d;
        ay = Math.sin(a) * d;
      }
      return { id: n.id, n, r: radiusOf(n), ax, ay, x: ax + (h01(n.id, 3) - 0.5) * 40, y: ay + (h01(n.id, 5) - 0.5) * 40 };
    });
    const byId = new Map(nodes.map((s) => [s.id, s]));
    const links: SimLink[] = snapshot.links
      .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)!, kind: l.kind }))
      .filter((l) => l.source && l.target);
    nodesRef.current = nodes;
    linksRef.current = links;
    const nb = new Map<string, Set<string>>();
    for (const l of links) {
      if (!nb.has(l.source.id)) nb.set(l.source.id, new Set());
      if (!nb.has(l.target.id)) nb.set(l.target.id, new Set());
      nb.get(l.source.id)!.add(l.target.id);
      nb.get(l.target.id)!.add(l.source.id);
    }
    neighbours.current = nb;

    const sim = forceSimulation<SimNode, SimLink>(nodes)
      .alphaDecay(variant === "hero" ? 0.006 : 0.02)
      .velocityDecay(0.38)
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => l.source.r + l.target.r + 26)
          .strength(0.5),
      )
      .force("charge", forceManyBody<SimNode>().strength((d) => (d.n.cluster != null ? -30 - d.r * 4 : -6)).distanceMax(220))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + (d.n.exempt ? 14 : 3)).iterations(2))
      .force("x", forceX<SimNode>((d) => d.ax).strength((d) => (d.n.cluster != null ? 0.06 : d.n.exempt ? 0.2 : 0.08)))
      .force("y", forceY<SimNode>((d) => d.ay).strength((d) => (d.n.cluster != null ? 0.06 : d.n.exempt ? 0.2 : 0.08)))
      .on("tick", schedule);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sim.stop();
      sim.tick(300);
      schedule();
    }
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [snapshot, variant, schedule]);

  // ---------- sizing -------------------------------------------------------
  const fit = useCallback(() => {
    const v = view.current;
    v.k = Math.min(v.w, v.h) / (WORLD * 1.04);
    v.x = v.w / 2;
    v.y = v.h / 2;
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const mini = miniRef.current;
      if (mini) {
        mini.width = Math.round(mini.clientWidth * dpr);
        mini.height = Math.round(mini.clientHeight * dpr);
      }
      const v = view.current;
      const wasFitted = !v.fitted || Math.abs(v.k - Math.min(v.w, v.h) / (WORLD * 1.04)) < 1e-6;
      v.w = w;
      v.h = h;
      if (wasFitted) fit();
      v.fitted = true;
      schedule();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fit, schedule]);

  useEffect(() => schedule(), [hide, selected, isolate, tip, schedule]);

  // ---------- interaction --------------------------------------------------
  const toWorld = (sx: number, sy: number) => {
    const v = view.current;
    return [(sx - v.x) / v.k, (sy - v.y) / v.k] as const;
  };
  const hit = useCallback((sx: number, sy: number): SimNode | null => {
    const [wx, wy] = toWorld(sx, sy);
    const slop = 4 / view.current.k;
    const ns = nodesRef.current;
    for (let i = ns.length - 1; i >= 0; i--) {
      const s = ns[i];
      if (hiddenBy(s.n, state.current.hide)) continue;
      const dx = s.x! - wx;
      const dy = s.y! - wy;
      if (dx * dx + dy * dy <= (s.r + slop) ** 2) return s;
    }
    return null;
  }, []);

  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      const v = view.current;
      const base = Math.min(v.w, v.h) / (WORLD * 1.04);
      const k = Math.max(base * 0.5, Math.min(base * 12, v.k * factor));
      v.x = sx - ((sx - v.x) * k) / v.k;
      v.y = sy - ((sy - v.y) * k) / v.k;
      v.k = k;
      schedule();
    },
    [schedule],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "none" | "pan" | "node" | "pinch" = "none";
    let dragNode: SimNode | null = null;
    let start = { x: 0, y: 0 };
    let moved = 0;
    let pinchDist = 0;
    const pos = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.pointerType !== "mouse" && state.current.hover) {
        state.current.hover = null;
        setTip(null);
      }
      const p = pos(e);
      pointers.set(e.pointerId, p);
      moved = 0;
      start = p;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        mode = "pinch";
        return;
      }
      const s = variant === "full" && e.pointerType === "mouse" ? hit(p.x, p.y) : null;
      if (s) {
        mode = "node";
        dragNode = s;
        simRef.current?.alphaTarget(0.15).restart();
      } else mode = "pan";
    };
    const move = (e: PointerEvent) => {
      const p = pos(e);
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const s = hit(p.x, p.y);
        const id = s?.id ?? null;
        if (id !== state.current.hover && variant === "full") {
          state.current.hover = id;
          canvas.style.cursor = id ? "pointer" : "grab";
          setTip(s?.n ?? null);
          schedule();
        }
        return;
      }
      pointers.set(e.pointerId, p);
      moved += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
      const v = view.current;
      if (mode === "pinch" && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
      } else if (mode === "pan") {
        v.x += p.x - prev.x;
        v.y += p.y - prev.y;
        schedule();
      } else if (mode === "node" && dragNode) {
        const [wx, wy] = toWorld(p.x, p.y);
        dragNode.fx = wx;
        dragNode.fy = wy;
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (dragNode) {
        dragNode.fx = null;
        dragNode.fy = null;
        simRef.current?.alphaTarget(0);
      }
      if (moved < 5 && mode !== "pinch" && variant !== "hero") {
        const s = hit(start.x, start.y);
        onSelectRef.current?.(s?.id ?? null);
      }
      dragNode = null;
      if (pointers.size === 0) mode = "none";
    };
    const leave = () => {
      if (state.current.hover) {
        state.current.hover = null;
        setTip(null);
        schedule();
      }
    };
    const wheel = (e: WheelEvent) => {
      if (variant === "hero") return;
      e.preventDefault();
      const p = { x: e.offsetX, y: e.offsetY };
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
    };
  }, [hit, schedule, zoomAt, variant]);

  // centre on a node selected from outside (table, group list) when it's off-screen
  useEffect(() => {
    if (!selected) return;
    const s = nodesRef.current.find((n) => n.id === selected);
    const v = view.current;
    if (!s || s.x == null) return;
    const sx = s.x * v.k + v.x;
    const sy = s.y! * v.k + v.y;
    if (sx < 40 || sy < 40 || sx > v.w - 40 || sy > v.h - 40) {
      v.x = v.w / 2 - s.x * v.k;
      v.y = v.h / 2 - s.y! * v.k;
      schedule();
    }
  }, [selected, schedule]);

  // test + tooling hook: screen position of a node
  useEffect(() => {
    if (variant !== "full") return;
    (window as unknown as { __rsGraph?: unknown }).__rsGraph = {
      screenPos: (id: string) => {
        const s = nodesRef.current.find((n) => n.id === id);
        const r = canvasRef.current?.getBoundingClientRect();
        if (!s || !r) return null;
        const v = view.current;
        return { x: r.left + s.x! * v.k + v.x, y: r.top + s.y! * v.k + v.y };
      },
    };
  }, [variant]);

  useEffect(() => {
    const onFs = () => {
      setFullscreen(document.fullscreenElement === wrapRef.current);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapRef.current?.requestFullscreen?.();
  };

  const miniClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const m = miniRef.current!;
    const r = m.getBoundingClientRect();
    const ms = Math.min(r.width, r.height) / (WORLD * 1.1);
    const wx = (e.clientX - r.left - r.width / 2) / ms;
    const wy = (e.clientY - r.top - r.height / 2) / ms;
    const v = view.current;
    v.x = v.w / 2 - wx * v.k;
    v.y = v.h / 2 - wy * v.k;
    schedule();
  };

  const btn = "grid size-12 place-items-center border-ink bg-white hover:bg-ink hover:text-white";
  return (
    <div ref={wrapRef} className={`relative h-full w-full overflow-hidden bg-white ${className}`}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: variant === "hero" ? "default" : "grab" }}
        data-testid={variant === "full" ? "graph-canvas" : undefined}
        data-nodes={snapshot.nodes.length}
        aria-label={`Holder map: ${snapshot.nodes.length} holders, ${snapshot.clusters.length} linked groups`}
        role="img"
      />
      {tip && (
        <div
          ref={tipRef}
          role="tooltip"
          data-testid="graph-tooltip"
          className="pointer-events-none absolute top-0 left-0 z-10 w-[264px] border-2 border-ink bg-white px-4 py-3 font-mono text-xs shadow-[4px_4px_0_#0a0a0a]"
          style={{ visibility: "hidden" }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-bold">Holder #{tip.rank}</span>
            <span className="text-g1">{shortAddr(tip.id)}</span>
          </div>
          {tip.label && <div className="mt-0.5 truncate font-sans text-[13px] font-extrabold">{tip.label}</div>}
          <dl className="mt-2.5 space-y-1 border-t border-ink pt-2.5">
            <div className="flex justify-between">
              <dt>Supply share</dt>
              <dd className="font-bold">{pct(tip.pct, 2)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Balance</dt>
              <dd className="truncate font-bold">
                {amount(tip.amount)} {snapshot.token.symbol}
              </dd>
            </div>
          </dl>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tip.cluster != null ? (
              <span className="bg-signal px-1.5 py-0.5 font-bold text-white">GROUP {tip.cluster}</span>
            ) : tip.exempt ? (
              <span className="border border-g2 px-1.5 py-0.5 text-g1">{exemptLabel(tip).toUpperCase()} · EXEMPT</span>
            ) : (
              <span className="border border-ink px-1.5 py-0.5">FREE FLOAT</span>
            )}
            {tip.launchBuyer && <span className="border border-signal px-1.5 py-0.5 text-signal">LAUNCH BUYER</span>}
            {tip.fromDeployer && <span className="border border-signal px-1.5 py-0.5 text-signal">FROM DEPLOYER</span>}
            {tip.isContract && !tip.exempt && <span className="border border-ink px-1.5 py-0.5">CONTRACT</span>}
          </div>
        </div>
      )}
      {minimap && (
        <canvas
          ref={miniRef}
          onClick={miniClick}
          className="absolute top-4 right-4 hidden h-[96px] w-[150px] cursor-crosshair border-2 border-ink bg-white md:block"
          aria-label="Minimap"
        />
      )}
      {controls && (
        <div className="absolute bottom-5 left-5 flex border-2 border-ink">
          <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoomAt(view.current.w / 2, view.current.h / 2, 1.3)}>
            <Plus className="size-5" strokeWidth={2.5} />
          </button>
          <button type="button" aria-label="Zoom out" className={`${btn} border-l-2`} onClick={() => zoomAt(view.current.w / 2, view.current.h / 2, 1 / 1.3)}>
            <Minus className="size-5" strokeWidth={2.5} />
          </button>
          <button type="button" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} className={`${btn} border-l-2`} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="size-4" strokeWidth={2.5} /> : <Maximize2 className="size-4" strokeWidth={2.5} />}
          </button>
        </div>
      )}
      {legend && (
        <div className="absolute right-5 bottom-5 hidden items-center gap-4 border-2 border-ink bg-white px-4 py-2 font-mono text-xs lg:flex">
          <span className="flex items-center gap-2">
            <i className="block h-0.5 w-5 bg-signal" /> Link
          </span>
          <span className="flex items-center gap-2">
            <i className="block h-0 w-5 border-t-2 border-dashed border-signal" /> Shared funder
          </span>
          <span className="flex items-center gap-2">
            <i className="block h-0.5 w-5 bg-ink" /> Same block
          </span>
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="#9a9a9a" strokeWidth="2" /></svg> Exempt
          </span>
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 14 14" className="size-3.5" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="#0a0a0a" strokeWidth="2" /></svg> Free float
          </span>
        </div>
      )}
    </div>
  );
}
