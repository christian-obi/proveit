// The follower's side of a viewing key: open the enclave's encrypted reveal and prove the
// records are the card's own committed orders (enclave/src/reveal.rs, ecies.rs).
//
//   ciphertext = 0x01 ‖ ephemeral_x25519_pub (32) ‖ nonce (12) ‖ ChaCha20-Poly1305(…)
//   key        = HKDF-SHA256(X25519(follower_secret, ephemeral), info "proveit-reveal-v1")
//   leaf_i     = sha256(0x00 ‖ salt_i ‖ canonical(record_i)),  salt_{i-1} = sha256("proveit-salt-v1" ‖ salt_i)
//
// A reveal is the card's first k orders (oldest first; the key's delay hides the newest),
// the salt of the k-th, and the hashes covering the hidden rest. Rebuilding the card's
// orders root from them proves nothing was edited, dropped, reordered or added.

import { x25519 } from "@noble/curves/ed25519";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { canonical } from "./canonical.ts";
import { concat, hex, unhex, utf8 } from "./bytes.ts";
import { leafHashBytes, prefixRoot } from "./merkle.ts";

export type OrderRecord = { hour: number; coin: string; dir: string; size_bps: number; pnl_bps: number; fills: number };

export type Revealed = {
  v: number;
  card_hash: string;
  follower: string;
  orders_root: string;
  total: number;
  delay_secs: number;
  as_of: number;
  records: OrderRecord[];
  salt: string | null;
  proof: string[];
};

export type RevealCheck = { ok: boolean; shown: number; total: number; detail: string };

const INFO = utf8("proveit-reveal-v1");
const SALT_TAG = utf8("proveit-salt-v1");

/** A fresh X25519 key pair for one reveal. Keep the secret in memory only. */
export function followerKey(): { secret: Uint8Array; pub: string } {
  const secret = x25519.utils.randomPrivateKey();
  return { secret, pub: hex(x25519.getPublicKey(secret)) };
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Decrypt anything the enclave sealed to the follower (a reveal or a feed page). */
export function openSealed<T>(secret: Uint8Array, ciphertextBase64: string): T {
  return openReveal(secret, ciphertextBase64) as unknown as T;
}

/** Decrypt the enclave's reveal with the follower's secret. Throws if it isn't for this key. */
export function openReveal(secret: Uint8Array, ciphertextBase64: string): Revealed {
  const blob = fromBase64(ciphertextBase64);
  if (blob.length < 1 + 32 + 12 + 16 || blob[0] !== 0x01) throw new Error("not a reveal ciphertext");
  const shared = x25519.getSharedSecret(secret, blob.subarray(1, 33));
  const key = hkdf(sha256, shared, undefined, INFO, 32);
  const plain = chacha20poly1305(key, blob.subarray(33, 45)).decrypt(blob.subarray(45));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Salts 0..k-1 from the salt of record k-1. */
export function salts(last: Uint8Array, k: number): Uint8Array[] {
  const out: Uint8Array[] = new Array(k);
  if (k === 0) return out;
  out[k - 1] = last;
  for (let i = k - 2; i >= 0; i--) out[i] = sha256(concat(SALT_TAG, out[i + 1]));
  return out;
}

export function orderLeaf(record: OrderRecord, salt: Uint8Array): Uint8Array {
  return leafHashBytes(concat(salt, utf8(canonical(record))));
}

/** Check a reveal against the card it claims to be for (from the registry, not the reveal). */
export function checkReveal(r: Revealed, card: { orders: { root: string; count: number } }, cardHash: string, follower: string): RevealCheck {
  const shown = r.records.length;
  const fail = (detail: string): RevealCheck => ({ ok: false, shown, total: card.orders.count, detail });
  if (r.card_hash !== cardHash) return fail("this reveal is for a different card");
  if (r.follower !== follower) return fail(`this reveal was made for ${r.follower}`);
  if (r.orders_root !== card.orders.root || r.total !== card.orders.count) return fail("the reveal names a different orders root or count than the card");
  if (shown === 0) return { ok: r.proof.length === 0, shown, total: r.total, detail: "no trades are past the key's delay yet" };
  if (!r.salt) return fail("missing salt");
  const s = salts(unhex(r.salt), shown);
  const leaves = r.records.map((rec, i) => orderLeaf(rec, s[i]));
  const root = prefixRoot(leaves, r.total, r.proof);
  if (root !== card.orders.root) return fail("the records don't rebuild the card's orders root: edited, dropped or reordered");
  return {
    ok: true,
    shown,
    total: r.total,
    detail: shown === r.total ? `all ${shown} committed orders, Merkle-verified` : `the first ${shown} of ${r.total} committed orders, Merkle-verified; the rest are newer than the key's delay`,
  };
}

/** The enclave's sealing, for tests that stand in for the enclave (never used to protect data). */
export function sealTo(recipientPubHex: string, plaintext: string): string {
  const eph = x25519.utils.randomPrivateKey();
  const key = hkdf(sha256, x25519.getSharedSecret(eph, unhex(recipientPubHex)), undefined, INFO, 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = chacha20poly1305(key, nonce).encrypt(utf8(plaintext));
  const blob = concat(new Uint8Array([0x01]), x25519.getPublicKey(eph), nonce, sealed);
  let s = "";
  for (const b of blob) s += String.fromCharCode(b);
  return btoa(s);
}
