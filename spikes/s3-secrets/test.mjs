// T0.4 local half: the JS encryption must decrypt with an independent implementation
// (Node's built-in crypto), and the live pubkey endpoint must answer with placeholders.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptForKeystore, fetchKeystorePubkey, HKDF_INFO } from "./ecies.mjs";

// Decrypt the way the keystore does, using node:crypto only (no @noble code).
function decryptWithNode(privateKeyObject, blobBase64) {
  const blob = Buffer.from(blobBase64, "base64");
  assert.equal(blob[0], 0x01, "version byte");
  const ephemeral = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), blob.subarray(1, 33)]),
    format: "der",
    type: "spki",
  });
  const shared = crypto.diffieHellman({ privateKey: privateKeyObject, publicKey: ephemeral });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.alloc(0), HKDF_INFO, 32));
  const nonce = blob.subarray(33, 45);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(45, blob.length - 16);
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function nodeKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { privateKey, publicHex: rawPublic.toString("hex") };
}

const SECRET = JSON.stringify({
  PROVEIT_SECRET: JSON.stringify({ venue: "hyperliquid", address: "0x0000000000000000000000000000000000000001" }),
});

test("JS ECIES v1 decrypts with node:crypto", () => {
  const { privateKey, publicHex } = nodeKeypair();
  const blob = encryptForKeystore(publicHex, SECRET);
  assert.equal(decryptWithNode(privateKey, blob), SECRET);
});

test("blob layout is 1 + 32 + 12 + plaintext + 16 bytes", () => {
  const { publicHex } = nodeKeypair();
  const blob = Buffer.from(encryptForKeystore(publicHex, SECRET), "base64");
  assert.equal(blob.length, 1 + 32 + 12 + Buffer.byteLength(SECRET) + 16);
});

test("a flipped ciphertext byte fails authentication", () => {
  const { privateKey, publicHex } = nodeKeypair();
  const blob = Buffer.from(encryptForKeystore(publicHex, SECRET), "base64");
  blob[50] ^= 0xff;
  assert.throws(() => decryptWithNode(privateKey, blob.toString("base64")));
});

test("live /secrets/pubkey answers with placeholder values, per owner", { skip: process.env.OFFLINE === "1" }, async () => {
  const base = { api: "https://api.outlayer.ai", projectId: "zavodil.near/eas-attestor", profile: "default", secretNames: ["PROVEIT_SECRET"] };
  const a = await fetchKeystorePubkey({ ...base, owner: "alice.near" });
  const b = await fetchKeystorePubkey({ ...base, owner: "bob.near" });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b, "keys differ per owner");
});
