// ECIES v1, the format the OutLayer keystore decrypts (keystore-worker/src/crypto.rs):
//   0x01 | ephemeral_x25519_pubkey (32) | nonce (12) | ciphertext | tag (16)
// X25519, HKDF-SHA256 (no salt, info "outlayer-keystore-v1"), ChaCha20-Poly1305, no AAD.
// Same code as spikes/s3-secrets/ecies.mjs, which the OutLayer keystore accepted live (T0.4).

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/hashes/utils";

export const HKDF_INFO = new TextEncoder().encode("outlayer-keystore-v1");

function hexToBytes(hex: string): Uint8Array {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error("not a hex string");
  return Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Encrypt `plaintext` to the keystore's X25519 key (hex). Returns base64. */
export function encryptForKeystore(recipientPubHex: string, plaintext: string): string {
  const recipient = hexToBytes(recipientPubHex);
  if (recipient.length !== 32) throw new Error("recipient key must be 32 bytes");
  const ephemeralSecret = x25519.utils.randomPrivateKey();
  const shared = x25519.getSharedSecret(ephemeralSecret, recipient);
  const key = hkdf(sha256, shared, undefined, HKDF_INFO, 32);
  const nonce = randomBytes(12);
  const sealed = chacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plaintext));
  const blob = new Uint8Array(1 + 32 + 12 + sealed.length);
  blob[0] = 0x01;
  blob.set(x25519.getPublicKey(ephemeralSecret), 1);
  blob.set(nonce, 33);
  blob.set(sealed, 45);
  return toBase64(blob);
}
