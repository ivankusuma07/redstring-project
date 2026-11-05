# Project Brief: REDSTRING — On-Chain Supply Cluster Map

> Name: **REDSTRING**. Tagline: *"Pull the string."* (GiwaMaps-style product, own brand.)
> Reference: https://giwamaps.com (checked 4 Nov 2026)

---

## 1. What the reference is

GiwaMaps is a **token supply auditing tool**. You paste a contract address or ticker, and it draws the token's top holders as a **bubble / force-directed graph**. Wallets that have sent tokens to each other are grouped into **clusters**, so you can see when 15 "separate" holders are really one insider, sniper group, or wash-trading ring.

It's the same idea as Bubblemaps, re-skinned. It also has its own token: **GIWAS on Robinhood Chain** (1B supply, roughly $77k FDV at the time of checking).

**What it claims to do**
- **Clustering:** groups wallets that moved tokens between each other, using Disjoint-Set Union (DSU / union-find)
- **Insider / Sybil risk score:** a 0–100 decentralization score, a risk badge (LOW / MODERATE / HIGH), and the % of supply held by top clusters
- **Live market data:** price, market cap, DEX liquidity and 24h volume from DexScreener plus RPC
- **Ingestion:** block-scanner workers read ERC-20 `Transfer` logs; historical graphs are archived in MySQL
- **Graph:** force-directed, fullscreen, with a minimap and filters to hide CEX, DEX and burn wallets
- **Chains:** 14 listed (Ethereum, Base, BNB, Arbitrum, Polygon, Optimism, Avalanche, Linea, Scroll, Blast, Sonic, Mantle, Robinhood Chain, TON). The stats block says "13 chains" and the app UI only shows Ethereum, so real coverage is probably much smaller than the marketing.

**Site structure**
1. Nav: Map · Explore Tokens · Features · How It Works · Launch App
2. Hero: headline, chain list, "Explore Map" button, trending token chips, sample graph (Deployer 2.8%, Whale Syndicate 4.1%, CEX Hot 6.5%, Uniswap Pool 9.2%, Sniper Cluster 1.7% → "Cluster Concentration 14.8% — moderate risk")
3. Stats strip (tokens scanned, Sybil clusters found, graphing speed)
4. Features grid
5. Live token directory (Meme / DeFi / Infra / Gaming / L2 tags)
6. How it works (Search → Map → Inspect)
7. Final call to action and footer

**App screen:** header with network selector, ⌘K search and a "Sync On-Chain" button → token summary (name, short contract address, decentralization score, risk badge) → stat cards (price, market cap, liquidity, holders) → tabs **Clusters / Holders / Risk Audit** → CEX/DEX/Burn toggles → graph canvas with a minimap and a holders side panel.

**Weak spots we can beat**
- The marketing makes big claims, but the app only works on one chain
- Stats don't line up (13 vs 14 chains) and nothing backs up figures like "0.02s graphing"
- No pricing, no shareable output and no clear reason to hold the token
- "Sent tokens to each other" is the only clustering signal. Real insiders often fund wallets with **native gas** from one source rather than sending the token directly.

---

## 2. Our product: positioning

**One line:** *Paste a token. See who really owns it in 5 seconds. Share the receipt.*

Differentiators:
1. **Three chains, done properly.** Launch with Robinhood Chain (home chain), Base and Ethereum, all fully working, instead of claiming 14.
2. **Better clustering.** Link wallets by token transfers **plus** shared funding source (native ETH), same-block buys and shared CEX deposit addresses.
3. **On-chain "Audit Receipts."** Each scan's snapshot hash is anchored on Robinhood Chain with a tx hash, so anyone can prove what the map showed at block N. This is cheap and verifiable, and it's something the reference doesn't do.
4. **Shareable cards.** An OG image per token map (score, top-cluster %, graph thumbnail) for posting on X.
5. **Watchlist alerts** (phase 2): notify when a tracked cluster moves supply.

---

## 3. MVP scope (v1)

