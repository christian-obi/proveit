// Card hashing and signature checks, matching enclave/src/card.rs:
//   card_bytes = canonical(card)
//   card_hash  = sha256(card_bytes)
//   signed     = sha256("proveit-card-v1\n" ‖ card_bytes)
//   sig        = ed25519(cards key, signed)

import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { canonical } from "./canonical.ts";

export const SIGNING_PREFIX = "proveit-card-v1\n";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function cardBytes(card: unknown): Buffer {
  return Buffer.from(canonical(card), "utf8");
}

export function cardHash(card: unknown): string {
  return createHash("sha256").update(cardBytes(card)).digest("hex");
}

export function signingMessage(card: unknown): Buffer {
  return createHash("sha256").update(SIGNING_PREFIX).update(cardBytes(card)).digest();
}

export function verifyCardSignature(card: unknown, sigHex: string, pubkeyHex: string): boolean {
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(pubkeyHex, "hex")]), format: "der", type: "spki" });
  return edVerify(null, signingMessage(card), key, Buffer.from(sigHex, "hex"));
}
