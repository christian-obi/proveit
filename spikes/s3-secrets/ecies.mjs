// ECIES v1, the format the OutLayer keystore decrypts (keystore-worker/src/crypto.rs):
//   0x01 | ephemeral_x25519_pubkey (32) | nonce (12) | ciphertext | tag (16)
// X25519 ECDH, HKDF-SHA256 (no salt, info "outlayer-keystore-v1"), ChaCha20-Poly1305 with
// empty associated data. This is the browser-safe implementation the web app will reuse.

import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { chacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/hashes/utils";

export const ECIES_VERSION = 0x01;
export const HKDF_INFO = new TextEncoder().encode("outlayer-keystore-v1");

export function hexToBytes(hex) {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) throw new Error("not a hex string");
  return Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
}

/** Encrypt `plaintext` (string) to the keystore's X25519 public key (hex). Returns base64. */
export function encryptForKeystore(recipientPubHex, plaintext) {
  const recipient = hexToBytes(recipientPubHex);
  if (recipient.length !== 32) throw new Error("recipient key must be 32 bytes");
  const ephemeralSecret = x25519.utils.randomPrivateKey();
  const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
  const shared = x25519.getSharedSecret(ephemeralSecret, recipient);
  const key = hkdf(sha256, shared, undefined, HKDF_INFO, 32);
  const nonce = randomBytes(12);
  const sealed = chacha20poly1305(key, nonce).encrypt(new TextEncoder().encode(plaintext));

  const blob = new Uint8Array(1 + 32 + 12 + sealed.length);
  blob[0] = ECIES_VERSION;
  blob.set(ephemeralPublic, 1);
  blob.set(nonce, 33);
  blob.set(sealed, 45);
  return Buffer.from(blob).toString("base64");
}

/**
 * Fetch the keystore public key for a Project accessor. `secretNames` are sent with
 * EMPTY values: the keystore validates names only, so the real secret never leaves
 * the caller unencrypted.
 */
export async function fetchKeystorePubkey({ api, projectId, owner, profile, secretNames }) {
  const placeholder = JSON.stringify(Object.fromEntries(secretNames.map((n) => [n, ""])));
  const res = await fetch(`${api}/secrets/pubkey`, {
    method: "POST",
    // Cloudflare in front of the API answers 403 to clients without a User-Agent.
    headers: { "Content-Type": "application/json", "User-Agent": "proveit/s3-spike" },
    body: JSON.stringify({
      accessor: { type: "Project", project_id: projectId },
      owner,
      profile,
      secrets_json: placeholder,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`/secrets/pubkey answered HTTP ${res.status}: ${text.slice(0, 300)}`);
  const { pubkey } = JSON.parse(text);
  if (!/^[0-9a-f]{64}$/.test(pubkey ?? "")) throw new Error(`unexpected pubkey: ${text.slice(0, 200)}`);
  return pubkey;
}
