// The follower's side of the live feed (enclave/src/feed.rs) and the NEP-413 message they
// sign to read it over HTTPS (enclave/src/nep413.rs).
//
//   head_0 = sha256("proveit-feed-v1" ‖ card_hash)
//   head_n = sha256(head_{n-1} ‖ sha256(canonical({"seq": n-1, "record": record})))
//
// Keep the `head` of each page and pass it to checkPage for the next one: if the enclave's
// chain was ever rewritten, dropped or reordered for you, the check fails.

import { sha256 } from "@noble/hashes/sha256";
import { ed25519 } from "@noble/curves/ed25519";
import { canonical } from "./canonical.ts";
import { concat, hex, unhex, utf8 } from "./bytes.ts";
import type { OrderRecord } from "./reveal.ts";

export type FeedEntry = { seq: number; record: OrderRecord };
export type FeedPage = {
  v: number;
  card_hash: string;
  follower: string;
  from: number;
  prev_head: string;
  entries: FeedEntry[];
  head: string;
  next: number;
  held_back: number;
  delay_secs: number;
  as_of: number;
};

export function genesis(cardHash: string): string {
  return hex(sha256(concat(utf8("proveit-feed-v1"), utf8(cardHash))));
}

export function link(prev: string, entry: FeedEntry): string {
  return hex(sha256(concat(unhex(prev), sha256(utf8(canonical(entry))))));
}

export type PageCheck = { ok: boolean; detail: string };

export function checkPage(p: FeedPage, lastHead: string | null, cardHash: string, follower: string): PageCheck {
  if (p.card_hash !== cardHash) return { ok: false, detail: "this feed is for a different card" };
  if (p.follower !== follower) return { ok: false, detail: `this feed page was made for ${p.follower}` };
  const expected = lastHead ?? (p.from === 0 ? genesis(cardHash) : null);
  if (expected !== null && p.prev_head !== expected) return { ok: false, detail: "the feed doesn't continue from the head you saw last: something was rewritten" };
  let head = p.prev_head;
  for (const [i, e] of p.entries.entries()) {
    if (e.seq !== p.from + i) return { ok: false, detail: "entries are out of sequence" };
    head = link(head, e);
  }
  if (head !== p.head || p.next !== p.from + p.entries.length) return { ok: false, detail: "the entries don't lead to the stated head: one was dropped, edited or reordered" };
  return { ok: true, detail: expected === null ? "chain intact from this page on" : "chain intact" };
}

// ---- NEP-413 -----------------------------------------------------------------------------

export const NEP413_TAG = 2 ** 31 + 413;
export const RECIPIENT = "proveit";

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
const borshString = (s: string) => concat(u32(utf8(s).length), utf8(s));

/** The 32 bytes a NEAR wallet signs for signMessage({message, nonce, recipient}). */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  const cb = callbackUrl === undefined ? new Uint8Array([0]) : concat(new Uint8Array([1]), borshString(callbackUrl));
  return sha256(concat(u32(NEP413_TAG), borshString(message), nonce, borshString(recipient), cb));
}

export function followerMessage(cardHash: string, x25519Pub: string, expiresAt: number): string {
  return `proveit-follow-v1|${cardHash}|${x25519Pub}|${expiresAt}`;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("not base58");
    n = n * 58n + BigInt(i);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    out.unshift(0);
  }
  return Uint8Array.from(out);
}

export function base58Encode(b: Uint8Array): string {
  let n = 0n;
  for (const x of b) n = n * 256n + BigInt(x);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Check a signed message locally (the enclave also checks the key belongs to the account). */
export function verifyNep413(m: { public_key: string; signature: string; message: string; nonce: string; recipient: string }): boolean {
  const pk = base58Decode(m.public_key.replace(/^ed25519:/, ""));
  const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return ed25519.verify(fromB64(m.signature), nep413Hash(m.message, fromB64(m.nonce), m.recipient), pk);
}

/** For scripts and tests standing in for a wallet: sign a NEP-413 message with a raw ed25519 seed. */
export function signNep413(seed: Uint8Array, message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  return ed25519.sign(nep413Hash(message, nonce, recipient), seed);
}

export function newEd25519(): { seed: Uint8Array; pub: Uint8Array } {
  const seed = ed25519.utils.randomPrivateKey();
  return { seed, pub: ed25519.getPublicKey(seed) };
}
