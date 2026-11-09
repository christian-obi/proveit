// P9 against the real testnet registries: discovery, profiles and the JSON verify API.

import { expect, test } from "@playwright/test";

test("T9.6: /explore lists verified cards with their key offers, and sorts", async ({ page }) => {
  await page.goto("/explore");
  const row = page.locator('[data-card-row="proveit-demo-registry.testnet:2"]');
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.locator("[data-offer-summary]")).toContainText(/Viewing key 1 tUSDC · 1h delay · \d of 5 seats left/);
  await expect(row).toContainText("demo");
  for (const sort of ["drawdown", "trades", "newest"]) {
    await page.getByRole("link", { name: { drawdown: "Lowest drawdown", trades: "Most trades", newest: "Newest" }[sort] }).click();
    await expect(page).toHaveURL(new RegExp(`sort=${sort}`), { timeout: 60_000 });
    await expect(page.locator("[data-card-row]").first()).toBeVisible();
  }
});

test("a profile lists an issuer's cards and how many trading accounts back them", async ({ page, request }) => {
  await page.goto("/p/proveit-realist.testnet");
  await expect(page.locator("[data-card-row]").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/cards? from \d+ trading accounts?/)).toBeVisible();
  expect((await request.get("/p/Not%20An%20Account")).status()).toBe(404);
});

test("T9.5: /api/verify returns the five checks, matching what the CLI shows", async ({ request }) => {
  const res = await request.get("/api/verify?card=https://example.com/demo/2");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.registry).toBe("proveit-demo-registry.testnet");
  expect(body.checks.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(["signature:pass", "record:pass", "code:pass", "attestation:pass", "freshness:warn"]);
  expect(res.headers()["access-control-allow-origin"]).toBe("*");

  const guarded = await (await request.get("/api/verify?card=2&registry=proveit-demo-registry.testnet&guard=1")).json();
  expect(guarded.guard.follow).toBe(false);
  expect(guarded.guard.reasons.join(" ")).toMatch(/demo card/);
  const allowed = await (await request.get("/api/verify?card=2&registry=proveit-demo-registry.testnet&guard=1&allow_demo=1&max_dd=70")).json();
  expect(allowed.guard).toMatchObject({ follow: true, reasons: [] });

  expect((await request.get("/api/verify?card=999999&registry=proveit-demo-registry.testnet")).status()).toBe(404);
  expect((await request.get("/api/verify?card=1&registry=evil.testnet")).status()).toBe(400);
});

test("reactions: a click shows at once, is saved, and doesn't change the order", async ({ page, request }) => {
  await page.goto("/explore");
  const row = page.locator('[data-card-row="proveit-demo-registry.testnet:2"]');
  await expect(row).toBeVisible({ timeout: 60_000 });
  const count = row.locator('[data-kind="fire"] [data-count]');
  const before = Number(await count.textContent());
  await row.locator('[data-kind="near"]').waitFor();
  const order = await page.locator("[data-card-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card-row")));
  await row.locator('[data-kind="fire"]').click();
  await expect(count).toHaveText(String(before + 1));
  await expect
    .poll(async () => (await (await request.get("/api/reactions?card=proveit-demo-registry.testnet:2")).json()).counts.fire)
    .toBe(before + 1);
  expect(await page.locator("[data-card-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-card-row")))).toEqual(order);
  expect((await request.post("/api/reactions", { data: { card: "proveit-demo-registry.testnet:999999", kind: "fire", n: 1 } })).status()).toBe(404);
  expect((await request.post("/api/reactions", { data: { card: "proveit-demo-registry.testnet:2", kind: "rocket", n: 1 } })).status()).toBe(400);
});
