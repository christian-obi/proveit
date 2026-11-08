// P8 feed page in a real browser, and T8.10: what reaches this app's server.
//
// The relay (/api/reveal) needs the app's OutLayer payment key, which CI doesn't have, so
// here the test plays relay + enclave: it answers with feed pages made from the enclave's
// own vector entries (test-vectors/feed.json), chained for the real demo card #2 and
// sealed to the browser's key. Everything the page does with the answer is real:
// decrypting, chain-checking, showing trades, and what it sends.

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../../packages/verify/src/canonical.ts";
import { genesis, link, type FeedEntry, type FeedPage } from "../../packages/verify/src/feed.ts";
import { sealTo } from "../../packages/verify/src/reveal.ts";

const vector = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "test-vectors", "feed.json"), "utf8"));
const reveal = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "reveal.json"), "utf8"));
const SECRET = "07".repeat(32);
const PUB = "13be4feaeaf204c7fd3358fc9c00721881d174278128227ec674f37f7fe97b6d"; // x25519(SECRET)
const ACCOUNT = "e2e-follower.testnet";
const TRADER_ADDRESS = "e986b8e58b5870dca58700c23b5303f20f6823a7";

async function cardHash(): Promise<string> {
  const args = Buffer.from(JSON.stringify({ card_id: reveal.card_id })).toString("base64");
  const res = await fetch("https://rpc.testnet.fastnear.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: reveal.registry, method_name: "get_card", args_base64: args } }),
  });
  return JSON.parse(Buffer.from((await res.json()).result.result).toString()).card_hash;
}

function pageFor(hash: string, entries: FeedEntry[]): FeedPage {
  let head = genesis(hash);
  const prev = head;
  for (const e of entries) head = link(head, e);
  return { v: 1, card_hash: hash, follower: ACCOUNT, from: 0, prev_head: prev, entries, head, next: entries.length, held_back: 2, delay_secs: 3600, as_of: 1_794_200_000 };
}

test("T8.10: the feed shows chain-checked trades, and nothing identifying reaches the app's server", async ({ page }) => {
  const hash = await cardHash();
  const entries: FeedEntry[] = vector.pages[0].entries.map((e: FeedEntry, i: number) => ({ seq: i, record: e.record }));
  const sent: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).host === new URL(page.url() || "http://localhost:3000").host) sent.push(`${r.method()} ${r.url()} ${r.postData() ?? ""}`);
  });
  await page.addInitScript(
    ([account, secret]) => {
      window.__proveitE2eAccount = account;
      window.__proveitFollowerSecret = secret;
    },
    [ACCOUNT, SECRET],
  );
  let relayBody: any = null;
  await page.route("**/api/reveal", async (route) => {
    relayBody = route.request().postDataJSON();
    const plaintext = canonical(pageFor(hash, entries));
    await route.fulfill({ json: { output: { status: "ok", ciphertext: sealTo(PUB, plaintext), head: "", next: entries.length }, attestation: "https://testnet-api.outlayer.ai/attestations/by-call/x" } });
  });

  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Connect wallet and follow" }).click();
  await expect(page.locator("[data-feed-chain]")).toHaveAttribute("data-feed-chain", "pass", { timeout: 30_000 });
  await expect(page.locator("[data-feed] li")).toHaveCount(entries.length);
  await expect(page.locator("[data-feed-chain]")).toContainText("newer than your key's delay");
  await expect(page.getByRole("link", { name: new RegExp(`^Trade ${entries[0].record.coin}`) }).first()).toHaveAttribute("href", /app\.hyperliquid\.xyz\/trade\//);

  // What the browser sent the relay: the card, the cursor and a signed message naming this
  // browser's X25519 key. No address, no trade, no secret.
  expect(Object.keys(relayBody).sort()).toEqual(["auth", "card_id", "op", "registry", "since"]);
  expect(relayBody.auth.message).toBe(`proveit-follow-v1|${hash}|${PUB}|${relayBody.auth.message.split("|")[3]}`);
  const all = sent.join("\n").toLowerCase();
  for (const needle of [TRADER_ADDRESS, "open long", "close long", "close short", "size_bps", "pnl_bps", SECRET]) {
    expect(all, needle).not.toContain(needle);
  }
});

test("a feed that doesn't chain is shown as broken, not as trades", async ({ page }) => {
  const hash = await cardHash();
  const entries: FeedEntry[] = vector.pages[0].entries.map((e: FeedEntry, i: number) => ({ seq: i, record: e.record }));
  const forged = pageFor(hash, entries);
  forged.entries.splice(1, 1); // one trade dropped after the head was computed
  forged.next -= 1;
  await page.addInitScript(([a, s]) => ((window.__proveitE2eAccount = a), (window.__proveitFollowerSecret = s)), [ACCOUNT, SECRET]);
  await page.route("**/api/reveal", (route) => route.fulfill({ json: { output: { status: "ok", ciphertext: sealTo(PUB, canonical(forged)) }, attestation: null } }));
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Connect wallet and follow" }).click();
  await expect(page.locator("[data-feed-chain]")).toHaveAttribute("data-feed-chain", "fail", { timeout: 30_000 });
  await expect(page.locator("[data-feed] li")).toHaveCount(0);
});