### Must have
- [ ] Landing page (own layout, not a copy of the reference's section order)
- [ ] Search by contract address, plus ticker search on supported chains (⌘K palette)
- [ ] Token page `/[chain]/[address]`:
  - Header: name, symbol, logo, short contract address with copy and explorer link
  - Stat cards: price, 24h change, market cap, liquidity, holders
  - Decentralization score (0–100) and risk badge
  - **Graph tab:** top 250 holders as bubbles sized by balance and colored by cluster, with links between connected wallets
  - **Holders tab:** sortable table (rank, address, label, balance, % supply, cluster)
  - **Risk Audit tab:** score breakdown (see §5)
  - Filters: hide CEX / DEX pools / burn / contracts
  - Click a node → side panel with address, label, balance, cluster members, first funder, explorer link
  - Fullscreen mode and minimap
- [ ] "Rescan" button, rate-limited and cached
- [ ] Explore page: trending and recently scanned tokens with category tags
- [ ] Audit Receipt: anchor the snapshot hash on Robinhood Chain and show the tx hash on the token page
- [ ] Share card (dynamic OG image)

### Later (v2+)
- Time slider (replay the map at past blocks)
- Watchlists and alerts (Telegram / X bot)
- Extra chains
- Public API and embeddable widget
- Token utility (see §8)

### Out of scope for v1
- TON (non-EVM, separate indexer; skip)
- Full-history indexing of every token (scan on demand only)

---

## 4. How the scan works

```
User submits (chain, tokenAddress)
        │
        ▼
1. Cache check (snapshot < 15 min old?) ──yes──► return cached graph
        │ no
        ▼
2. Fetch token metadata (name, symbol, decimals, totalSupply) via RPC
3. Fetch top N holders (N = 250)
     - Preferred: Blockscout PRO /tokens/{addr}/holders (5 pages × 50)
     - Fallback: HyperSync Transfer replay from deploy block → compute balances
4. Label holders: CEX hot wallets, DEX pairs/pools, burn (0x0, 0xdead),
   contracts (eth_getCode), deployer
5. Build edges between holders:
     a. Token transfers between holders (Transfer logs, from/to both in set)
     b. Shared native funder (first incoming ETH tx to each wallet)
     c. Bought in the same block as the first liquidity add (sniper signal)
6. DSU / union-find over edges (exclude CEX/DEX/burn as "connectors")
7. Compute cluster stats + risk score
8. Fetch market data (DexScreener)
9. Persist snapshot (JSON graph + stats), hash it (keccak256)
10. Queue anchor tx on Robinhood Chain (batch hashes to save gas)
        │
        ▼
Return graph to client
```

**Important rule:** never use CEX hot wallets, DEX pools, routers or burn addresses as connectors, or the whole graph collapses into one giant cluster.

**DSU sketch**
```ts
const parent = new Map<string, string>();
const find = (x: string): string => {
  if (!parent.has(x)) parent.set(x, x);
  const p = parent.get(x)!;
  if (p === x) return x;
  const r = find(p); parent.set(x, r); return r;
};
const union = (a: string, b: string) => {
  const ra = find(a), rb = find(b);
  if (ra !== rb) parent.set(ra, rb);
};
for (const e of edges) if (!isExcluded(e.from) && !isExcluded(e.to)) union(e.from, e.to);
```

Keep the **edge type** on each link (`transfer` | `funder` | `same-block`) so the UI can explain *why* wallets are grouped. That explanation is a key trust feature.

---

## 5. Risk score (v1 formula, tune later)

Score starts at 100 (fully decentralized) and loses points:

| Factor | Example penalty |
|---|---|
| Largest non-exempt cluster % of supply | −1.5 × pct (cap −40) |
| Top 10 non-exempt holders combined % | −0.5 × (pct − 20) if > 20 |
| Deployer-linked cluster % | −2 × pct (cap −25) |
| Sniper cluster % (bought in launch block) | −1 × pct (cap −15) |
| Number of clusters with ≥ 5 wallets | −2 each (cap −10) |
| Liquidity < 5% of market cap | −10 |

Badge: **≥ 70 LOW**, **40–69 MODERATE**, **< 40 HIGH**.
Show the breakdown in the Risk Audit tab so the number is never a black box.

---

## 6. Tech stack

| Layer | Choice |
|---|---|
| Web | **Next.js 16** (latest stable, 16.4.x as of Oct 2026; App Router, React 19) + TypeScript, deployed on **Vercel**. Pin the exact version at scaffold time (`npx create-next-app@latest`) |
| Chains (v1) | **Robinhood Chain, Base, Ethereum**: one Blockscout PRO key covers all three by `chain_id` (4663 / 8453 / 1); HyperSync and DexScreener cover all three too |
| UI | Tailwind, **React Bits** for motion/hero effects, **Lucide** icons, shadcn/ui primitives |
| Graph rendering | **sigma.js + graphology** (WebGL, handles 250–1000 nodes smoothly) with ForceAtlas2 in a Web Worker. Simpler alternative: `react-force-graph-2d` |
| API / workers | Node (Fastify or Hono) + **BullMQ** job queue, deployed on **Railway** |
| Database | Postgres (Railway) for tokens, snapshots, labels and anchors; Redis for cache and queue |
| Chain access | `viem` for RPC calls and log reads; one RPC provider per chain |
| Holder data | **Blockscout PRO API** (free key), `GET /{4663}/api/v2/tokens/{addr}/holders` |
| Transfer logs (edges) | **Envio HyperSync** (`robinhood.hypersync.xyz`, free token): full-history Transfer logs in seconds |
| Funder lookup | Blockscout address txs, or GoldRush "earliest wallet transactions" |
| Market data | DexScreener public API |
| Anchoring | Small contract on Robinhood Chain: `anchor(bytes32 root)` emits `Anchored(root, timestamp)`. Merkle-batch many snapshot hashes into one tx |
| OG images | `@vercel/og` |
| Testing | **Playwright** e2e (search → map renders → node click → share card), with recorded runs saved |

### Robinhood Chain data sources (checked 4 Nov 2026)

| Provider | Top-holder list? | Cost | Notes |
|---|---|---|---|
| **Blockscout** (official explorer) | ✅ holders sorted by balance | Free key, 100K credits/day | 50 per page via `next_page_params`; includes `is_contract` and public tags (free labels). Its `eth_getLogs` is capped at 1,000 records on this chain, so don't use it for log replay |
| **Etherscan / RobinScan** (robin.etherscan.io) | ✅ `topholders`, up to 1,000 | Paid only (Standard+), 2 calls/s | Chain 4663 is in Etherscan's V2 chain list but marked paid-plan only. Best upgrade path; also has CEX name tags |
| **Envio HyperSync** | ➖ compute it yourself | Free API token | Very fast full-history logs. Replay Transfers → balances. Ideal for edges and as a holders fallback |
| **Codex** | ✅ `holders`, 200 per page | Growth plan+ (paid) | Docs say it may only track wallets that swapped. Useful `top10HoldersPercent` |
| **GoldRush** | ❌ not on Robinhood's endpoint list | Paid credits | Has balances, transfers, earliest txs and event logs |
| **Alchemy** | ❌ no holder-list product | Free tier | Good RPC/WebSocket |
| **Dune** | ➖ via SQL on `erc20_robinhood` tables | Free tier | Cross-checking and prototyping, not live |

**Plan:** Blockscout for holders and labels → HyperSync for Transfer edges, launch-block snipers and the holders fallback → RPC (Alchemy or public `rpc.mainnet.chain.robinhood.com`) for `eth_call` / `getCode`. Add Etherscan PRO once there's revenue, to get 1,000-holder scans and better CEX tags.

**Budget math (Blockscout free):** 250 holders = 5 pages ≈ 100 credits at the default 20 credits/call, so holders alone allow about 1,000 scans per day. Funder lookups (1 call per wallet) are the expensive part, so source funder edges from HyperSync where possible and cache them per wallet.

### Anchor contract (minimal)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AuditAnchor {
    address public immutable writer;
    event Anchored(bytes32 indexed root, uint256 count, uint256 timestamp);

    constructor(address _writer) { writer = _writer; }

    function anchor(bytes32 root, uint256 count) external {
        require(msg.sender == writer, "not writer");
        emit Anchored(root, count, block.timestamp);
    }
}
```
Events only, no storage, so gas stays as low as possible. Batch anchors every X minutes or every N snapshots.

---

## 7. Data model (Postgres)

```
tokens        (id, chain, address, name, symbol, decimals, logo, category, deploy_block, deployer)
snapshots     (id, token_id, block_number, created_at, holder_count, score, risk_level,
               top_cluster_pct, graph_json, snapshot_hash, anchor_id)
