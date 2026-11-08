// The feed chain and NEP-413 bytes, against test-vectors/feed.json from the Rust enclave.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hex } from "./bytes.ts";
import { checkPage, followerMessage, genesis, nep413Hash, verifyNep413, type FeedPage } from "./feed.ts";

const v = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "test-vectors", "feed.json"), "utf8"));
const [a, b]: FeedPage[] = v.pages;
const F = "follower.testnet";

test("T8.7: two consecutive Rust pages check, the second continuing from the first's head", () => {
  assert.equal(a.prev_head, genesis(v.card_hash));
  assert.deepEqual(checkPage(a, null, v.card_hash, F).ok, true);
  assert.deepEqual(checkPage(b, a.head, v.card_hash, F), { ok: true, detail: "chain intact" });
  assert.ok(a.entries.length > 1 && b.entries.length > 1);
});

test("T8.7: dropped, reordered or edited entries, or a rewritten start, fail", () => {
  const clone = (): FeedPage => structuredClone(b);
  const dropped = clone();
  dropped.entries.splice(0, 1);
  assert.equal(checkPage(dropped, a.head, v.card_hash, F).ok, false);
  const swapped = clone();
  [swapped.entries[0], swapped.entries[1]] = [swapped.entries[1], swapped.entries[0]];
  assert.equal(checkPage(swapped, a.head, v.card_hash, F).ok, false);
  const edited = clone();
  edited.entries[0].record.pnl_bps += 1;
  assert.equal(checkPage(edited, a.head, v.card_hash, F).ok, false);
  assert.equal(checkPage(b, "00".repeat(32), v.card_hash, F).ok, false);
  assert.equal(checkPage(b, a.head, v.card_hash, "someone.testnet").ok, false);
});

test("NEP-413: the TypeScript hash equals the enclave's, and the signature verifies", () => {
  const nonce = Uint8Array.from(atob(v.auth.nonce), (c) => c.charCodeAt(0));
  assert.equal(hex(nep413Hash(v.auth.message, nonce, v.auth.recipient)), v.auth_hash);
  assert.equal(verifyNep413(v.auth), true);
  assert.equal(verifyNep413({ ...v.auth, message: v.auth.message + "x" }), false);
  const [, card, x, exp] = v.auth.message.split("|");
  assert.equal(followerMessage(card, x, Number(exp)), v.auth.message);
});
