/**
 * M1 CLI: scan a token and print the score and linked groups.
 *   npm run scan -- robinhood 0x…          summary
 *   npm run scan -- robinhood 0x… --json   full snapshot (graph JSON)
 */
import { isChainKey } from "../src/lib/chains";
import { analyze } from "../src/lib/scan/analyze";
import { collect } from "../src/lib/scan/collect";

async function main() {
  const [chain, address, flag] = process.argv.slice(2);
  if (!chain || !address || !isChainKey(chain)) {
    console.error("usage: npm run scan -- <robinhood|base|ethereum> <tokenAddress> [--json]");
    return 2;
  }
  const raw = await collect(
    chain,
    address,
    (e) => {
      if (e.type === "stage")
        process.stderr.write(`· ${e.stage} ${e.status}${e.detail ? ` (${e.detail})` : ""}${e.progress != null ? ` ${Math.round(e.progress * 100)}%` : ""}\n`);
    },
    { budgetMs: 280_000 },
  );
  const s = analyze(raw);
  if (flag === "--json") {
    console.log(JSON.stringify(s, null, 2));
    return 0;
  }
  console.log(`\n$${s.token.symbol} · ${s.token.name} · block ${s.blockNumber} · ${s.token.holderCount ?? "?"} holders`);
  console.log(`score ${s.score.value}/100 ${s.score.level}: ${s.score.summary}`);
  console.log(`supply: linked ${s.supply.linked}% · exempt ${s.supply.exempt}% · free ${s.supply.free}%`);
  for (const c of s.clusters.slice(0, 10)) console.log(`  Group ${c.id}: ${c.pct}% · ${c.size} wallets · ${c.kinds.join("+")} · ${c.title}`);
  for (const f of s.score.factors) console.log(`  ${f.label.padEnd(28)} ${f.value.padStart(7)}  ${f.points}`);
  console.log(`sources: ${s.sources.join(", ")}`);
  for (const l of s.limits) console.log(`note: ${l}`);
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e.message ?? e);
    process.exit(1);
  },
);
