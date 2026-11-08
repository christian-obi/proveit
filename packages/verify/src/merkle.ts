// The Merkle tree of enclave/src/merkle.rs, written separately so each implementation
// checks the other (test-vectors/merkle.json comes from this one). Browser- and Node-safe.
//   leaf = sha256(0x00 ‖ canonical_record)    node = sha256(0x01 ‖ left ‖ right)
// An odd node is carried up unchanged; an empty tree's root is 32 zero bytes.

import { sha256 } from "@noble/hashes/sha256";
import { concat, hex, unhex, utf8 } from "./bytes.ts";

export type Step = { sibling: string; left: boolean };

export function leafHash(canonicalRecord: string): Uint8Array {
  return leafHashBytes(utf8(canonicalRecord));
}

export function leafHashBytes(bytes: Uint8Array): Uint8Array {
  return sha256(concat(new Uint8Array([0x00]), bytes));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(new Uint8Array([0x01]), left, right));
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

/** Rebuild the root of an `n`-leaf tree from its first leaves and the enclave's prefix
 *  proof (enclave/src/merkle.rs `prefix_proof`). `null` if the proof doesn't fit. */
export function prefixRoot(known: Uint8Array[], n: number, proof: string[]): string | null {
  if (known.length === 0 || known.length > n) return null;
  let level = known;
  let len = n;
  let i = 0;
  while (len > 1) {
    if (level.length % 2 === 1 && level.length < len) {
      if (i >= proof.length) return null;
      level = [...level, unhex(proof[i++])];
    }
    level = nextLevel(level);
    len = Math.ceil(len / 2);
  }
  return i === proof.length ? hex(level[0]) : null;
}