labels        (chain, address, label, type[cex|dex|burn|contract|deployer|bridge], source)
anchors       (id, merkle_root, tx_hash, block_number, count, created_at)
scan_jobs     (id, token_id, status, error, started_at, finished_at)
```

`graph_json` = `{ nodes: [{id, balance, pct, label, type, cluster}], links: [{source, target, kind, amount}], clusters: [{id, size, pct, members}] }`

---

## 8. Business model & token ($STRING)

**Decision: copy the GiwaMaps model.**
- The tool is **free and open**: no login, no wallet connect, no paywall, no pricing page.
- A separate community token, **$STRING**, trades on Robinhood Chain (GiwaMaps does the same with GIWAS, 1B supply, all circulating).
- The token is not wired into the product at launch.

Keep the door open for v2 utility without changing the free core:
- Holder perks: alerts, the time-slider, 1,000-holder deep scans
- Revenue (if any) → buybacks

Rules for our own token (people *will* scan it on REDSTRING first):
- Clean launch: no hidden team wallets, and the team allocation (if any) sits in one public, labelled, locked wallet
- Lock liquidity and link the lock on the site
- Pin the official $STRING case on the Explore page

Open: launch venue on Robinhood Chain, supply and team allocation. Also check the ticker on Blockscout and DexScreener before deploying; `RSTR` (taken on Robinhood Chain) and `RED` (RedStone) are both out.

---

## 9. Design direction

**Decision: Direction B — Swiss Forensic.** A light, typographic, poster-grid look, deliberately unlike GiwaMaps's dark crypto-dashboard style. (Mockups: the "REDSTRING design directions" canvas, artboard B.)

- **Palette:** white `#FFFFFF` ground, ink `#0A0A0A`, a single signal red `#D10600`. Greys `#595959 / #9A9A9A / #CFCFCF` are for exempt wallets (CEX/DEX/burn). Red is never decoration: it only marks links, linked groups and high risk.
- **Typography:** Schibsted Grotesk (huge, tight, heavy headlines; medium UI text) + JetBrains Mono for addresses, labels and numbers.
- **Grid:** strict 12 columns, 24 px gutters, thick 6 px section rules, big numbered sections (01 / 02 / 03). No gradients, no glow, no rounded cards; square corners everywhere.
- **Signature element:** one red line connecting two black dots, used in the logo, hero, loaders and share cards.
- **Supply bar:** a horizontal stacked bar (linked groups → exempt → free float) on every token page, next to the graph. It's the fastest read of a token.
- **Graph style:** black dots sized by balance, red straight-ish lines for links (dashed = shared funder), grey hollow rings for exempt wallets, and a white background with no glow.
- **Mascot: a crow.** It's a flat, geometric black silhouette with one red eye or a red string in its beak. Crows are famously smart, remember faces and collect shiny things, which suits a tool that remembers wallets. A one-color crow also sits naturally on the Swiss black/white/red palette; a raccoon needs greys and fur detail that would clash with it. Use it sparingly: empty states, loading ("pulling the string…"), 404, share cards and the X avatar.
- **Vocabulary:** Scan · Link · Seal. "Linked group" (not "insider"), "Free float", "Sealed at block N".
- **Copy tone:** short, flat, factual ("No line, no link."). No hype words.
- **The graph is the hero:** a live, slowly settling sample map on the landing page, not a static screenshot.
- Every number gets a tooltip explaining how it was computed.
- **Mobile:** the graph is view-only with pinch zoom; the holders table and supply bar are the main mobile view.
- Before launch: check that the domain (redstring.xyz / .app / .fun) and X handle are free.

