/**
 * The brief's hard rule: exchange, DEX, burn and bridge addresses never connect holders.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/lib/scan/analyze";
import { INFERRED_EXCHANGE, INFERRED_POOL, hotWalletNonce, hubCandidates, inferHubs, seedLabel } from "../src/lib/scan/labels";
import type { RawHolder, RawLabel, RawScan, RawTransfer } from "../src/lib/scan/raw";

// Real wallets from the label dataset (Etherscan-family name tags).
const ROBINHOOD_HOT = "0x40b38765696e3d5d8d9d834d8aad4bb6e418e489"; // "Robinhood" (tagged on World Chain)
const GATE_BASE = "0x0d0707963952f2fba59dd06f2b425ace40b492fe"; // "Gate 1" on Base

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const wallet = (n: number) => addr(0x1000 + n);
const E18 = 10n ** 18n;
const MIN = hotWalletNonce("robinhood");

function scan(opts: { holders: RawHolder[]; transfers: RawTransfer[]; labels?: Record<string, RawLabel>; funders?: Record<string, string> | null }): RawScan {
  const supply = opts.holders.reduce((s, h) => s + h.balance, 0n);
  return {
    chain: "robinhood",
    token: { address: addr(0xbeef), name: "Test", symbol: "TEST", decimals: 18, totalSupply: supply.toString(), holderCount: opts.holders.length, deployer: null, deployBlock: 1, logo: null },
    blockNumber: 1_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    holders: opts.holders,
    labels: opts.labels ?? {},
    transfers: opts.transfers,
    transfersComplete: true,
    funders: opts.funders ?? null,
    blockTimes: {},
    market: null,
    sources: [],
    limits: [],
  };
}

/** `hub` holds the most and sent tokens to 30 other holders in separate blocks. */
function hubFanOut(hub: string, hubIsContract = false) {
  const recipients = Array.from({ length: 30 }, (_, i) => wallet(i));
  const holders: RawHolder[] = [{ address: hub, balance: 1_000n * E18, isContract: hubIsContract }, ...recipients.map((a) => ({ address: a, balance: 10n * E18, isContract: false }))];
  const transfers: RawTransfer[] = [
    { from: "0x0000000000000000000000000000000000000000", to: hub, value: 1_300n * E18, block: 10, tx: null },
    ...recipients.map((to, i) => ({ from: hub, to, value: 10n * E18, block: 20 + i, tx: null })),
  ];
  return { holders, transfers, recipients };
}

const clustered = (s: ReturnType<typeof analyze>) => s.nodes.filter((n) => n.cluster != null).map((n) => n.id);

test("dataset: exchange EOAs carry across chains, but never onto a contract", () => {
  assert.equal(seedLabel("robinhood", ROBINHOOD_HOT)?.type, "cex");
  assert.equal(seedLabel("base", ROBINHOOD_HOT)?.type, "cex");
  assert.equal(seedLabel("robinhood", ROBINHOOD_HOT, true), null);
  assert.equal(seedLabel("base", GATE_BASE)?.type, "cex");
  assert.equal(seedLabel("base", "0x4200000000000000000000000000000000000010")?.type, "bridge");
  assert.equal(seedLabel("robinhood", wallet(1)), null);
});

test("a labelled exchange that paid out to 30 holders links none of them", () => {
  const { holders, transfers } = hubFanOut(ROBINHOOD_HOT);
  const s = analyze(scan({ holders, transfers, labels: { [ROBINHOOD_HOT]: seedLabel("robinhood", ROBINHOOD_HOT)! } }));
  assert.equal(s.clusters.length, 0);
  assert.deepEqual(clustered(s), []);
  assert.ok(s.nodes.find((n) => n.id === ROBINHOOD_HOT)!.exempt);
});

test("control: the same fan-out from an ordinary wallet does link (it is a real signal)", () => {
  const { holders, transfers } = hubFanOut(wallet(999));
  const s = analyze(scan({ holders, transfers }));
  assert.equal(s.clusters.length, 1);
  assert.equal(s.clusters[0].size, 31);
});

test("an unlabelled EOA hub with an exchange-scale nonce is inferred and exempt", () => {
  const hub = wallet(999);
  const { holders, transfers } = hubFanOut(hub);
  const candidates = hubCandidates({ holders, transfers, labels: {}, funders: null });
  assert.deepEqual(candidates, [hub]);

  const quiet = inferHubs({ holders, transfers, labels: {}, candidates, nonces: { [hub]: 400 }, minNonce: MIN });
  assert.deepEqual(quiet, {}, "a deployer-scale nonce stays a normal wallet");

  const busy = inferHubs({ holders, transfers, labels: {}, candidates, nonces: { [hub]: MIN * 20 }, minNonce: MIN });
  assert.deepEqual(busy[hub], { type: "cex", label: INFERRED_EXCHANGE });
  const s = analyze(scan({ holders, transfers, labels: busy }));
  assert.deepEqual(clustered(s), []);
});

test("an unlabelled contract with many peers is inferred as a pool and exempt", () => {
  const hub = addr(0xc0de);
  const { holders, transfers } = hubFanOut(hub, true);
  const labels = inferHubs({ holders, transfers, labels: {}, candidates: [], nonces: {}, minNonce: MIN });
  assert.equal(labels[hub]?.label, INFERRED_POOL);
  assert.deepEqual(clustered(analyze(scan({ holders, transfers, labels }))), []);
});

test("wallets whose gas came from an exchange are not linked by it", () => {
  const ws = Array.from({ length: 5 }, (_, i) => wallet(i));
  const holders = ws.map((a) => ({ address: a, balance: 10n * E18, isContract: false }));
  const funders = Object.fromEntries(ws.map((w) => [w, ROBINHOOD_HOT]));

  const linked = analyze(scan({ holders, transfers: [], funders }));
  assert.equal(linked.clusters[0]?.size, 5, "control: an unknown shared funder links them");

  const labels = { [ROBINHOOD_HOT]: seedLabel("robinhood", ROBINHOOD_HOT)! };
  assert.deepEqual(clustered(analyze(scan({ holders, transfers: [], funders, labels }))), []);
});

test("shared funders with exchange-scale nonces are inferred", () => {
  const f = wallet(777);
  const funders = Object.fromEntries([0, 1, 2].map((i) => [wallet(i), f]));
  const candidates = hubCandidates({ holders: [], transfers: [], labels: {}, funders });
  assert.deepEqual(candidates, [f]);
  assert.equal(inferHubs({ holders: [], transfers: [], labels: {}, candidates, nonces: { [f]: 2_000_000 }, minNonce: MIN })[f]?.type, "cex");
});
