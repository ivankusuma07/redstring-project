import Link from "next/link";
import type { Snapshot } from "@/lib/types";

export function ScoreScale({ value }: { value: number }) {
  return (
    <div className="max-w-[500px]">
      <div className="relative flex h-6 border-2 border-ink">
        <div className="h-full bg-signal" style={{ width: "40%" }} />
        <div className="h-full bg-g2" style={{ width: "30%" }} />
        <div className="absolute -top-2 -bottom-2 w-1 bg-ink" style={{ left: `calc(${value}% - 2px)` }} aria-label={`Score marker at ${value}`} />
      </div>
      <div className="relative mt-2 h-4 font-mono text-xs">
        <span className="absolute left-0">0 High</span>
        <span className="absolute left-[36%]">40 Moderate</span>
        <span className="absolute right-0">70 Low · 100</span>
      </div>
    </div>
  );
}

export function AuditTab({ s }: { s: Snapshot }) {
  const { score } = s;
  return (
    <section className="px-5 py-10 md:px-12">
      <div className="grid grid-cols-12 gap-x-6 gap-y-12">
        <div className="col-span-12 lg:col-span-5">
          <div className="font-mono text-sm">Decentralization score</div>
          <div className={`display mt-4 text-[160px] md:text-[220px] ${score.level === "HIGH" ? "text-signal" : ""}`} data-testid="audit-score">
            {score.value}
          </div>
          <div className="mt-6">
            <ScoreScale value={score.value} />
          </div>
          <p className="mt-8 max-w-[500px] text-xl leading-snug">{score.summary}</p>
        </div>
        <div className="col-span-12 lg:col-span-7">
          <h2 className="display text-[40px] md:text-[52px]">How the score is built</h2>
          <p className="mt-4 font-mono text-sm">Start at 100. Each factor takes points off. Exchange, pool and burn wallets are excluded.</p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse border-y-[6px] border-ink text-left">
              <thead className="font-mono text-xs">
                <tr className="border-b-2 border-ink">
                  <th className="px-3 py-5 font-bold">Factor</th>
                  <th className="px-3 py-5 text-right font-bold">Value</th>
                  <th className="px-3 py-5 font-bold">Rule</th>
                  <th className="px-3 py-5 text-right font-bold">Points</th>
                </tr>
              </thead>
              <tbody>
                {score.factors.map((f) => (
                  <tr key={f.key} className="border-b border-ink align-top">
                    <td className="px-3 py-5">
                      <div className="text-lg font-bold">{f.label}</div>
                      {f.detail && <div className="mt-0.5 text-[15px]">{f.detail}</div>}
                    </td>
                    <td className="px-3 py-5 text-right font-mono text-sm">{f.value}</td>
                    <td className="px-3 py-5 font-mono text-sm whitespace-nowrap">{f.rule}</td>
                    <td className={`px-3 py-5 text-right font-mono text-sm ${f.points < 0 ? "text-signal" : ""}`}>{f.points === 0 ? "0.0" : f.points.toFixed(1).replace("-", "−")}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-3 py-5 text-2xl font-extrabold">Score</td>
                  <td />
                  <td className="px-3 py-5 font-mono text-sm">100 − {score.totalPenalty.toFixed(1)}</td>
                  <td className="px-3 py-5 text-right text-2xl font-extrabold">{score.value}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {s.clusters.length > 0 && (
        <div className="mt-12 grid grid-cols-1 gap-8 border-t-[6px] border-ink pt-10 md:grid-cols-3">
          {s.clusters.slice(0, 3).map((c, i) => (
            <article key={c.id}>
              <div className={`font-mono text-sm font-bold ${i === 0 ? "text-signal" : ""}`}>
                Group {c.id} · {c.pct.toFixed(1)}%
              </div>
              <h3 className="mt-3 text-[28px] leading-tight font-extrabold tracking-[-0.02em]">{c.title}</h3>
              <p className="mt-3 text-lg leading-snug">{c.body}</p>
            </article>
          ))}
        </div>
      )}

      <div className="mt-12 border-2 border-ink px-6 py-5 font-mono text-sm leading-relaxed">
        Linked means connected by on-chain activity, not proven to be one owner. Projects can dispute a label at{" "}
        <Link href="/method#dispute" className="underline underline-offset-4">
          redstring/dispute
        </Link>
        . Scores are a heuristic, not financial advice.
        {s.limits.length > 0 && <span className="mt-2 block text-g1">Not checked in this scan: {s.limits.join(" ")}</span>}
      </div>
    </section>
  );
}
