import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CHAIN_LIST, CHAINS } from "./chains";
import { levelLabel, shortAddr } from "./format";
import type { StoredSnapshot } from "./types";

export const OG_SIZE = { width: 1200, height: 630 };

const dir = join(process.cwd(), "assets/fonts");
const load = (f: string) => readFile(join(dir, f)).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);

export async function ogFonts() {
  const [black, xbold, reg, mono, monoB] = await Promise.all([
    load("SchibstedGrotesk-Black.ttf"),
    load("SchibstedGrotesk-ExtraBold.ttf"),
    load("SchibstedGrotesk-Regular.ttf"),
    load("JetBrainsMono-Medium.ttf"),
    load("JetBrainsMono-Bold.ttf"),
  ]);
  return [
    { name: "Schibsted", data: black, weight: 900 as const, style: "normal" as const },
    { name: "Schibsted", data: xbold, weight: 800 as const, style: "normal" as const },
    { name: "Schibsted", data: reg, weight: 400 as const, style: "normal" as const },
    { name: "Mono", data: mono, weight: 500 as const, style: "normal" as const },
    { name: "Mono", data: monoB, weight: 700 as const, style: "normal" as const },
  ];
}

const INK = "#0a0a0a";
const RED = "#d10600";

function CrowSvg({ w }: { w: number }) {
  return (
    <svg width={w} height={(w * 120) / 180} viewBox="0 0 180 120">
      <path d="M18 96 L52 74 L86 46 L118 30 L140 26 L150 34 L134 40 L126 62 L106 84 L76 90 L52 92 L40 104 Z" fill={INK} />
      <path d="M112 26 L130 14 L146 16 L176 26 L146 30 L136 40 Z" fill={INK} />
      <path d="M76 90 L72 112 M88 88 L94 112" stroke={INK} strokeWidth="4" />
      <circle cx="140" cy="20" r="4" fill={RED} />
      <path d="M170 28 C 182 50, 172 80, 156 104" stroke={RED} strokeWidth="4" fill="none" />
    </svg>
  );
}

/** Logo crow (same as CrowMark in components/brand). */
function CrowMarkSvg({ h }: { h: number }) {
  return (
    <svg width={Math.round((h * 84) / 88)} height={h} viewBox="8 8 84 88">
      <circle cx="50" cy="45" r="34" fill={RED} />
      <path fill={INK} d="M50 18 C53 13 60 13 63 16.5 C70 17 77 19.5 83 24 C77 25.5 70 27 65 28.5 C67 31 69 34 68.5 37 C71 44 71.5 55 67 64 C64 70 60 74 55 76 L49.5 94 L37 94 L42.5 80 C39 70 39 54 42 42 C43.5 34 46 26 50 18 Z" />
      <path d="M55 75 L54 86 M61 72 L63 86" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M10 87.5 L90 85.5 M74 86 L83 80.5" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <circle cx="59.5" cy="20.5" r="1.8" fill={RED} />
    </svg>
  );
}

/** 1200×630 share card: Swiss layout per design screen 09. */
export function OgCard({ rec }: { rec: StoredSnapshot | null }) {
  if (!rec)
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: "#fff", border: `14px solid ${INK}`, padding: 56, fontFamily: "Schibsted" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 34, fontWeight: 800 }}>
          <CrowMarkSvg h={48} /> Redstring
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 128, fontWeight: 900, letterSpacing: -6, lineHeight: 0.9 }}>
          <span>Who really</span>
          <span style={{ display: "flex" }}>
            holds <span style={{ color: RED, marginLeft: 24 }}>it?</span>
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ fontFamily: "Mono", fontSize: 24 }}>{CHAIN_LIST.map((c) => c.short).join(" · ")}</span>
          <CrowSvg w={130} />
        </div>
      </div>
    );
  const s = rec.snapshot;
  const { linked, exempt, free } = s.supply;
  const symbol = `$${s.token.symbol}`;
  const symSize = symbol.length > 9 ? 84 : symbol.length > 7 ? 104 : 124;
  const sealed = rec.seal.status === "sealed" && rec.seal.txHash ? shortAddr(rec.seal.txHash) : rec.seal.status === "pending" ? "pending" : rec.seal.status === "example" ? "example" : "hashed";
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#fff", border: `14px solid ${INK}`, padding: "46px 56px", fontFamily: "Schibsted", color: INK }}>
      <div style={{ display: "flex", flexDirection: "column", width: 650 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 800 }}>
          <CrowMarkSvg h={42} /> Redstring
        </div>
        <div style={{ fontFamily: "Mono", fontSize: 21, marginTop: 26 }}>
          {`${CHAINS[s.chain].name} · block ${s.blockNumber.toLocaleString("en-US")}`}
        </div>
        <div style={{ fontSize: symSize, fontWeight: 900, letterSpacing: -5, lineHeight: 1, marginTop: 10 }}>{symbol}</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          <div style={{ display: "flex", width: 640, height: 44, border: `4px solid ${INK}` }}>
            <div style={{ width: `${linked}%`, background: RED }} />
            <div style={{ width: `${exempt}%`, background: "#9a9a9a" }} />
          </div>
          <div style={{ display: "flex", gap: 32, fontFamily: "Mono", fontSize: 22, marginTop: 14 }}>
            <span style={{ display: "flex" }}>
              <span style={{ color: RED, fontWeight: 700, marginRight: 10 }}>{linked.toFixed(1)}%</span> linked
            </span>
            <span style={{ display: "flex" }}>
              <span style={{ fontWeight: 700, marginRight: 10 }}>{exempt.toFixed(1)}%</span> exempt
            </span>
            <span style={{ display: "flex" }}>
              <span style={{ fontWeight: 700, marginRight: 10 }}>{free.toFixed(1)}%</span> free float
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, marginLeft: 40 }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 196, fontWeight: 900, letterSpacing: -10, lineHeight: 0.8, color: s.score.level === "HIGH" ? RED : INK }}>{s.score.value}</span>
          <span style={{ display: "flex", flexDirection: "column", fontFamily: "Mono", fontSize: 22, marginLeft: 6 }}>
            <span>/100</span>
            <span style={{ fontWeight: 700 }}>{levelLabel(s.score.level)}</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 46, borderTop: `4px solid ${INK}` }}>
          {[
            ["Largest linked group", `${(s.clusters[0]?.pct ?? 0).toFixed(1)}%`, RED, "Schibsted"],
            ["Linked groups", String(s.clusters.length), INK, "Schibsted"],
            ["Sealed", sealed, INK, "Mono"],
          ].map(([k, v, c, f], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 26, padding: "12px 0", borderBottom: i < 2 ? `1.5px solid ${INK}` : "none" }}>
              <span>{k}</span>
              <span style={{ fontWeight: 800, color: c, fontFamily: f, fontSize: f === "Mono" ? 21 : 28 }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", marginTop: "auto", gap: 20 }}>
          <span style={{ fontSize: 38, fontWeight: 900, letterSpacing: -1.5 }}>Pull the string.</span>
          <CrowSvg w={84} />
        </div>
      </div>
    </div>
  );
}
