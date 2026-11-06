import Link from "next/link";
import { SiteFooter, StringMark } from "@/components/brand";
import { HolderGraph } from "@/components/graph/holder-graph";
import { SiteHeader } from "@/components/headers";
import { HeroSearch } from "@/components/search";
import { SupplyBar } from "@/components/supply-bar";
import { CHAIN_LIST, CHAINS } from "@/lib/chains";
import { FEATURED_HREF, featuredSnapshot } from "@/lib/featured";
import type { Snapshot, SupplySegment } from "@/lib/types";

const STEPS = [
  ["01", "Scan", "Top 250 holders, labelled: exchange, pool, burn, contract, deployer."],
  ["02", "Link", "Transfers, shared gas funders and launch-block buys draw the lines."],
  ["03", "Seal", "The result is hashed and anchored on Robinhood Chain. Verifiable forever."],
] as const;

/** The snapshot's own supply split, with group segments named after what links them. */
function landingSegments(s: Snapshot): SupplySegment[] {
  return s.supply.segments.map((seg) => {
    const c = seg.kind === "group" ? s.clusters.find((x) => `g${x.id}` === seg.key) : undefined;
    if (c) return { ...seg, label: `Group ${c.id} · ${c.launchBuyers ? "sniper ring" : c.deployerLinked ? "deployer" : "linked"}` };
    if (seg.kind === "dex" || seg.kind === "cex" || seg.kind === "burn" || seg.kind === "bridge") return { ...seg, label: `${seg.label} (exempt)` };
    return seg;
  });
}

export default async function Home() {
  const { snapshot: ex, real } = await featuredSnapshot();
  const mapHref = real ? FEATURED_HREF : "/robinhood/example";
  const landing = landingSegments(ex);
  const sampleName = `$${ex.token.symbol}`;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 md:px-12">
        {/* hero */}
        <section className="relative grid grid-cols-12 gap-6 pt-12 pb-12 md:pt-20">
          <p className="col-span-12 font-mono text-sm">Token supply forensics — {CHAIN_LIST.map((c) => c.name).join(", ")}</p>
          <h1 className="display col-span-12 mt-2 text-[72px] sm:text-[112px] lg:text-[148px] xl:text-[176px]">
            Who really
            <br />
            holds <span className="text-signal">it?</span>
          </h1>
          <StringMark curve className="pointer-events-none absolute top-[110px] right-0 hidden h-[300px] w-[340px] lg:block xl:h-[360px] xl:w-[420px]" />
          <p className="col-span-12 mt-6 self-end text-xl leading-snug md:col-span-6 md:text-[23px] lg:col-span-5">
            One map of every top holder. Wallets that trade with each other, share a funder or buy in the same block are joined by a red line. No line, no link.
          </p>
          <div className="col-span-12 mt-6 self-end md:col-span-6 lg:col-start-7">
            <HeroSearch />
            <p className="mt-3 font-mono text-xs">
              Or open the{" "}
              <Link href={mapHref} className="underline underline-offset-4 hover:text-signal">
                {sampleName} map
              </Link>
              .
            </p>
          </div>
        </section>
        <div className="rule-6" />

        {/* live map */}
        <section className="grid grid-cols-12 gap-6 py-14">
          <div className="col-span-12 lg:col-span-4">
            <div className="font-mono text-sm">
              Live sample · {sampleName} · {CHAINS[ex.chain].name}
            </div>
            <h2 className="display mt-4 text-[56px] md:text-[72px]">
              No line,
              <br />
              no link.
            </h2>
            <p className="mt-6 max-w-md text-lg leading-snug">
              Black dots are wallets, sized by balance. Red lines are token transfers between them, dashed lines a shared gas funder. Grey rings are exchanges and pools, set aside so
              they never fake a cluster.
            </p>
            <Link href={mapHref} className="mt-8 inline-flex h-14 items-center bg-ink px-7 font-extrabold text-white hover:bg-signal">
              Open the full map →
            </Link>
          </div>
          <div className="col-span-12 h-[440px] border-2 border-ink md:h-[560px] lg:col-span-8">
            <HolderGraph snapshot={ex} variant="hero" controls={false} minimap={false} />
          </div>
        </section>
        <div className="rule-6" />

        {/* supply split */}
        <section className="py-14">
          <div className="grid grid-cols-12 items-end gap-6">
            <h2 className="display col-span-12 text-[52px] md:col-span-6 md:text-[64px]">
              Supply, split
              <br />
              honestly.
            </h2>
            <p className="col-span-12 font-mono text-sm leading-relaxed md:col-span-5 md:col-start-8">
              {sampleName} at block {ex.blockNumber.toLocaleString("en-US")}. Exchange and pool wallets are set aside so they never fake a cluster.
            </p>
          </div>
          <div className="mt-8">
            <SupplyBar segments={landing} height="h-[104px]" border="border-[3px]" big />
          </div>
        </section>
        <div className="rule-6" />

        {/* scan / link / seal */}
        <section className="grid grid-cols-1 gap-7 py-14 md:grid-cols-3">
          {STEPS.map(([n, t, d], i) => (
            <div key={n} className={`border-t-2 pt-5 ${i === 2 ? "border-signal" : "border-ink"}`}>
              <div className={`display text-[96px] ${i === 2 ? "text-signal" : ""}`}>{n}</div>
              <h3 className="mt-4 text-3xl font-extrabold tracking-[-0.02em]">{t}</h3>
              <p className="mt-3 text-lg leading-snug">{d}</p>
            </div>
          ))}
        </section>
      </main>

      <section className="bg-signal text-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-8 px-6 py-16 md:px-12 md:py-20">
          <h2 className="display text-[88px] md:text-[136px]">
            Pull the
            <br />
            string.
          </h2>
          <Link href="/explore" className="inline-flex h-16 items-center bg-ink px-9 text-lg font-extrabold hover:bg-white hover:text-ink">
            Launch app →
          </Link>
        </div>
      </section>
      <SiteFooter />
    </>
  );
}
