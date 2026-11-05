#!/usr/bin/env -S npx tsx
/**
 * redstring-verify: prove a downloaded snapshot is exactly what was sealed on-chain.
 *   npm run verify -- --snapshot example-45543520.json [--tx 0x…] [--chain 4663]
 */
import { readFileSync } from "node:fs";
import { createPublicClient, decodeEventLog, http, parseAbi, type Hex } from "viem";
import { CHAIN_LIST } from "../src/lib/chains";
import { applyProof, snapshotHash } from "../src/lib/seal/hash";

const ABI = parseAbi(["event Anchored(bytes32 indexed root, uint256 count, uint256 timestamp)"]);

const argv = process.argv.slice(2);
const arg = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function main() {
  const file = arg("snapshot");
  if (!file) {
    console.error("usage: redstring-verify --snapshot file.json [--tx 0x…] [--chain 4663]");
    return 2;
  }
  const { snapshot, seal } = JSON.parse(readFileSync(file, "utf8"));
  const check = (b: boolean, msg: string) => {
    console.log(`${b ? "✓" : "✗"} ${msg}`);
    return b;
  };

  const hash = snapshotHash(snapshot);
  const a = check(hash === seal.snapshotHash, hash === seal.snapshotHash ? "snapshot hash matches" : `snapshot hash differs (${hash})`);
  if (!seal.merkleRoot) {
    console.log("· not sealed yet: the file has no Merkle root");
    return a ? 0 : 1;
  }
  const root = applyProof(hash, seal.proof as Hex[]);
  const b = check(root.toLowerCase() === String(seal.merkleRoot).toLowerCase(), "proof valid");

  const chainId = Number(arg("chain") ?? 4663);
  const chain = CHAIN_LIST.find((c) => c.id === chainId);
  const tx = (arg("tx") ?? seal.txHash) as Hex | undefined;
  if (!chain || !tx) {
    console.error("unknown chain id or missing tx hash");
    return 1;
  }
  const client = createPublicClient({ transport: http(chain.rpc) });
  const receipt = await client.getTransactionReceipt({ hash: tx });
  const found = receipt.logs.some((l) => {
    try {
      const ev = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics });
      return ev.eventName === "Anchored" && String(ev.args.root).toLowerCase() === root.toLowerCase();
    } catch {
      return false;
    }
  });
  const c = check(found, "root found in Anchored event");
  return a && b && c ? 0 : 1;
}

main().then((code) => process.exit(code));
