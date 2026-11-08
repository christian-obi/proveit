// Card hashing and signature checks, matching enclave/src/card.rs and contract/src/card.rs:
//   card_bytes = canonical(card)
//   card_hash  = sha256(card_bytes)
//   signed     = sha256("proveit-card-v1\n" ‖ card_bytes)
//   sig        = ed25519(cards key, signed)
// Works in browsers and Node.

import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { concat, hex, unhex, utf8 } from "./bytes.ts";
import { canonical } from "./canonical.ts";

export const SIGNING_PREFIX = "proveit-card-v1\n";

export function cardBytes(card: unknown): Uint8Array {
  return utf8(canonical(card));
}

export function cardHash(card: unknown): string {
  return hex(sha256(cardBytes(card)));
}

export function signingMessage(card: unknown): Uint8Array {
  return sha256(concat(utf8(SIGNING_PREFIX), cardBytes(card)));
}

export function verifyCardSignature(card: unknown, sigHex: string, pubkeyHex: string): boolean {
  try {
    return ed25519.verify(unhex(sigHex), signingMessage(card), unhex(pubkeyHex));
  } catch {
    return false;
  }
}

/**
 * The enclave's exact stdout for a card. The enclave serialises {status, card, sig} with
 * sorted keys, and the card part is its canonical JSON, so the bytes can be rebuilt from
 * the recorded card and signature and checked against the attestation's output_hash.
 */
export function enclaveOutput(card: unknown, sigHex: string): string {
  return `{"card":${canonical(card)},"sig":${JSON.stringify(sigHex)},"status":"ok"}`;
}

export function sha256Hex(s: string): string {
  return hex(sha256(utf8(s)));
}
