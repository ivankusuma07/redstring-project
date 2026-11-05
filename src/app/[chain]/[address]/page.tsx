import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/headers";
import { ScanLoading, ScanRunner } from "@/components/token/scan-runner";
import { isChainKey } from "@/lib/chains";
import { FEATURED_HREF } from "@/lib/featured";
import { isAddress } from "@/lib/format";
import { getStored } from "@/lib/service";

type Props = PageProps<"/[chain]/[address]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chain, address } = await params;
  if (!isChainKey(chain)) return {};
  const rec = await getStored(chain, address).catch(() => null);
  if (!rec) return { title: "Scanning token" };
  const s = rec.snapshot;
  const title = `$${s.token.symbol}: ${s.score.value}/100`;
  const description = `${s.supply.linked.toFixed(1)}% linked · ${s.supply.exempt.toFixed(1)}% exempt · ${s.supply.free.toFixed(1)}% free float. ${s.clusters.length} linked groups.`;
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

async function TokenLoader({ params }: Pick<Props, "params">) {
  const { chain, address } = await params;
  const addr = address.toLowerCase();
  if (addr === "example") redirect(FEATURED_HREF); // the old illustrative sample now points at a real token
  if (!isChainKey(chain) || !isAddress(addr)) notFound();
  const initial = await getStored(chain, addr);
  return <ScanRunner chain={chain} address={addr} initial={initial} />;
}

export default function TokenPage({ params }: Props) {
  return (
    <>
      <AppHeader />
      <Suspense fallback={<ScanLoading />}>
        <TokenLoader params={params} />
      </Suspense>
    </>
  );
}
