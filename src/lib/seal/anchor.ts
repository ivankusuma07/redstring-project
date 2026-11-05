import "server-only";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS } from "../chains";
import { store } from "../store";
import type { Seal } from "../types";
import { merkle } from "./hash";

export const ANCHOR_ABI = parseAbi([
  "function anchor(bytes32 root, uint256 count)",
  "event Anchored(bytes32 indexed root, uint256 count, uint256 timestamp)",
]);

export const robinhood = defineChain({
  id: CHAINS.robinhood.id,
  name: CHAINS.robinhood.name,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [CHAINS.robinhood.rpc] } },
  blockExplorers: { default: { name: "Explorer", url: CHAINS.robinhood.explorer } },
});

export const anchorContract = () => (process.env.ANCHOR_CONTRACT?.toLowerCase() as Hex | undefined) ?? null;
export const sealingConfigured = () => !!process.env.ANCHOR_PRIVATE_KEY && !!anchorContract();

const BATCH_SIZE = Number(process.env.SEAL_BATCH_SIZE ?? 16);
const MAX_WAIT_MS = Number(process.env.SEAL_MAX_WAIT_MIN ?? 10) * 60_000;

let flushing: Promise<FlushResult> | null = null;
export interface FlushResult {
  sealed: number;
  txHash?: string;
  skipped?: string;
}

/** Flush when the batch is full or the oldest pending snapshot has waited long enough. */
export async function maybeFlush(): Promise<FlushResult> {
  if (!sealingConfigured()) return { sealed: 0, skipped: "not configured" };
  const pending = await store().pendingSeals();
  if (!pending.length) return { sealed: 0, skipped: "nothing pending" };
  const oldest = Date.parse(pending[0].snapshot.createdAt);
  if (pending.length < BATCH_SIZE && Date.now() - oldest < MAX_WAIT_MS) return { sealed: 0, skipped: "batch not ready" };
  return flushSeals();
}

/** Merkle-batch every pending snapshot hash and anchor the root in one tx. */
export function flushSeals(): Promise<FlushResult> {
  if (!flushing) flushing = doFlush().finally(() => (flushing = null));
  return flushing;
}

async function doFlush(): Promise<FlushResult> {
  if (!sealingConfigured()) return { sealed: 0, skipped: "not configured" };
  const pending = await store().pendingSeals();
  if (!pending.length) return { sealed: 0, skipped: "nothing pending" };
  const leaves = pending.map((p) => p.seal.snapshotHash as Hex);
  const { root, proofs } = merkle(leaves);

  const account = privateKeyToAccount(process.env.ANCHOR_PRIVATE_KEY as Hex);
  const wallet = createWalletClient({ account, chain: robinhood, transport: http() });
  const pub = createPublicClient({ chain: robinhood, transport: http() });
  const contract = anchorContract()!;
  try {
    const txHash = await wallet.writeContract({ address: contract, abi: ANCHOR_ABI, functionName: "anchor", args: [root, BigInt(leaves.length)] });
    const receipt = await pub.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("anchor tx reverted");
    const sealedAt = new Date().toISOString();
    await Promise.all(
      pending.map((p, i) => {
        const seal: Seal = {
          ...p.seal,
          status: "sealed",
          merkleRoot: root,
          proof: proofs[i],
          batchCount: leaves.length,
          txHash,
          anchorBlock: Number(receipt.blockNumber),
          contract,
          sealedAt,
        };
        return store().updateSeal(p.id, seal);
      }),
    );
    return { sealed: leaves.length, txHash };
  } catch (e) {
    console.error("[seal] anchor failed", e);
    return { sealed: 0, skipped: `anchor failed: ${(e as Error).message}` };
  }
}