---

## 10. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | Scan engine (CLI) | Given a Base/Robinhood Chain token, outputs graph JSON + score |
| M2 | API + queue + cache | `POST /scan`, `GET /token/:chain/:addr` work on Railway |
| M3 | Graph UI | Token page renders 250 nodes smoothly; node panel and filters work |
| M4 | Landing + Explore + search | Public pages live on Vercel |
| M5 | Audit anchoring | Contract deployed; snapshots show a tx hash |
| M6 | Share cards + polish | OG images, Playwright suite green |
| M7 | Launch | Seed Explore with 30–50 popular Robinhood Chain / Base tokens |

---

## 11. Budget (lean)

- Vercel free tier (web) + Railway Hobby (API, worker, Postgres, Redis)
- Free or entry-tier RPC and indexer plans; cache heavily (15-min snapshot TTL, popular tokens pre-warmed)
- Anchoring: batched, events only, so cost is a few cents per day on an L2

---

## 12. Risks and notes

- **False positives:** clustering is a heuristic. The UI must say "linked by on-chain activity," not "same owner." Add a disclaimer and show the edge reasons.
- **Label quality** decides graph quality. Seed CEX/DEX/bridge labels early and allow manual overrides from the admin side.
- **RPC limits:** log replay on big tokens is expensive. Limit the block range and prefer indexer holder lists.
- **Don't reuse** GiwaMaps (or Bubblemaps) name, logo, copy or layout. Same category, own identity.
