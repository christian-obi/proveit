// The screenshots in the README and the docs (web/public/screenshots). Not a test: run with
//   SCREENSHOTS=1 pnpm exec playwright test e2e/screenshots.spec.ts
// Card pages and the reveal are real (NEAR mainnet/testnet, OutLayer, a recorded reveal);
// Hyperliquid is simulated for the copy-trading shot, so no order is ever sent.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to refresh the docs screenshots");
test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "dark" });

const OUT = join(import.meta.dirname, "..", "public", "screenshots");
const fx = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "reveal.json"), "utf8"));

/** Calm motion so the shots are steady, and no dev-mode badge. */
async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem("fx", "lite"));
}

async function shot(target: Page | Locator, name: string) {
  await target.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled" });
}

/** The main column: everything between the header and the footer. */
const main = (page: Page) => page.locator("main").first();

test("verified mainnet card", async ({ page }) => {
  await prepare(page);
  await page.goto("/c/0?verify=1");
  await expect(page.locator("[data-verdict]")).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(1_500);
  await shot(page.locator("section").first(), "card-verified");
});

test("tamper mode", async ({ page }) => {
  await prepare(page);
  await page.goto("/demo/1?verify=1");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass", { timeout: 90_000 });
  await page.getByRole("button", { name: "Tamper mode" }).click();
  await page.getByLabel("Return %").fill("34.94");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "fail", { timeout: 90_000 });
  await page.waitForTimeout(1_500);
  await shot(page.locator("section").first(), "tamper-mode");
});

test("explore", async ({ page }) => {
  await prepare(page);
  await page.goto("/explore");
  await expect(page.locator("[data-card-row]").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  await shot(page, "explore");
});

test("share menu", async ({ page }) => {
  await prepare(page);
  await page.goto("/demo/1");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("menuitem", { name: "Post on X" })).toBeVisible();
  const card = page.locator("article").first();
  const box = (await card.boundingBox())!;
  await page.screenshot({ path: join(OUT, "share-menu.png"), animations: "disabled", clip: { x: box.x, y: box.y, width: box.width, height: box.height + 120 } });
});

test("viewing key: a real reveal, every trade Merkle-verified", async ({ page }) => {
  await prepare(page);
  await page.addInitScript(
    ([account, hash, secret]) => {
      window.__proveitE2eAccount = account;
      window.__proveitE2eTxHash = hash;
      window.__proveitFollowerSecret = secret;
    },
    [fx.sender, fx.tx, fx.secret],
  );
  await page.goto(`/demo/${fx.card_id}/unlock`);
  await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
  await expect(page.locator("[data-grant]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Reveal trades" }).click();
  await expect(page.locator("[data-reveal-check]")).toHaveAttribute("data-reveal-check", "pass", { timeout: 90_000 });
  const trades = page.locator("[data-reveal-check]").locator("..");
  await trades.scrollIntoViewIfNeeded();
  await shot(trades, "reveal-trades");
});

test("copy trading on Hyperliquid testnet (simulated exchange)", async ({ page }) => {
  await prepare(page);
  const owner = "0x00000000000000000000000000000000000abc12";
  const sig = `0x${"11".repeat(32)}${"22".repeat(32)}1b`;
  await page.addInitScript(
    ([o, s]) => {
      let active = "0x66eee";
      (window as any).ethereum = {
        request: async ({ method, params }: { method: string; params?: any[] }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [o];
          if (method === "eth_chainId") return active;
          if (method === "wallet_switchEthereumChain") return void (active = params![0].chainId);
          return s;
        },
      };
    },
    [owner, sig],
  );
  await page.route(/api\.hyperliquid(-testnet)?\.xyz\/info/, (route) => {
    const body = route.request().postDataJSON();
    if (body.type === "meta") return route.fulfill({ json: { universe: [{ name: "BTC", szDecimals: 5 }, { name: "ETH", szDecimals: 4 }] } });
    if (body.type === "allMids") return route.fulfill({ json: { BTC: "100000", ETH: "4000" } });
    if (body.type === "clearinghouseState") return route.fulfill({ json: { marginSummary: { accountValue: "1000" }, assetPositions: [] } });
    if (body.type === "userFills") return route.fulfill({ json: [] });
    return route.fulfill({ json: { balances: [] } });
  });
  await page.route(/api\.hyperliquid(-testnet)?\.xyz\/exchange/, (route) =>
    route.fulfill({ json: { status: "ok", response: { type: "order", data: { statuses: [{ filled: { totalSz: "0.00025", avgPx: "100100", oid: 1 } }] } } } }),
  );
  await page.goto(`/demo/${fx.card_id}/feed`);
  await page.getByRole("button", { name: "Hyperliquid testnet" }).click();
  await page.getByRole("button", { name: "Approve a trading key" }).click();
  await page.getByRole("button", { name: "Try a sample trade" }).click();
  await expect(page.locator("[data-copy-log]")).toContainText("Filled 0.00025 BTC at $100100");
  const panel = page.locator("[data-copy-log]").locator("xpath=ancestor::*[contains(@class,'border')][1]");
  await panel.scrollIntoViewIfNeeded();
  await shot(panel, "copy-trading");
});

test("create a card", async ({ page }) => {
  await prepare(page);
  await page.goto("/create");
  await page.waitForTimeout(1_000);
  await shot(main(page), "create-card");
});
