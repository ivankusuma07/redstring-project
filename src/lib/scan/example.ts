import type { Snapshot } from "../types";
import { analyze } from "./analyze";
import { ZERO, type RawHolder, type RawLabel, type RawScan, type RawTransfer } from "./raw";

/**
 * $EXAMPLE: an illustrative, made-up token used on the landing page, in docs and in tests.
 * It runs through the same analyze() pipeline as real scans, so it exercises every feature.
 * It is always flagged `example: true` and is never sealed on-chain.
 */
export const EXAMPLE_ADDRESS = "0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b9f0e";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cached: Snapshot | null = null;

export function exampleSnapshot(): Snapshot {
  if (cached) return cached;
  const r = rng(4663);
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join("");
  const addr = (head = "", tail = "") => `0x${head}${hex(40 - head.length - tail.length)}${tail}`.toLowerCase();

  const DEC = 18n;
  const ONE = 10n ** DEC;
  const TOTAL = 1_000_000_000n * ONE;
  const ofPct = (p: number) => (BigInt(Math.round(p * 10_000)) * TOTAL) / 1_000_000n;

  const BLOCK = 45_543_520;
  const DEPLOY = 45_300_900;
  const LAUNCH = 45_301_118;
  const DAY = 12_000; // blocks per day at 7.2 s
  const NOW = Date.parse("2026-11-04T14:52:00Z") / 1000;
  const tsOf = (b: number) => Math.round(NOW - (BLOCK - b) * 7.2);

  const pool = addr("5d0f", "77c2");
  const cex = "0x28c6c06298d514db089934071355e5743bf21d60";
  const deployer = addr("a91b", "04ee");
  const dead = "0x000000000000000000000000000000000000dead";
  const farmFunder = addr("3e1d", "19b0");

  const holders: RawHolder[] = [];
  const labels: Record<string, RawLabel> = {
    [pool]: { type: "dex", label: "DEX pool" },
    [cex]: { type: "cex", label: "CEX hot wallet" },
    [dead]: { type: "burn", label: "Burn" },
    [deployer]: { type: "deployer", label: "Deployer" },
  };
  const transfers: RawTransfer[] = [];
  const funders: Record<string, string> = {};
  const add = (a: string, p: number, isContract = false) => holders.push({ address: a, balance: ofPct(p), isContract });
  const tx = (from: string, to: string, p: number, block: number) => transfers.push({ from, to, value: ofPct(p), block, tx: `0x${hex(64)}` });

  tx(ZERO, deployer, 100, DEPLOY);
  tx(deployer, dead, 0.5, DEPLOY + 3);
  tx(deployer, pool, 60, LAUNCH);
  add(pool, 9.2, true);
  add(cex, 6.5, true);
  add(dead, 0.5);
  tx(pool, cex, 6.5, BLOCK - 18 * DAY);

  // Group 2: deployer + two wallets it paid directly before launch
  add(deployer, 2.14);
  const g2 = [addr("3b9e", "e812"), addr("19aa", "7e41")];
  [1.09, 0.87].forEach((p, i) => {
    add(g2[i], p);
    tx(deployer, g2[i], p, LAUNCH - 40 + i);
    funders[g2[i]] = addr();
  });
  funders[deployer] = addr();

  // Group 1: nine wallets that bought in the launch block, six later shuffled tokens
  const g1 = [addr("7c3e", "a1f4"), addr("81d2", "5b07"), addr("d4f0", "2a19"), addr("c03d", "b215"), addr(), addr(), addr(), addr(), addr()];
  const g1p = [1.2, 0.98, 0.87, 0.59, 0.62, 0.55, 0.51, 0.46, 0.42];
  g1.forEach((a, i) => {
    add(a, g1p[i]);
    tx(pool, a, g1p[i], LAUNCH);
    funders[a] = addr();
  });
  for (const [x, y, n] of [[0, 1, 2], [0, 2, 2], [1, 3, 1], [2, 4, 1], [3, 5, 1]] as const)
    for (let k = 0; k < n; k++) tx(g1[x], g1[y], 0.01, LAUNCH + 500 + k * 90);

  // Group 3: fourteen fresh wallets funded with gas from one address, bought within 40 blocks
  const g3 = [addr("b7c1", "90de"), addr("4a8f", "d6c0"), ...Array.from({ length: 12 }, () => addr())];
  const g3p = [0.63, 0.48, 0.2, 0.19, 0.17, 0.16, 0.15, 0.15, 0.13, 0.12, 0.12, 0.11, 0.1, 0.09];
  const g3Block = BLOCK - 6 * DAY;
  g3.forEach((a, i) => {
    add(a, g3p[i]);
    tx(pool, a, g3p[i], g3Block + Math.floor(r() * 40));
    funders[a] = farmFunder;
  });

  // Free float: a long tail of unrelated wallets
  const named = [
    [addr("0f44", "c9a3"), 1.12, 12],
    [addr("6e2a", "f3b8"), 0.81, 9],
  ] as const;
  for (const [a, p, d] of named) {
    add(a, p);
    tx(pool, a, p, BLOCK - d * DAY);
    funders[a] = r() < 0.4 ? cex : addr();
  }
  const rest = 250 - holders.length;
  for (let i = 0; i < rest; i++) {
    const a = addr();
    const p = Math.max(0.004, 0.78 * Math.pow(0.982, i) * (0.85 + r() * 0.3));
    add(a, Math.round(p * 1000) / 1000);
    tx(pool, a, p, LAUNCH + 2 + Math.floor(r() * (BLOCK - LAUNCH - 10)));
    funders[a] = r() < 0.45 ? cex : addr();
  }
  holders.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));

  const blockTimes: Record<number, number> = {};
  for (const t of transfers) blockTimes[t.block] = tsOf(t.block);

  const raw: RawScan = {
    chain: "robinhood",
    token: {
      address: EXAMPLE_ADDRESS,
      name: "Example Token",
      symbol: "EXAMPLE",
      decimals: 18,
      totalSupply: TOTAL.toString(),
      holderCount: 3184,
      deployer,
      deployBlock: DEPLOY,
      logo: null,
    },
    blockNumber: BLOCK,
    createdAt: new Date(NOW * 1000).toISOString(),
    holders,
    labels,
    transfers,
    transfersComplete: true,
    funders,
    blockTimes,
    market: {
      priceUsd: 0.0042,
      change24h: -3.1,
      marketCap: 4_200_000,
      liquidityUsd: 310_000,
      volume24h: 182_000,
      pairUrl: null,
      logo: null,
      pairAddresses: [pool],
    },
    sources: ["Example data"],
    limits: ["Illustrative example. Not a real token, not sealed on-chain."],
    example: true,
  };
  cached = analyze(raw);
  return cached;
}

export const isExampleAddress = (a: string) => a.toLowerCase() === EXAMPLE_ADDRESS || a.toLowerCase() === "example";
