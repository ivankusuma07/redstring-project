import { concatHex, keccak256, stringToHex, type Hex } from "viem";

/** Deterministic JSON: object keys sorted, no whitespace. The verifier must use the same function. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export const snapshotHash = (snapshot: unknown): Hex => keccak256(stringToHex(canonicalJson(snapshot)));

/** Sorted-pair hashing (OpenZeppelin style), so proofs need no left/right flags. */
const hashPair = (a: Hex, b: Hex): Hex => (a.toLowerCase() < b.toLowerCase() ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a])));

export function merkle(leaves: Hex[]): { root: Hex; proofs: Hex[][] } {
  if (!leaves.length) throw new Error("no leaves");
  const proofs: Hex[][] = leaves.map(() => []);
  let level = leaves.map((h, i) => ({ h, idx: [i] }));
  while (level.length > 1) {
    const next: typeof level = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1];
      if (!b) {
        next.push(a); // odd node promoted unchanged
        continue;
      }
      for (const k of a.idx) proofs[k].push(b.h);
      for (const k of b.idx) proofs[k].push(a.h);
      next.push({ h: hashPair(a.h, b.h), idx: [...a.idx, ...b.idx] });
    }
    level = next;
  }
  return { root: level[0].h, proofs };
}

export const applyProof = (leaf: Hex, proof: Hex[]): Hex => proof.reduce<Hex>((acc, p) => hashPair(acc, p), leaf);
