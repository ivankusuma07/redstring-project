/**
 * Provider failover: an exhausted or throttling provider is benched and calls move to the fallbacks.
 * Run: npm test
 */
import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

const PRIMARY = "https://base-mainnet.g.alchemy.com/v2/test-key";
process.env.RPC_BASE = PRIMARY;
process.env.RPC_FALLBACK_BASE = "https://fb1.test/rpc,https://fb2.test/rpc";

// chains.ts reads the env when first loaded, so the sources are imported after it is set
type Ep = typeof import("../src/lib/scan/sources/endpoints");
let refusal: Ep["refusal"], resetHealth: Ep["resetHealth"], isDown: Ep["isDown"], rpcUrls: Ep["rpcUrls"];
let rpc: typeof import("../src/lib/scan/sources/rpc");
let al: typeof import("../src/lib/scan/sources/alchemy");
before(async () => {
  ({ refusal, resetHealth, isDown, rpcUrls } = await import("../src/lib/scan/sources/endpoints"));
  rpc = await import("../src/lib/scan/sources/rpc");
  al = await import("../src/lib/scan/sources/alchemy");
});

type Handler = (url: string, body: unknown) => { status?: number; json: unknown };
const calls: string[] = [];
function mockFetch(h: Handler) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(new URL(url).host);
    const { status = 200, json } = h(url, JSON.parse(String(init?.body ?? "null")));
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const quota = { status: 429, json: { jsonrpc: "2.0", id: 1, error: { code: 429, message: "Monthly capacity limit exceeded. Visit the dashboard to upgrade." } } };
const ok = (result: unknown) => ({ json: { jsonrpc: "2.0", id: 1, result } });

beforeEach(() => {
  resetHealth();
  calls.length = 0;
  process.removeAllListeners("warning");
});

test("refusal: quota vs throttle vs call errors", () => {
  assert.equal(refusal(429, 429, "Monthly capacity limit exceeded"), "quota");
  assert.equal(refusal(403, undefined, ""), "quota");
  assert.equal(refusal(429, undefined, "Your app has exceeded its compute units per second capacity"), "throttle");
  assert.equal(refusal(200, 429, "too many requests"), "throttle");
  assert.equal(refusal(400, -32602, "block range too wide, upgrade your plan"), null);
  assert.equal(refusal(200, -32000, "execution reverted"), null);
  assert.equal(refusal(403, -32001, "Archive requests require a personal token."), null);
});

test("rpc: an exhausted key is benched and the call moves to a fallback", async () => {
  mockFetch((url) => (url === PRIMARY ? quota : ok("0x10")));
  assert.equal(await rpc.blockNumber("base"), 16);
  assert.deepEqual(calls, ["base-mainnet.g.alchemy.com", "fb1.test"]);
  assert.ok(isDown(PRIMARY));
  assert.equal(rpcUrls("base")[0], "https://fb1.test/rpc");
  // later calls skip the benched provider entirely
  calls.length = 0;
  await rpc.blockNumber("base");
  assert.deepEqual(calls, ["fb1.test"]);
});

test("rpc: a call error (revert) is not retried elsewhere", async () => {
  mockFetch(() => ({ json: { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } } }));
  await assert.rejects(rpc.rpc("base", "eth_call", []), /execution reverted/);
  assert.deepEqual(calls, ["base-mainnet.g.alchemy.com"]);
  assert.ok(!isDown(PRIMARY));
});

test("rpc: an unreachable endpoint fails over", async () => {
  mockFetch((url) => {
    if (url === PRIMARY) throw new TypeError("fetch failed");
    return ok("0x2");
  });
  assert.equal(await rpc.blockNumber("base"), 2);
  assert.ok(isDown(PRIMARY));
});

test("rpcBatch: a refused batch is resent to the fallback", async () => {
  mockFetch((url, body) => (url === PRIMARY ? quota : { json: (body as { id: number }[]).map((c) => ({ jsonrpc: "2.0", id: c.id, result: "0x6001" })) }));
  const codes = await rpc.getCodes("base", ["0x00000000000000000000000000000000000000aa", "0x00000000000000000000000000000000000000bb"]);
  assert.deepEqual(Object.values(codes), [true, true]);
  assert.deepEqual(calls, ["base-mainnet.g.alchemy.com", "fb1.test"]);
});

test("alchemy: monthly quota turns Alchemy off instead of retrying until the deadline", async () => {
  mockFetch(() => quota);
  assert.ok(al.alchemyEnabled("base"));
  const t = Date.now();
  await assert.rejects(al.range("base", "0x00000000000000000000000000000000000000cc", 0, 100, Date.now() + 60_000), al.AlchemyUnavailable);
  assert.ok(Date.now() - t < 2_000);
  assert.ok(!al.alchemyEnabled("base"));
  await assert.rejects(al.firstFunders("base", ["0x00000000000000000000000000000000000000dd"], 100, Date.now() + 60_000), al.AlchemyUnavailable);
});
