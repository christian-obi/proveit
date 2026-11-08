// T7.4: a reveal sealed by the Rust enclave opens and checks here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unhex } from "./bytes.ts";
import { canonical } from "./canonical.ts";
import { checkReveal, followerKey, openReveal } from "./reveal.ts";

const v = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "..", "test-vectors", "ecies-follower.json"), "utf8"));
const card = { orders: { root: v.orders_root, count: v.orders_count } };
const FOLLOWER = "follower.testnet";

test("T7.4: the Rust-sealed reveal decrypts to the exact plaintext", () => {
  const r = openReveal(unhex(v.follower_secret), v.ciphertext);
  assert.equal(canonical(r), v.plaintext);
});

test("T7.4: its records rebuild the card's orders root (a partial reveal)", () => {
  const r = openReveal(unhex(v.follower_secret), v.ciphertext);
  const c = checkReveal(r, card, v.card_hash, FOLLOWER);
  assert.equal(c.ok, true, c.detail);
  assert.equal(c.shown, v.shown);
  assert.ok(c.shown < c.total && r.proof.length > 0);
});

test("another key can't open it", () => {
  assert.throws(() => openReveal(followerKey().secret, v.ciphertext));
});

test("edited, dropped, reordered or padded records fail; so does the wrong card or follower", () => {
  const fresh = () => openReveal(unhex(v.follower_secret), v.ciphertext);
  const edited = fresh();
  edited.records[2].size_bps += 1;
  assert.equal(checkReveal(edited, card, v.card_hash, FOLLOWER).ok, false);
  const dropped = fresh();
  dropped.records.splice(1, 1);
  assert.equal(checkReveal(dropped, card, v.card_hash, FOLLOWER).ok, false);
  const swapped = fresh();
  [swapped.records[0], swapped.records[3]] = [swapped.records[3], swapped.records[0]];
  assert.equal(checkReveal(swapped, card, v.card_hash, FOLLOWER).ok, false);
  const padded = fresh();
  padded.records.push({ ...padded.records[0] });
  assert.equal(checkReveal(padded, card, v.card_hash, FOLLOWER).ok, false);
  assert.equal(checkReveal(fresh(), card, "00".repeat(32), FOLLOWER).ok, false);
  assert.equal(checkReveal(fresh(), card, v.card_hash, "someone.testnet").ok, false);
  assert.equal(checkReveal(fresh(), { orders: { root: v.orders_root, count: v.orders_count + 1 } }, v.card_hash, FOLLOWER).ok, false);
});
