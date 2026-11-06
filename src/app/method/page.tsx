import type { Metadata } from "next";
import { SiteFooter } from "@/components/brand";
import { AppHeader } from "@/components/headers";

export const metadata: Metadata = { title: "Method", description: "How Redstring scans, links, scores and seals a token's holders." };

const FACTORS = [
  ["Largest linked group", "−1.5 × % of supply", "cap −40"],
  ["Deployer-linked supply", "−2 × %", "cap −25"],
  ["Launch-block buyers still holding", "−1 × %", "cap −15"],
  ["Groups with 5+ wallets", "−2 each", "cap −10"],
  ["Fresh-wallet farms (5+ wallets, one gas funder)", "−1 × %", "cap −10"],
  ["Top 10 non-exempt holders", "−0.5 × (% − 20) when above 20%", "cap −30"],
  ["Liquidity under 5% of market cap", "−10", ""],
];

function Section({ n, title, children, id }: { n: string; title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="grid grid-cols-12 gap-6 border-t-[6px] border-ink py-12">
      <div className="col-span-12 md:col-span-4">
        <div className="display text-[72px]">{n}</div>
        <h2 className="mt-3 text-3xl font-extrabold tracking-[-0.02em]">{title}</h2>
      </div>
      <div className="col-span-12 space-y-4 text-lg leading-snug md:col-span-8">{children}</div>
    </section>
  );
}

export default function MethodPage() {
  return (
    <>
      <AppHeader active="method" />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-5 md:px-12">
        <div className="py-14">
          <h1 className="display text-[96px] md:text-[136px]">Method</h1>
          <p className="mt-6 max-w-2xl text-xl leading-snug">Every number on a token page comes from the steps below. Nothing is hidden behind the score: each factor is listed with its rule.</p>
        </div>

        <Section n="01" title="Scan">
          <p>We read the token&apos;s metadata over RPC, then the top 250 holders at the latest block. Holder lists come from Blockscout when a key is set; otherwise we replay every ERC-20 Transfer log from the deploy block and compute balances ourselves.</p>
          <p>Each holder is labelled: exchange (CEX), DEX pool, burn, bridge, contract or deployer. Labels come from a seed list, explorer name tags, DexScreener pair addresses, and contracts that answer <code className="font-mono">token0()</code>.</p>
          <p>Exchange wallets tagged on any EVM chain are recognised on every chain where the address has no code: a wallet address is one private key everywhere, so it is the same exchange. Contracts are never matched across chains.</p>
          <p>Hubs no list knows are inferred. A contract that traded with 25 or more addresses is treated as a pool or router. A wallet that traded with 25 or more addresses, or paid gas for three or more holders, is treated as a likely exchange when it has sent an exchange-scale number of transactions (10,000 on Robinhood Chain, 50,000 on the other chains). Inferred labels say “inferred”.</p>
          <p className="font-mono text-xs text-g1">Name-tag data: eth-labels by dawsbot, MIT licence, github.com/dawsbot/eth-labels.</p>
        </Section>

        <Section n="02" title="Link">
          <p>Two wallets are joined by a line when one of these is true:</p>
          <ul className="space-y-3">
            <li className="grid grid-cols-[32px_1fr] gap-3">
              <i className="mt-3 block w-7 border-t-[3px] border-signal" /> They sent the token to each other.
            </li>
            <li className="grid grid-cols-[32px_1fr] gap-3">
              <i className="mt-3 block w-7 border-t-[3px] border-dashed border-signal" /> Their first native gas came from the same address.
            </li>
            <li className="grid grid-cols-[32px_1fr] gap-3">
              <i className="mt-3 block w-7 border-t-[3px] border-ink" /> They bought from a pool in the block liquidity was added.
            </li>
          </ul>
          <p>Lines are merged into groups with union-find. Exchanges, pools, routers, bridges and burn addresses are never connectors, or every holder would collapse into one group. A shared funder that paid more than 60 holders is treated as an unlabelled exchange and ignored.</p>
          <p className="font-mono text-sm">Linked means connected by on-chain activity, not proven to be one owner.</p>
        </Section>

        <Section n="03" title="Score">
          <p>Start at 100. Each factor takes points off. 70 and above is Low risk, 40–69 Moderate, under 40 High.</p>
          <table className="w-full border-collapse border-y-2 border-ink text-left">
            <tbody>
              {FACTORS.map(([f, r, c]) => (
                <tr key={f} className="border-b border-ink">
                  <td className="py-3 pr-4 font-bold">{f}</td>
                  <td className="py-3 pr-4 font-mono text-sm">{r}</td>
                  <td className="py-3 text-right font-mono text-sm text-g1">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section n="04" title="Seal">
          <p>The finished snapshot is serialised as canonical JSON (keys sorted, no whitespace) and hashed with keccak256. Pending hashes are batched into a Merkle tree; its root goes on-chain in one transaction to the AuditAnchor contract on Robinhood Chain, which emits <code className="font-mono">Anchored(root, count, timestamp)</code>.</p>
          <p>Download the snapshot JSON from a token&apos;s Seal tab and run <code className="font-mono">npm run verify -- --snapshot file.json</code> from the Redstring repo to check the hash, the Merkle proof and the on-chain event.</p>
        </Section>

        <Section n="05" title="Limits" id="terms">
          <p>Clustering is a heuristic. Two friends can share a funder; one person can use wallets that never touch. Scores are not financial advice.</p>
          <p>Every token page lists what a scan could not check (for example, gas funders when no HyperSync token is configured, or launch-block buys when only part of the transfer history was available).</p>
        </Section>

        <Section n="06" title="Dispute a label" id="dispute">
          <p>If a wallet is labelled wrong, or an exchange wallet is acting as a connector, tell us with the chain, the address and what it is. Confirmed labels are added to the seed list and apply to the next scan.</p>
        </Section>
      </main>
      <SiteFooter />
    </>
  );
}
