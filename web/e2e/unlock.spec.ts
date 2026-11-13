// P7 in a real browser against testnet: the unlock page shows the trader's terms, a
// purchase is the right USDC transaction, and a real recorded reveal decrypts and checks
// in the page ("N/N Merkle-verified").
//
// The reveal is real: scripts/p7-live.sh reveal sent it from proveit-follower.testnet and
// recorded its transaction and the throwaway key (fixtures/reveal.json). The test wallet
// only stands in for signing; the page fetches that transaction's result from the chain.

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "reveal.json"), "utf8"));
const page_ = `/demo/${fx.card_id}/unlock`;

test("the card page links to its viewing keys", async ({ page }) => {
  await page.goto(`/demo/${fx.card_id}`);
  await expect(page.locator("[data-unlock-link]")).toContainText("viewing keys from 1 tUSDC");
  await page.locator("[data-unlock-link]").click();
  await expect(page).toHaveURL(new RegExp(`${page_}$`));
});

test("the terms are shown, and buying sends ft_transfer_call with the card id", async ({ page }) => {
  await page.addInitScript(() => (window.__proveitE2eAccount = "e2e-buyer.testnet"));
  await page.goto(page_);
  const offer = page.locator("[data-offer]");
  await expect(offer).toContainText("1 tUSDC");
  await expect(offer).toContainText("1 hour");
  await expect(offer).toContainText("30 days");
  await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
  await page.getByRole("button", { name: /^Buy a key/ }).click();
  await expect.poll(() => page.evaluate(() => window.__proveitSent?.length ?? 0)).toBe(1);
  const [[tx]] = await page.evaluate(() => window.__proveitSent!);
  expect(tx.receiverId).toBe("proveit-usdc.testnet");
  const call = tx.actions[0].params;
  expect(call.methodName).toBe("ft_transfer_call");
  expect(call.deposit).toBe("1");
  expect(call.args).toEqual({ receiver_id: fx.registry, amount: "1000000", msg: JSON.stringify({ card_id: fx.card_id }) });
});

test("T7.6 (testnet): a key holder's real reveal decrypts in the page and every trade is Merkle-verified", async ({ page }) => {
  await page.addInitScript(
    ([account, hash, secret]) => {
      window.__proveitE2eAccount = account;
      window.__proveitE2eTxHash = hash;
      window.__proveitFollowerSecret = secret;
    },
    [fx.sender, fx.tx, fx.secret],
  );
  await page.goto(page_);
  await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
  await expect(page.locator("[data-grant]")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Reveal trades" }).click();
  const check = page.locator("[data-reveal-check]");
  await expect(check).toHaveAttribute("data-reveal-check", "pass", { timeout: 60_000 });
  await expect(check).toContainText(`${fx.shown}/${fx.total} Merkle-verified`);
  // 25 trades per page; Next shows the rest.
  const rows = page.locator("[data-trade-row]");
  await expect(rows).toHaveCount(Math.min(fx.shown, 25));
  if (fx.shown > 25) {
    await expect(page.locator("[data-trade-pages]")).toContainText(`1–25 of ${fx.shown} trades`);
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(rows).toHaveCount(Math.min(fx.shown - 25, 25));
  }
  // The reveal tx asked for this browser's key and nothing else.
  const [[tx]] = await page.evaluate(() => window.__proveitSent!);
  expect(tx.actions[0].params.methodName).toBe("request_reveal");
});

test("someone else's key can't open that reveal", async ({ page }) => {
  await page.addInitScript(
    ([account, hash]) => {
      window.__proveitE2eAccount = account;
      window.__proveitE2eTxHash = hash;
      window.__proveitFollowerSecret = "11".repeat(32);
    },
    [fx.sender, fx.tx],
  );
  await page.goto(page_);
  await page.getByRole("button", { name: "Connect NEAR wallet" }).click();
  await page.getByRole("button", { name: "Reveal trades" }).click();
  await expect(page.locator("p.text-bad")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("tbody tr")).toHaveCount(0);
});
