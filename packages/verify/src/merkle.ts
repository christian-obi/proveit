// The Merkle tree of enclave/src/merkle.rs, written separately so each implementation
// checks the other (test-vectors/merkle.json comes from this one).
//   leaf = sha256(0x00 ‖ canonical_record)    node = sha256(0x01 ‖ left ‖ right)
// An odd node is carried up unchanged; an empty tree's root is 32 zero bytes.

import { createHash } from "node:crypto";

export type Step = { sibling: string; left: boolean };

const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));

export function leafHash(canonicalRecord: string): Uint8Array {
  return sha256(new Uint8Array([0x00]), new TextEncoder().encode(canonicalRecord));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(new Uint8Array([0x01]), left, right);
}

function nextLevel(level: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < level.length; i += 2) out.push(i + 1 < level.length ? nodeHash(level[i], level[i + 1]) : level[i]);
  return out;
}

export function root(leaves: Uint8Array[]): string {
  if (leaves.length === 0) return "00".repeat(32);
  let level = leaves;
  while (level.length > 1) level = nextLevel(level);
  return hex(level[0]);
}

export function proof(leaves: Uint8Array[], index: number): Step[] {
  const steps: Step[] = [];
  let level = leaves;
  let i = index;
  while (level.length > 1) {
    const sibling = i ^ 1;
    if (sibling < level.length) steps.push({ sibling: hex(level[sibling]), left: sibling < i });
    level = nextLevel(level);
    i = Math.floor(i / 2);
  }
  return steps;
}

export function verify(leaf: Uint8Array, steps: Step[], expectedRoot: string): boolean {
  let acc = leaf;
  for (const s of steps) acc = s.left ? nodeHash(unhex(s.sibling), acc) : nodeHash(acc, unhex(s.sibling));
  return hex(acc) === expectedRoot;
}
