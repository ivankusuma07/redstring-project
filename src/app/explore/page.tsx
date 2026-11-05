import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/brand";
import { AppHeader } from "@/components/headers";
import { categoryOf } from "@/lib/categories";
import { exampleRecord } from "@/lib/service";
import { rowOf, store } from "@/lib/store";
import { ExploreTable, type Row } from "./explore-table";

export const metadata: Metadata = { title: "Explore", description: "Recently scanned tokens across Robinhood Chain, Base and Ethereum." };

async function Rows() {
  await connection();
  const recent = await store()
    .recent(300)
    .catch(() => []);
  const ex = rowOf(exampleRecord());
  const rows: Row[] = [...recent, ex].map((r) => ({
    chain: r.chain,
    address: r.address,
    href: r.id === "example" ? "/robinhood/example" : `/${r.chain}/${r.address}`,
    symbol: r.symbol,
    score: r.score,
    level: r.level,
    largest: r.largest,
    linked: r.linked,
    exempt: r.exempt,
    holders: r.holders,
    scannedAt: r.scannedAt,
    category: categoryOf(r.chain, r.address),
    example: r.id === "example",
  }));
  return <ExploreTable rows={rows} pinned={<Pinned />} />;
}

function Pinned() {
  const addr = process.env.NEXT_PUBLIC_STRING_ADDRESS;
  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-b-2 border-ink px-5 py-6 md:px-12">
      <span className="bg-signal px-3 py-2 font-mono text-xs font-bold text-white">PINNED · OFFICIAL</span>
      <span className="display text-[40px]">$STRING</span>
      <span className="font-mono text-sm">Robinhood Chain · Our own token, scanned like any other.</span>
      {addr ? (
        <Link href={`/robinhood/${addr}`} className="ml-auto font-mono text-sm hover:text-signal">
          Open the map →
        </Link>
      ) : (
        <span className="ml-auto font-mono text-sm text-g1">[Score after launch] →</span>
      )}
    </div>
  );
}

export default function ExplorePage() {
  return (
    <>
      <AppHeader active="explore" />
      <main className="mx-auto w-full max-w-[1600px] flex-1">
        <div className="grid grid-cols-12 items-end gap-6 px-5 pt-14 pb-10 md:px-12">
          <h1 className="display col-span-12 text-[96px] md:col-span-7 md:text-[136px]">Explore</h1>
          <p className="col-span-12 text-xl leading-snug md:col-span-5">
            Recently scanned tokens across three chains.
            <br />
            Sorted by most recent scan.
          </p>
        </div>
        <Suspense fallback={<div className="px-5 py-10 font-mono text-sm md:px-12">Loading scans…</div>}>
          <Rows />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
