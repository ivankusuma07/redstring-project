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
  labels: seed list, eth-labels name tags (cross-chain for exchange EOAs), explorer tags,
          DexScreener pairs, token0() pools, inferred hubs (fan-out + nonce)
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

Deploy `AuditAnchor` on Robinhood Chain, set Postgres, add Robinhood Chain exchange wallets as they become known (`src/lib/scan/labels.ts` / `LABELS_JSON`; few are public yet), set `NEXT_PUBLIC_STRING_ADDRESS`, and confirm the domain and X handle are free.

## Labels

Exchange / bridge / DEX labels decide whether a map is honest: one unlabelled exchange wallet can
merge hundreds of unrelated holders. Sources, in order:

1. `LABELS_JSON` env, then the hand-checked `SEED` in `src/lib/scan/labels.ts`.
2. `src/lib/scan/labels.data.json`, built from [eth-labels](https://github.com/dawsbot/eth-labels)
   (MIT, Etherscan-family name tags): per-chain labels for Ethereum and Base, plus ~2,800 exchange
   wallets from every chain, applied anywhere the address has no code. Per-user deposit addresses
   are excluded. Rebuild:

   ```bash
   curl -L -o accounts.csv https://raw.githubusercontent.com/dawsbot/eth-labels/HEAD/data/csv/accounts.csv
   npm run build:labels -- accounts.csv
   ```

3. Inference (`inferHubs`): contracts with ≥25 transfer peers become "Pool / router (inferred)";
   wallets with ≥25 peers or that funded ≥3 holders become "likely exchange (inferred)" when their
   nonce is ≥10k (Robinhood Chain) / ≥50k (Base, Ethereum). Override with `HOT_WALLET_NONCE`.

`npm test` checks that labelled and inferred exchanges never link holders.

## Deploy (Vercel frontend + VPS backend)

```
browser ──► Vercel (Next.js pages, OG images)      BACKEND_URL / NEXT_PUBLIC_API_URL
   │            └─ HttpStore: GET /api/tokens/…, /api/explore ──┐
   └─ POST /api/scan (NDJSON, CORS) ───────────────────────────►├─ VPS: Caddy (TLS) ─► redstring-api (Next standalone)
                                                                 │                        ├─ postgres (own volume)
                                                                 │                        └─ cron: seal flush + pg_dump daily
```

- **Frontend** (Vercel project `redstring`): `vercel deploy --prod`. Env: `BACKEND_URL`,
  `NEXT_PUBLIC_API_URL` (both the backend origin), `NEXT_PUBLIC_SITE_URL`. With `BACKEND_URL` set the
  app has no database; it reads through the backend and never scans or seals.
- **Backend** (VPS, `~/redstring`): `cd deploy && cp .env.example .env` (fill in), then
  `docker compose up -d --build`. The API joins the existing Caddy's `edge` network as
  `redstring-api`. Only `/api/*` is public. `CORS_ORIGINS` must list the Vercel origin(s).
- **Caddy, one file per project:** the shared edge Caddy (owned by mochipump) imports
  `/etc/caddy/sites/*.caddy`, mounted read-only from `~/caddy-sites` on the host. REDSTRING's site is
  `deploy/Caddyfile`, installed with `install -m 644 deploy/Caddyfile ~/caddy-sites/redstring.caddy`
  and applied with `docker exec mochipump-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile`.
  Host: `redstring.43-134-68-64.sslip.io` (the bare sslip.io host belongs to mochipump).
- Update the backend: upload the tree to `~/redstring`, then `docker compose up -d --build api`.

## Data sources per chain

| | Robinhood Chain | Base | Ethereum |
|---|---|---|---|
| Holder list | Blockscout PRO | rebuilt from history + on-chain `balanceOf` (plan excludes Base) | Blockscout PRO |
| Transfer history | public RPC `eth_getLogs` (10M-block windows) | Alchemy Transfers API | Alchemy Transfers API |
| Gas funders | HyperSync | Alchemy | Alchemy |
| Fallbacks | HyperSync history | HyperSync, then public RPC replay | HyperSync, then public RPC replay |

Free tiers bound what one scan reads (HyperSync ~15 queries/min, Alchemy ~4,000 transfers/s), so
the backend keeps what it reads:

- **Stored history.** Each token's Transfer log is saved in Postgres as gzip chunks per closed block
  range (`transfer_chunks`). A scan reads only the gaps and the newest blocks; the last 50 blocks are
  re-read every time and never stored (reorgs). Gas funders are cached per wallet (`wallet_funders`).
- **Background jobs.** `/api/scan` enqueues a job (`scan_jobs`) and streams its progress; workers start
  with the server (`src/instrumentation.ts`). A dropped connection just reconnects to the same job.
- **Preliminary maps.** If the history isn't fully read within `SCAN_BUDGET_MS`, a *preliminary* map is
  stored and shown with a banner ("built from 70% of the token's transfer history") while the job keeps
  reading for up to `JOB_BUDGET_MS`. Preliminary maps are never sealed; only complete ones are.
- **Prewarm.** The daily cron calls `/api/jobs/prewarm`, which queues low-priority rescans of tokens
  older than 12 h plus DexScreener's trending tokens on supported chains.
