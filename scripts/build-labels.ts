/**
 * Builds src/lib/scan/labels.data.json from the eth-labels dataset (MIT,
 * https://github.com/dawsbot/eth-labels), which is scraped from Etherscan-family name tags.
 *
 *   curl -L -o accounts.csv https://raw.githubusercontent.com/dawsbot/eth-labels/HEAD/data/csv/accounts.csv
 *   npm run build:labels -- accounts.csv
 *
 * Output:
 *   chains["1" | "8453"]: exact per-chain labels (exchanges, bridges, DEX infrastructure).
 *   exchangeEoa: exchange wallets from *every* chain in the dataset. An EOA address is the same
 *     private key on every EVM chain, so these are applied on any chain where the address has
 *     no code (checked at scan time). Contracts are never carried across chains.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Type = "cex" | "dex" | "bridge";
const OUT_CHAINS = ["1", "8453"];

const CEX_NAME =
  /\b(binance|coinbase|kraken|okx|okex|bybit|kucoin|gate\.io|gate|mexc|bitget|htx|huobi|crypto\.com|bitfinex|bitstamp|upbit|bithumb|gemini|robinhood|poloniex|bitmart|lbank|bingx|blofin|phemex|bitvavo|bitpanda|whitebit|coinone|korbit|bitflyer|coincheck|bitso|luno|ascendex|probit|coinex|hotbit|btse|deribit|bitmex|uphold)\b/i;
// Names that mention an exchange but are not its custody wallets.
const NOT_CUSTODY = /\b(token|deployer|exploit|exploiter|hack|hacker|phish|scam|charity|campaign|pegged|staking|eth2|depositor|swap|router|wallet: swap|commerce|nft|contract|multisig 0|fake)\b/i;
const BRIDGE_CATEGORIES = new Set(["bridge", "stargate", "allbridge", "debridge", "hop-protocol", "across-protocol", "wormhole", "layerzero", "synapse", "celer-network", "multichain", "orbiter-finance"]);
const BRIDGE_NAME = /\b(bridge|gateway|portal|messenger|inbox|outbox)\b/i;
const DEX_NAME = /\b(router|pool ?manager|vault|aggregat\w*|swap router|exchange proxy|settlement|permit2)\b/i;
const DEX_CATEGORIES = new Set(["uniswap", "sushiswap", "pancakeswap", "kyberswap", "curve-fi", "balancer", "1inch", "0x-protocol", "aerodrome", "cow-protocol", "paraswap", "odos", "router", "dex"]);
const DEPOSIT = /\bdep:|deposit address/i; // per-user deposit addresses: one customer each, not custody
const SKIP = /\b(exploit|exploiter|hack|hacker|phish|scam|fake)\b/i;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") {
        cells.push(cur);
        cur = "";
      }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

function classify(category: string, name: string): Type | null {
  if (!name || SKIP.test(name) || SKIP.test(category)) return null;
  if (CEX_NAME.test(name) && !NOT_CUSTODY.test(name) && !DEPOSIT.test(name)) return "cex";
  if (/\b(token|deployer)\b/i.test(name)) return null;
  if (BRIDGE_CATEGORIES.has(category) || BRIDGE_NAME.test(name)) return "bridge";
  if (DEX_CATEGORIES.has(category) && DEX_NAME.test(name)) return "dex";
  return null;
}

const file = process.argv[2];
if (!file) {
  console.error("usage: npm run build:labels -- <accounts.csv>");
  process.exit(1);
}
const rows = parseCsv(readFileSync(file, "utf8")).slice(1);

// Some rows carry explorer-truncated addresses ("0x1985EA6E...2Fdb25c87"): resolve them
// against full addresses in the dataset when exactly one matches.
const full = new Set(rows.map((r) => r[0].toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)));
const byEnds = new Map<string, string[]>();
for (const a of full) {
  const k = `${a.slice(0, 10)}|${a.slice(-9)}`;
  byEnds.set(k, [...(byEnds.get(k) ?? []), a]);
}
function resolve(raw: string): string | null {
  const a = raw.toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(a)) return a;
  const m = a.match(/^(0x[0-9a-f]{8})\.\.\.([0-9a-f]{9})$/);
  if (!m) return null;
  const hits = byEnds.get(`${m[1]}|${m[2]}`) ?? [];
  return hits.length === 1 ? hits[0] : null;
}

const chains: Record<string, Record<string, [Type, string]>> = Object.fromEntries(OUT_CHAINS.map((c) => [c, {}]));
const exchangeEoa: Record<string, string> = {};
let unresolved = 0;
for (const [rawAddr, chainId, category, nameTag] of rows) {
  const name = (nameTag ?? "").trim();
  const type = classify(category, name);
  if (!type) continue;
  const addr = resolve(rawAddr);
  if (!addr) {
    unresolved++;
    continue;
  }
  if (chains[chainId] && !chains[chainId][addr]) chains[chainId][addr] = [type, name];
  // Prefer the Ethereum name when an exchange wallet is tagged on several chains.
  if (type === "cex" && (!exchangeEoa[addr] || chainId === "1")) exchangeEoa[addr] = name;
}

const sortObj = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
const out = {
  source: "eth-labels (MIT) https://github.com/dawsbot/eth-labels",
  generated: new Date().toISOString().slice(0, 10),
  chains: Object.fromEntries(OUT_CHAINS.map((c) => [c, sortObj(chains[c])])),
  exchangeEoa: sortObj(exchangeEoa),
};
const dest = join(import.meta.dirname, "../src/lib/scan/labels.data.json");
writeFileSync(dest, JSON.stringify(out) + "\n");
const count = (c: string, t: Type) => Object.values(chains[c]).filter(([x]) => x === t).length;
for (const c of OUT_CHAINS) console.log(`chain ${c}: cex ${count(c, "cex")}, bridge ${count(c, "bridge")}, dex ${count(c, "dex")}`);
console.log(`exchange EOAs (cross-chain): ${Object.keys(exchangeEoa).length}; unresolved truncated: ${unresolved}`);
console.log(`wrote ${dest}`);
