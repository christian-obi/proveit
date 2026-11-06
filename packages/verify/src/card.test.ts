// The TypeScript verifier must accept cards the Rust enclave signed, and reject edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cardHash, verifyCardSignature } from "./card.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const vector = JSON.parse(readFileSync(join(root, "test-vectors", "card-sig.json"), "utf8"));

test("test-vector card verifies", () => {
  assert.equal(cardHash(vector.card), vector.card_hash);
  assert.ok(verifyCardSignature(vector.card, vector.sig, vector.pubkey));
});

test("any edited field fails", () => {
  for (const edit of [
    (c: any) => (c.stats.return_bps += 2000),
    (c: any) => (c.stats.max_dd_bps = 0),
    (c: any) => (c.issuer = "someone.testnet"),
    (c: any) => (c.orders.count -= 1),
  ]) {
    const forged = structuredClone(vector.card);
    edit(forged);
    assert.ok(!verifyCardSignature(forged, vector.sig, vector.pubkey));
  }
});

// A card signed inside a real OutLayer TEE on testnet (P2, T2.8).
const teePath = join(root, "docs", "p2-results", "t28-attestation.json");
test("card signed inside the OutLayer TEE verifies", { skip: !existsSync(teePath) }, () => {
  const run = JSON.parse(readFileSync(teePath, "utf8"));
  const { card, sig } = JSON.parse(run.output);
  const pubkey = readFileSync(join(root, "docs", "p2-results", "t28.log"), "utf8").match(/pubkey \(direct caller\): ([0-9a-f]{64})/)![1];
  assert.ok(verifyCardSignature(card, sig, pubkey));
  card.stats.return_bps = 3494;
  assert.ok(!verifyCardSignature(card, sig, pubkey));
});
