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
      let active = "0xa4b1";
      (window as any).ethereum = {
        request: async ({ method, params }: { method: string; params?: any[] }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [owner];
          if (method === "eth_chainId") return active;
          if (method === "wallet_switchEthereumChain") return void (active = params![0].chainId);
          return sig;
        },
      };
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

/** Behaves like MetaMask: starts on Ethereum, doesn't know Arbitrum Sepolia (and says so the
 *  wrapped way), and refuses typed data for any chain but the active one. */
const strictMetaMask = (page: Page, opts: { rejectAdd?: boolean } = {}) =>
  page.addInitScript(
    ([owner, sig, rejectAdd]) => {
      let active = "0x1";
      const known = new Set(["0x1"]);
      const calls: string[] = [];
      (window as any).__walletCalls = calls;
      (window as any).ethereum = {
        request: async ({ method, params }: { method: string; params?: any[] }) => {
          calls.push(method);
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [owner];
          if (method === "eth_chainId") return active;
          if (method === "wallet_switchEthereumChain") {
            const id = params![0].chainId;
            if (!known.has(id)) throw { code: -32603, message: `Unrecognized chain ID "${id}". Try adding the chain using wallet_addEthereumChain first.`, data: { originalError: { code: 4902 } } };
            active = id;
            return null;
          }
          if (method === "wallet_addEthereumChain") {
            if (rejectAdd) throw { code: 4001, message: "User rejected the request." };
            known.add(params![0].chainId);
            active = params![0].chainId;
            return null;
          }
          if (method === "eth_signTypedData_v4") {
            const chainId = Number(JSON.parse(params![1]).domain.chainId);
            if (chainId !== parseInt(active, 16)) throw { code: -32602, message: `Provided chainId "${chainId}" must match the active chainId "${parseInt(active, 16)}"` };
            return sig;
          }
          throw { code: -32601, message: `unsupported ${method}` };
        },
      };
    },
    [OWNER, SIG, opts.rejectAdd ?? false] as const,
  );

test("MetaMask on Ethereum: adds Arbitrum Sepolia, then approves and trades", async ({ page }) => {
  await strictMetaMask(page);
  const { orders, approvals } = await fakeHyperliquid(page);
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Hyperliquid testnet" }).click();
  await page.getByRole("button", { name: "Approve a trading key" }).click();
  await page.getByRole("button", { name: "Try a sample trade" }).click();
  await expect(page.locator("[data-copy-log]")).toContainText("Filled 0.00025 BTC at $100100");
  const calls: string[] = await page.evaluate(() => (window as any).__walletCalls);
  expect(calls).toContain("wallet_addEthereumChain");
  expect(calls.indexOf("wallet_addEthereumChain")).toBeLessThan(calls.indexOf("eth_signTypedData_v4"));
  expect(approvals).toHaveLength(1);
  expect(orders).toHaveLength(1);
  await expect(page.getByText("[object Object]")).toHaveCount(0);
});

test("declining to add the chain says why, not [object Object]", async ({ page }) => {
  await strictMetaMask(page, { rejectAdd: true });
  const { approvals } = await fakeHyperliquid(page);
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Hyperliquid testnet" }).click();
  await page.getByRole("button", { name: "Approve a trading key" }).click();
  await expect(page.getByText(/Add Arbitrum Sepolia to your wallet to approve the trading key/)).toBeVisible();
  await expect(page.getByText("[object Object]")).toHaveCount(0);
  expect(approvals).toHaveLength(0);
});

test("auto-copy takes only trades that arrive while it's on, once each", async ({ page }) => {
  await wallet(page);
  const { orders } = await fakeHyperliquid(page);
  const args = Buffer.from(JSON.stringify({ card_id: reveal.card_id })).toString("base64");
  const res = await fetch("https://rpc.testnet.fastnear.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: "proveit-demo-registry.testnet", method_name: "get_card", args_base64: args } }) });
  const hash = JSON.parse(Buffer.from((await res.json()).result.result).toString()).card_hash as string;

  const hour = Math.floor(Date.now() / 3_600_000);
  const old: FeedEntry = { seq: 0, record: { hour: hour - 1, coin: "BTC", dir: "Open Long", size_bps: 2_000, pnl_bps: 0, fills: 1 } };
  const fresh: FeedEntry = { seq: 1, record: { hour, coin: "ETH", dir: "Open Long", size_bps: 2_000, pnl_bps: 0, fills: 1 } };
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

test("a reload keeps the wallet, the feed and auto-copy", async ({ page }) => {
  await wallet(page);
  await fakeHyperliquid(page);
  await page.route("**/api/reveal", (route) => route.fulfill({ json: { output: { status: "error", code: "UPSTREAM", message: "offline in this test" } } }));
  await page.addInitScript(
    ([account, secret]) => {
      (window as any).__proveitE2eAccount = account;
      (window as any).__proveitFollowerSecret = secret;
    },
    [ACCOUNT, SECRET],
  );
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Hyperliquid testnet" }).click();
  await page.getByRole("button", { name: "Approve a trading key" }).click();
  await page.getByRole("button", { name: "Start auto-copy" }).click();
  await page.getByRole("button", { name: "Connect wallet and follow" }).click();
  await expect(page.getByText(`Following as ${ACCOUNT}`)).toBeVisible();

  await page.reload();
  await expect(page.locator("[data-copy-state]")).toHaveAttribute("data-copy-state", "on");
  await expect(page.getByText(`Following as ${ACCOUNT}`)).toBeVisible();
  await expect(page.locator(`[data-wallet="${ACCOUNT}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve a trading key" })).toHaveCount(0);
});

test("the simulation keeps a P&L", async ({ page }) => {
  await fakeHyperliquid(page);
  await page.goto(`/demo/${reveal.card_id}/feed`);
  await page.getByRole("button", { name: "Try a sample trade" }).click();
  await expect(page.locator("[data-copy-pnl]")).toContainText("Your copy P&L");
});
