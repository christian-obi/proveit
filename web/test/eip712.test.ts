// T5.2: the web app's ownership message hashes to the digest the Rust enclave tests pin.

import { readFileSync } from "node:fs";
import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, test } from "vitest";
import { STATEMENT, typedData, randomNonce } from "@/lib/ownership";

const vector = JSON.parse(readFileSync(new URL("../../test-vectors/eip712.json", import.meta.url), "utf8"));

test("typed data hashes to the vector digest", () => {
  const p = vector.valid;
  expect(hashTypedData(typedData(p.account, p.nearAccount, p.nonce, p.expiry))).toBe(vector.digest);
});

test("statement matches the enclave", () => {
  expect(STATEMENT).toBe(vector.statement);
});

test("a wallet signature over it reproduces the vector signature", async () => {
  const p = vector.valid;
  const signer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  expect(await signer.signTypedData(typedData(p.account, p.nearAccount, p.nonce, p.expiry))).toBe(p.signature);
});

test("nonces are safe integers and differ", () => {
  const a = randomNonce();
  const b = randomNonce();
  expect(Number.isSafeInteger(a) && Number.isSafeInteger(b)).toBe(true);
  expect(a).not.toBe(b);
});
