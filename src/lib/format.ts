export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

export function shortAddr(a: string | null | undefined, head = 4, tail = 4): string {
  if (!a) return "—";
  if (a.length <= head + tail + 2) return a;
  return `${a.slice(0, 2 + head)}…${a.slice(-tail)}`;
}

export function pct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
}

export function usd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  if (abs === 0) return "$0";
  // small prices: keep 2 significant digits
  const digits = Math.min(12, Math.max(2, -Math.floor(Math.log10(abs)) + 1));
  return `$${v.toFixed(digits)}`;
}

export function int(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-US");
}

export function amount(v: number): string {
  if (v >= 1e4) return Math.round(v).toLocaleString("en-US");
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function ago(iso: string | number, now = Date.now()): string {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export function daysAgo(tsSec: number, now = Date.now()): string {
  const d = Math.floor((now / 1000 - tsSec) / 86400);
  if (d <= 0) return "Today";
  if (d === 1) return "1 day ago";
  return `${d} days ago`;
}

export function utcStamp(iso: string): string {
  const d = new Date(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} UTC`;
}

export const levelLabel = (l: "LOW" | "MODERATE" | "HIGH") =>
  l === "LOW" ? "Low" : l === "MODERATE" ? "Moderate" : "High";
