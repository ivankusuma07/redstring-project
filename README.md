# Redstring

*Pull the string.* Token supply forensics for **Robinhood Chain, Base and Ethereum**. Paste a token, see who really holds it, share the receipt.

Product brief: [`redstring-brief.md`](redstring-brief.md) · UI reference: [`REDSTRING-swiss-forensic-screens.pdf`](REDSTRING-swiss-forensic-screens.pdf) (Direction B, Swiss Forensic).

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

You don't need any keys to start. `/robinhood/example` shows an illustrative `$EXAMPLE` token. A real address scans live: without keys, holders are computed by replaying the token's `Transfer` logs over public RPC. This works well on Robinhood Chain, where the public RPC allows 10M-block log windows. Large tokens, and Base/Ethereum (where public RPCs cap log ranges), need `BLOCKSCOUT_API_KEY` and/or `HYPERSYNC_TOKEN`. See [`.env.example`](.env.example).

| Script | What it does |
|---|---|
| `npm run scan -- robinhood 0x…` | **M1 CLI.** Scans a token and prints the score and groups (`--json` prints the full graph) |
| `npm run verify -- --snapshot file.json` | Checks a downloaded snapshot: hash, Merkle proof, `Anchored` event |
| `npm run build && npm run test:e2e` | Playwright suite (search → map → node click → share card). Videos go to `e2e-results/` |
| `npm run typecheck` / `npm run lint` | |

## How a scan works

```
POST /api/scan {chain,address}  → NDJSON progress stream
  cache (15 min) ─hit→ done
  RPC metadata → holders (Blockscout | HyperSync replay | RPC log replay)
  labels: seed list, explorer tags, DexScreener pairs, token0() pools, high-fan-out contracts
  edges: token transfers · shared gas funder (HyperSync) · launch-block buys
  DSU over edges (CEX/DEX/burn/bridge never connect) → clusters → score (§5)
  keccak256(canonical JSON) → store → Merkle batch → AuditAnchor on Robinhood Chain
```

The engine is framework-free and lives in `src/lib/scan/`: `collect.ts` does the I/O and `analyze.ts` is a pure function that does clustering, supply split and score. The `$EXAMPLE` token runs through the same `analyze()`.

## Layout

```
src/app/                      pages: / · /explore · /method · /[chain]/[address] (+ opengraph-image)
src/app/api/                  scan (stream) · search · snapshot download · seal/flush (cron)
src/components/graph/         canvas + d3-force holder map (minimap, zoom/pinch, fullscreen)
src/components/token/         header, Map / Holders / Risk audit / Seal tabs, mobile overview, share dialog
src/lib/scan/                 engine + sources (rpc, blockscout, hypersync, dexscreener) + labels
src/lib/seal/                 canonical hash, Merkle tree, anchor tx
src/lib/store.ts              Postgres (DATABASE_URL) or JSON files
contracts/AuditAnchor.sol     events-only anchor contract
```

## Deviations from the brief (v1)

- **One Next.js app, no separate Railway API/BullMQ yet.** Scans run in a streaming route handler (`maxDuration` 300s) with in-process dedupe and per-client rate limits. The engine is isolated, so moving it to a worker later is a transport change only.
- **Graph uses Canvas 2D + d3-force instead of sigma.js.** The design needs hollow grey rings, square contract markers, dashed funder lines and in-canvas group labels. A custom canvas renderer does that directly, and 250 nodes is well within its range.
- **Shared-funder links need `HYPERSYNC_TOKEN`.** Without it, scans say so in their "not checked" notes, and the Risk audit shows "Funders not checked".
- **Sealing needs a deployed `AuditAnchor`** plus `ANCHOR_CONTRACT`/`ANCHOR_PRIVATE_KEY`. Until then snapshots are hashed and show "Not anchored", never a fake tx. Batches flush after a scan when full or older than `SEAL_MAX_WAIT_MIN`, and also via a daily cron (Vercel Hobby limit).
- **The verify CLI is `npm run verify`.** It is not published to npm yet (`bin` is set for when it is).
- Explore categories come from a curated map (`src/lib/categories.ts`), because there is no on-chain source for "Meme vs DeFi".

## Before launch

Deploy `AuditAnchor` on Robinhood Chain, set Postgres, seed CEX/bridge labels for Robinhood Chain and Base (`src/lib/scan/labels.ts` / `LABELS_JSON`), set `NEXT_PUBLIC_STRING_ADDRESS`, and confirm the domain and X handle are free.
