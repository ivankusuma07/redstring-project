import { ArrowUpRight } from "lucide-react";
import { CHAINS, addressUrl, txUrl } from "@/lib/chains";
import { shortAddr, utcStamp } from "@/lib/format";
import type { StoredSnapshot } from "@/lib/types";
import { StringMark } from "../brand";

const short = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-8)}` : "—");

export function SealTab({ rec }: { rec: StoredSnapshot }) {
  const { snapshot: s, seal } = rec;
  const sealed = seal.status === "sealed";
  const rh = CHAINS.robinhood;
  const fileName = `${s.token.symbol.toLowerCase()}-${s.blockNumber}.json`;
  const download = `/api/snapshot/${s.chain}/${s.example ? "example" : s.token.address}`;

  const heading = sealed ? "Sealed." : seal.status === "pending" ? "Sealing." : seal.status === "example" ? "Example." : "Hashed.";
  const badge = sealed ? "Verified on-chain" : seal.status === "pending" ? "Queued for the next batch" : seal.status === "example" ? "Example data · never sealed" : "Not anchored";
  const body = sealed
    ? `This map was hashed and written to ${rh.name}. Anyone can prove what it showed at block ${s.blockNumber.toLocaleString("en-US")}, and that it hasn't been edited since.`
    : seal.status === "pending"
      ? `This map has been hashed. The hash joins the next Merkle batch anchored on ${rh.name}; the transaction appears here once it confirms.`
      : seal.status === "example"
        ? "This is an illustrative token, so nothing is anchored on-chain. Real scans are hashed and batched into an anchor transaction on Robinhood Chain."
        : "This map has been hashed, but this deployment has no anchor contract configured, so it is not written on-chain yet. You can still check the hash yourself.";

  return (
    <section className="px-5 py-10 md:px-12">
      <div className="grid grid-cols-12 gap-x-6 gap-y-10">
        <div className="col-span-12 lg:col-span-6">
          <div className="flex items-center gap-5">
            <StringMark className="size-16" />
            <span className={`border-2 px-4 py-2 font-mono text-sm ${sealed ? "border-ink" : "border-g2 text-g1"}`}>{badge}</span>
          </div>
          <h2 className="display mt-8 text-[96px] md:text-[136px]">{heading}</h2>
          <p className="mt-8 max-w-[640px] text-xl leading-snug md:text-[22px]">{body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={download} download={fileName} className="inline-flex h-14 items-center bg-ink px-7 font-extrabold text-white hover:bg-signal">
              Download snapshot JSON
            </a>
            {sealed && seal.txHash && (
              <a href={txUrl("robinhood", seal.txHash)} target="_blank" rel="noreferrer" className="inline-flex h-14 items-center gap-1 border-2 border-ink px-7 font-extrabold hover:bg-ink hover:text-white">
                View anchor tx <ArrowUpRight className="size-4" />
              </a>
            )}
          </div>
        </div>
        <dl className="col-span-12 border-y-[6px] border-ink lg:col-span-5 lg:col-start-8">
          <Row label="Snapshot block" big>
            {s.blockNumber.toLocaleString("en-US")} · {CHAINS[s.chain].name}
          </Row>
          <Row label="Snapshot hash (keccak256)">
            <span title={seal.snapshotHash}>{short(seal.snapshotHash)}</span>
          </Row>
          <Row label={`Batch Merkle root${seal.batchCount ? ` · ${seal.batchCount} snapshot${seal.batchCount === 1 ? "" : "s"}` : ""}`}>{short(seal.merkleRoot)}</Row>
          <Row label="Anchor transaction">
            {seal.txHash ? (
              <a href={txUrl("robinhood", seal.txHash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {shortAddr(seal.txHash)} ↗
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Anchor contract">
            {seal.contract ? (
              <a href={addressUrl("robinhood", seal.contract)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                AuditAnchor · {shortAddr(seal.contract)} ↗
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Sealed" big last>
            {seal.sealedAt ? utcStamp(seal.sealedAt) : "—"}
          </Row>
        </dl>
      </div>

      <div className="mt-14 grid grid-cols-12 gap-6 border-t-[6px] border-ink pt-10">
        <h2 className="display col-span-12 text-[44px] md:text-[52px] lg:col-span-5">Verify it yourself</h2>
        <ol className="col-span-12 grid grid-cols-1 gap-x-7 gap-y-10 sm:grid-cols-2 lg:col-span-7">
          {[
            "Download the snapshot JSON.",
            "Hash it with keccak256. It must match the snapshot hash.",
            "Apply the Merkle proof. You get the batch root.",
            <>
              Find that root in the tx&apos;s <code className="font-mono">Anchored</code> event.
            </>,
          ].map((t, i) => (
            <li key={i} className={`border-t-2 pt-3 ${i === 3 ? "border-signal" : "border-ink"}`}>
              <div className={`display text-[56px] ${i === 3 ? "text-signal" : ""}`}>0{i + 1}</div>
              <p className="mt-3 text-xl leading-snug">{t}</p>
            </li>
          ))}
        </ol>
      </div>
      <pre className="mt-10 overflow-x-auto bg-ink px-7 py-6 font-mono text-sm leading-7 text-white">
        {`npm run verify -- --snapshot ${fileName}${seal.txHash ? ` --tx ${shortAddr(seal.txHash)}` : ""} --chain ${rh.id}\n`}
        {sealed ? "✓ snapshot hash matches   ✓ proof valid   ✓ root found in Anchored event" : "✓ snapshot hash matches   · not anchored yet"}
      </pre>
      <p className="mt-3 font-mono text-xs text-g1">Run from a checkout of the Redstring repo (scripts/verify.ts). Hashing uses canonical JSON (keys sorted, no whitespace) of the &quot;snapshot&quot; object in the download.</p>
    </section>
  );
}

function Row({ label, children, big, last }: { label: string; children: React.ReactNode; big?: boolean; last?: boolean }) {
  return (
    <div className={`py-5 ${last ? "" : "border-b border-ink"}`}>
      <dt className="font-mono text-xs">{label}</dt>
      <dd className={`mt-1.5 ${big ? "text-[26px] font-extrabold tracking-[-0.02em]" : "font-mono text-lg"}`}>{children}</dd>
    </div>
  );
}
