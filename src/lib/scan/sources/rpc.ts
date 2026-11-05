import { decodeAbiParameters, hexToString, type Hex } from "viem";
import { CHAINS } from "../../chains";
import type { ChainKey } from "../../types";
import type { RawTransfer } from "../raw";

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export class RpcError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message);
  }
}

let rid = 1;

export async function rpc<T = unknown>(chain: ChainKey, method: string, params: unknown[], timeoutMs = 30_000): Promise<T> {
  const res = await fetch(CHAINS[chain].rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new RpcError(`RPC ${method} HTTP ${res.status}`, res.status);
  const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (j.error) throw new RpcError(j.error.message, j.error.code);
  return j.result as T;
}

/** JSON-RPC batch; falls back to sequential calls when the endpoint rejects batches. */
export async function rpcBatch<T = unknown>(chain: ChainKey, calls: { method: string; params: unknown[] }[], size = 40): Promise<(T | null)[]> {
  const out: (T | null)[] = [];
  for (let i = 0; i < calls.length; i += size) {
    const chunk = calls.slice(i, i + size);
    try {
      const body = chunk.map((c, k) => ({ jsonrpc: "2.0", id: k, method: c.method, params: c.params }));
      const res = await fetch(CHAINS[chain].rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      });
      const j = (await res.json()) as { id: number; result?: T; error?: unknown }[];
      if (!Array.isArray(j)) throw new Error("batch unsupported");
      const byId = new Map(j.map((r) => [r.id, r]));
      chunk.forEach((_, k) => out.push((byId.get(k)?.result as T) ?? null));
    } catch {
      for (const c of chunk) out.push(await rpc<T>(chain, c.method, c.params).catch(() => null));
    }
  }
  return out;
}

const hex = (n: number) => `0x${n.toString(16)}`;

export const blockNumber = async (chain: ChainKey) => Number(await rpc<string>(chain, "eth_blockNumber", []));

const SEL = { name: "0x06fdde03", symbol: "0x95d89b41", decimals: "0x313ce567", totalSupply: "0x18160ddd", token0: "0x0dfe1681" };

function decodeString(h: string | null): string | null {
  if (!h || h === "0x") return null;
  try {
    return decodeAbiParameters([{ type: "string" }], h as Hex)[0];
  } catch {
    try {
      return hexToString(h as Hex, { size: 32 }).replace(/\0/g, "") || null; // bytes32 tokens (MKR-style)
    } catch {
      return null;
    }
  }
}

export async function tokenMeta(chain: ChainKey, address: string, block: number) {
  const tag = hex(block);
  const [code, name, symbol, decimals, supply] = await rpcBatch<string>(chain, [
    { method: "eth_getCode", params: [address, tag] },
    ...(["name", "symbol", "decimals", "totalSupply"] as const).map((k) => ({ method: "eth_call", params: [{ to: address, data: SEL[k] }, tag] })),
  ]);
  if (!code || code === "0x") return null;
  if (!supply || supply === "0x" || !decimals || decimals === "0x") return null; // not an ERC-20
  return {
    name: decodeString(name) ?? "Unknown",
    symbol: decodeString(symbol) ?? "???",
    decimals: Number(BigInt(decimals)),
    totalSupply: BigInt(supply).toString(),
  };
}

export async function getCodes(chain: ChainKey, addrs: string[]): Promise<Record<string, boolean>> {
  const res = await rpcBatch<string>(chain, addrs.map((a) => ({ method: "eth_getCode", params: [a, "latest"] })));
  return Object.fromEntries(addrs.map((a, i) => [a, !!res[i] && res[i] !== "0x"]));
}

/** Contracts that answer token0() are AMM pairs/pools (Uniswap v2/v3 style). */
export async function poolLike(chain: ChainKey, addrs: string[]): Promise<Set<string>> {
  const res = await rpcBatch<string>(chain, addrs.map((a) => ({ method: "eth_call", params: [{ to: a, data: SEL.token0 }, "latest"] })));
  return new Set(addrs.filter((_, i) => !!res[i] && res[i]!.length >= 66));
}

