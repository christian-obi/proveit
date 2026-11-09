// Copy from a tab, against a simulated Hyperliquid: no real order is ever sent. Checks what
// reaches Hyperliquid, and that the follower's address and key never reach this app's server.

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonical } from "../../packages/verify/src/canonical.ts";
import { genesis, link, type FeedEntry, type FeedPage } from "../../packages/verify/src/feed.ts";
import { sealTo } from "../../packages/verify/src/reveal.ts";

const reveal = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "reveal.json"), "utf8"));
const SECRET = "07".repeat(32);
const PUB = "13be4feaeaf204c7fd3358fc9c00721881d174278128227ec674f37f7fe97b6d";
const ACCOUNT = "e2e-follower.testnet";
const OWNER = "0x00000000000000000000000000000000000abc12";
const SIG = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;

async function fakeHyperliquid(page: Page, equity = "1000") {
  const orders: any[] = [];
  const approvals: any[] = [];
  await page.route(/api\.hyperliquid(-testnet)?\.xyz\/info/, (route) => {
    const body = route.request().postDataJSON();
    if (body.type === "meta") return route.fulfill({ json: { universe: [{ name: "BTC", szDecimals: 5 }, { name: "ETH", szDecimals: 4 }] } });
    if (body.type === "allMids") return route.fulfill({ json: { BTC: "100000", ETH: "4000" } });
    if (body.type === "clearinghouseState") return route.fulfill({ json: { marginSummary: { accountValue: equity }, assetPositions: [] } });
    return route.fulfill({ json: { balances: [] } });
  });
  await page.route(/api\.hyperliquid(-testnet)?\.xyz\/exchange/, (route) => {
    const body = route.request().postDataJSON();
    if (body.action.type === "approveAgent") approvals.push({ url: route.request().url(), body });
    else orders.push({ url: route.request().url(), body });
    return route.fulfill({ json: { status: "ok", response: { type: "order", data: { statuses: [{ filled: { totalSz: "0.00025", avgPx: "100100", oid: 1 } }] } } } });
  });
  return { orders, approvals };
}

const wallet = (page: Page) =>
  page.addInitScript(
    ([owner, sig]) => {
      (window as any).ethereum = { request: async ({ method }: { method: string }) => (method === "eth_requestAccounts" || method === "eth_accounts" ? [owner] : method === "eth_chainId" ? "0xa4b1" : sig) };
    },
    [OWNER, SIG],
  );

test("simulate needs no wallet and sends no order", async ({ page }) => {
  const { orders } = await fakeHyperliquid(page);
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.locator("[data-sim-equity]").fill("100");
  await page.getByRole("button", { name: "Try a sample trade" }).click();
  await expect(page.locator("[data-copy-log]")).toContainText("Simulated buy $25.00");
  expect(orders).toHaveLength(0);
});

test("a demo card can't copy with real money", async ({ page }) => {
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await expect(page.getByRole("button", { name: "Real money" })).toBeDisabled();
});

test("testnet: one approval, then a correct order, and nothing private reaches this app", async ({ page }) => {
  await wallet(page);
  const { orders, approvals } = await fakeHyperliquid(page);
  const sent: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).host === "localhost:3000") sent.push(`${r.url()} ${r.postData() ?? ""}`);
  });
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Hyperliquid testnet" }).click();
  await page.getByRole("button", { name: "Approve a trading key" }).click();
  await page.getByRole("button", { name: "Try a sample trade" }).click();
  await expect(page.locator("[data-copy-log]")).toContainText("Filled 0.00025 BTC at $100100");

  expect(approvals).toHaveLength(1);
  expect(approvals[0].url).toContain("hyperliquid-testnet");
  expect(approvals[0].body.action).toMatchObject({ type: "approveAgent", hyperliquidChain: "Testnet", signatureChainId: "0x66eee" });
  expect(approvals[0].body.action.agentName).toMatch(/^proveit valid_until \d+$/);
  expect(orders).toHaveLength(1);
  expect(orders[0].body.action.orders[0]).toMatchObject({ a: 0, b: true, p: "100500", s: "0.00025", r: false, t: { limit: { tif: "Ioc" } } });
  expect(sent.join("\n").toLowerCase()).not.toContain(OWNER.slice(2));
  expect(sent.join("\n")).not.toContain(approvals[0].body.action.agentAddress);
});

test("auto-copy takes only trades that arrive while it's on, once each", async ({ page }) => {
  await wallet(page);
  const { orders } = await fakeHyperliquid(page);
  const args = Buffer.from(JSON.stringify({ card_id: reveal.card_id })).toString("base64");
  const res = await fetch("https://rpc.testnet.fastnear.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "proveit-demo-registry.testnet", method_name: "get_card", args_base64: args } }) });
  const hash = JSON.parse(Buffer.from((await res.json()).result.result).toString()).card_hash as string;

  const old: FeedEntry = { seq: 0, record: { hour: 490000, coin: "BTC", dir: "Open Long", size_bps: 2_000, pnl_bps: 0, fills: 1 } };
  const fresh: FeedEntry = { seq: 1, record: { hour: 490001, coin: "ETH", dir: "Open Long", size_bps: 2_000, pnl_bps: 0, fills: 1 } };
  const makePage = (from: number, entries: FeedEntry[], prev: string): FeedPage => {
    let head = prev;
    for (const e of entries) head = link(head, e);
    return { v: 1, card_hash: hash, follower: ACCOUNT, from, prev_head: prev, entries, head, next: from + entries.length, held_back: 0 } as FeedPage;
  };
  const first = makePage(0, [old], genesis(hash));
  const second = makePage(1, [fresh], first.head);
  let served = 0;
  await page.route("**/api/reveal", (route) => {
    const out = served++ === 0 ? first : second;
    return route.fulfill({ json: { output: { status: "ok", ciphertext: sealTo(PUB, canonical(out)), head: "", next: out.next }, attestation: null } });
  });
  await page.addInitScript(
    ([account, secret]) => {
      (window as any).__proveitE2eAccount = account;
      (window as any).__proveitFollowerSecret = secret;
      (window as any).__proveitFeedPollMs = 800;
    },
    [ACCOUNT, SECRET],
  );

  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Hyperliquid testnet" }).click();
  await page.getByRole("button", { name: "Approve a trading key" }).click();
  await page.getByRole("button", { name: "Start auto-copy" }).click();
  await page.getByRole("button", { name: "Connect wallet and follow" }).click();
  await expect(page.locator("[data-copy-log]")).toContainText("Filled", { timeout: 30_000 });
  expect(orders).toHaveLength(1);
  expect(orders[0].body.action.orders[0].a).toBe(1);
  expect(orders[0].body.action.orders[0].c).toMatch(/^0x[0-9a-f]{32}$/);
});
