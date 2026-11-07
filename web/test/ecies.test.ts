// T5.1: the browser's encryption decrypts with an independent implementation (node:crypto,
// the keystore's algorithm), in the exact v1 wire format. The same code was accepted by the
// real OutLayer keystore in T0.4 and P3.

import crypto from "node:crypto";
import { describe, expect, test } from "vitest";
import { encryptForKeystore, HKDF_INFO } from "@/lib/ecies";

function keypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return { privateKey, publicHex: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex") };
}

function decrypt(privateKey: crypto.KeyObject, blobBase64: string): string {
  const blob = Buffer.from(blobBase64, "base64");
  expect(blob[0]).toBe(0x01);
  const ephemeral = crypto.createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), blob.subarray(1, 33)]),
    format: "der",
    type: "spki",
  });
  const shared = crypto.diffieHellman({ privateKey, publicKey: ephemeral });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.alloc(0), HKDF_INFO, 32));
  const d = crypto.createDecipheriv("chacha20-poly1305", key, blob.subarray(33, 45), { authTagLength: 16 });
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(45, blob.length - 16)), d.final()]).toString("utf8");
}

const secret = JSON.stringify({ PROVEIT_SECRET: JSON.stringify({ venue: "hyperliquid", proof: { account: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" } }) });

describe("ECIES v1 in the browser", () => {
  test("decrypts with node:crypto", () => {
    const { privateKey, publicHex } = keypair();
    expect(decrypt(privateKey, encryptForKeystore(publicHex, secret))).toBe(secret);
  });

  test("layout is 1 + 32 + 12 + plaintext + 16 bytes, and fresh every time", () => {
    const { publicHex } = keypair();
    const a = encryptForKeystore(publicHex, secret);
    const b = encryptForKeystore(publicHex, secret);
    expect(Buffer.from(a, "base64").length).toBe(1 + 32 + 12 + Buffer.byteLength(secret) + 16);
    expect(a).not.toBe(b);
  });

  test("the ciphertext doesn't contain the address in any form", () => {
    const { publicHex } = keypair();
    const blob = encryptForKeystore(publicHex, secret);
    const raw = Buffer.from(blob, "base64").toString("latin1").toLowerCase();
    expect(blob.toLowerCase()).not.toContain("f39fd6e51aad88f6f4ce6ab8827279cfffb92266");
    expect(raw).not.toContain("f39fd6e51aad88f6f4ce6ab8827279cfffb92266");
  });

  test("tampering fails authentication", () => {
    const { privateKey, publicHex } = keypair();
    const blob = Buffer.from(encryptForKeystore(publicHex, secret), "base64");
    blob[60] ^= 1;
    expect(() => decrypt(privateKey, blob.toString("base64"))).toThrow();
  });
});