export async function blockTimes(chain: ChainKey, blocks: number[]): Promise<Record<number, number>> {
  const uniq = [...new Set(blocks)].slice(0, 400);
  const res = await rpcBatch<{ timestamp: string }>(chain, uniq.map((b) => ({ method: "eth_getBlockByNumber", params: [hex(b), false] })));
  const out: Record<number, number> = {};
  uniq.forEach((b, i) => {
    if (res[i]?.timestamp) out[b] = Number(BigInt(res[i]!.timestamp));
  });
  return out;
}

export async function txSender(chain: ChainKey, hash: string): Promise<string | null> {
  const tx = await rpc<{ from: string } | null>(chain, "eth_getTransactionByHash", [hash]).catch(() => null);
  return tx?.from?.toLowerCase() ?? null;
}

/** Binary-search the first block where the token has code. Needs an archive RPC; returns 0 if it fails. */
export async function findDeployBlock(chain: ChainKey, address: string, latest: number): Promise<number> {
  let lo = 0;
  let hi = latest;
  try {
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const code = await rpc<string>(chain, "eth_getCode", [address, hex(mid)], 15_000);
      if (code && code !== "0x") hi = mid;
      else lo = mid + 1;
    }
    return lo;
  } catch {
    return 0;
  }
}

const topicAddr = (t: string) => `0x${t.slice(26)}`.toLowerCase();

interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

export class TooLargeError extends Error {}

/**
 * Replays every Transfer log of a token through plain eth_getLogs, shrinking the block
 * window whenever the RPC complains. Throws TooLargeError above maxLogs.
 */
export async function replayTransfers(
  chain: ChainKey,
  token: string,
  fromBlock: number,
  toBlock: number,
  opts: { maxLogs: number; onProgress?: (p: number) => void; deadline: number },
): Promise<RawTransfer[]> {
  const out: RawTransfer[] = [];
  let span = CHAINS[chain].logRange;
  let start = fromBlock;
  const total = Math.max(1, toBlock - fromBlock);
  while (start <= toBlock) {
    if (Date.now() > opts.deadline) throw new TooLargeError("Log replay ran out of time");
    const end = Math.min(toBlock, start + span - 1);
    let logs: RpcLog[];
    try {
      logs = await rpc<RpcLog[]>(chain, "eth_getLogs", [{ address: token, fromBlock: hex(start), toBlock: hex(end), topics: [TRANSFER_TOPIC] }], 45_000);
    } catch (e) {
      const msg = String((e as Error).message).toLowerCase();
      const hint = msg.match(/only (\d+) are allowed/) ?? msg.match(/range.*?(\d{3,})/);
      if (hint && Number(hint[1]) < span) span = Number(hint[1]);
      else if (span > 1) span = Math.max(1, Math.floor(span / 2));
      else throw e;
      continue;
    }
    for (const l of logs) {
      if (l.topics.length !== 3) continue; // ERC-721 Transfer has 4 topics
      out.push({
        from: topicAddr(l.topics[1]),
        to: topicAddr(l.topics[2]),
        value: l.data && l.data !== "0x" ? BigInt(l.data.slice(0, 66)) : 0n,
        block: Number(BigInt(l.blockNumber)),
        tx: l.transactionHash,
      });
    }
    if (out.length > opts.maxLogs) throw new TooLargeError(`More than ${opts.maxLogs.toLocaleString("en-US")} transfers`);
    opts.onProgress?.((end - fromBlock) / total);
    start = end + 1;
    if (logs.length < 2000 && span < CHAINS[chain].logRange) span = Math.min(CHAINS[chain].logRange, span * 2);
  }
  return out;
}

/** Turn a full transfer history into balances. */
export function balancesFrom(transfers: RawTransfer[]): Map<string, bigint> {
  const bal = new Map<string, bigint>();
  for (const t of transfers) {
    bal.set(t.from, (bal.get(t.from) ?? 0n) - t.value);
    bal.set(t.to, (bal.get(t.to) ?? 0n) + t.value);
  }
  return bal;
}
