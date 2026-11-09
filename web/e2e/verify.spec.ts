// P6 in a real browser, against the real testnet registry and OutLayer attestation API:
// the card page verifies, tamper mode turns the right checks red, the fake fails, and the
// share image is a real 1200×630 PNG (T6.4).

import { expect, test, type Page } from "@playwright/test";

const status = (page: Page, id: string) => page.locator(`[data-check="${id}"]`).getAttribute("data-status");

async function verify(page: Page) {
  await page.getByRole("button", { name: /^(Verify|Check again)$/ }).first().click();
  await expect(page.locator("[data-verdict]")).toBeVisible({ timeout: 60_000 });
}

test("a demo card verifies: four checks pass, freshness flags it as a demo", async ({ page }) => {
  await page.goto("/demo/1");
  await expect(page.getByText("+14.94%").first()).toBeVisible();
  await verify(page);
  for (const id of ["signature", "record", "code", "attestation"]) expect(await status(page, id)).toBe("pass");
  expect(await status(page, "freshness")).toBe("warn");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass");
});

test("tamper mode: edit the return and the signature, record and attestation go red", async ({ page }) => {
  await page.goto("/demo/1?verify=1");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass", { timeout: 60_000 });
  await page.getByRole("button", { name: "Tamper mode" }).click();
  await page.getByLabel("Return %").fill("34.94");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "fail", { timeout: 60_000 });
  for (const id of ["signature", "record", "attestation"]) expect(await status(page, id)).toBe("fail");
  expect(await status(page, "code")).toBe("pass");
  await expect(page.getByText("edited", { exact: true })).toBeVisible();

  // Put the real number back: green again.
  await page.getByLabel("Return %").fill("14.94");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass", { timeout: 60_000 });
});

test("the landing page: the fake screenshot can't be verified, the real card can", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Verify the screenshot" }).click();
  await expect(page.getByText("Can't be verified. There's nothing to check.")).toBeVisible();
  await verify(page);
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass");
});

test("the verify page opens a pasted link with checks running", async ({ page }) => {
  await page.goto("/verify");
  await page.getByLabel("Card link").fill("https://example.com/demo/1");
  await page.getByRole("button", { name: "Verify" }).last().click();
  await expect(page).toHaveURL(/\/demo\/1\?verify=1/, { timeout: 30_000 });
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass", { timeout: 60_000 });
});

test("unknown cards are a 404", async ({ page }) => {
  expect((await page.goto("/c/999999"))?.status()).toBe(404);
  expect((await page.goto("/demo/abc"))?.status()).toBe(404);
});

test("T6.4: the share image is a 1200×630 PNG and the page links it", async ({ page, request }) => {
  await page.goto("/demo/1");
  const og = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(og).toMatch(/\/demo\/1\/opengraph-image/);
  const res = await request.get(new URL(og!).pathname + new URL(og!).search);
  expect(res.headers()["content-type"]).toContain("image/png");
  const png = await res.body();
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  expect(await page.locator('meta[name="twitter:card"]').getAttribute("content")).toBe("summary_large_image");
});

test("tamper mode: a slow check of the unedited card can't overwrite the red result", async ({ page }) => {
  await page.goto("/demo/1?verify=1");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "pass", { timeout: 60_000 });
  // From now on, hold the registry's answer about the UNEDITED card for 4 s, so the check
  // started by turning tamper mode on finishes after the check of the edited card.
  let delayed = 0;
  // Any NEAR RPC endpoint the app may fall back to.
  await page.route(/rpc\.testnet\.(fastnear|near)\.com|test\.rpc\.fastnear\.com/, async (route) => {
    try {
      const body = route.request().postDataJSON() ?? {};
      const args = body?.params?.args_base64 ? JSON.parse(Buffer.from(body.params.args_base64, "base64").toString()) : {};
      if (typeof args.card_json === "string" && args.card_json.includes('"return_bps":1494')) {
        delayed++;
        await new Promise((r) => setTimeout(r, 4_000));
      }
    } catch (e) {
      console.log("route handler:", e);
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Tamper mode" }).click();
  await page.waitForTimeout(1_000); // past the edit debounce: the unedited check is now in flight
  await page.getByLabel("Return %").fill("34.94");
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "fail", { timeout: 60_000 });
  await page.waitForTimeout(6_000); // let the delayed, stale check finish
  await expect(page.locator("[data-verdict]")).toHaveAttribute("data-verdict", "fail");
  expect(delayed).toBeGreaterThan(0); // the race was really staged
});

test("the header switch changes the board and the create flow, not card addresses", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.locator("[data-board-status]")).toContainText("testnet", { ignoreCase: true, timeout: 60_000 });
  await page.getByRole("button", { name: "mainnet" }).click();
  await expect(page.locator("[data-board-status]")).toContainText("mainnet", { ignoreCase: true, timeout: 60_000 });
  await page.reload();
  await expect(page.locator("[data-board-status]")).toContainText("mainnet", { ignoreCase: true, timeout: 60_000 });
  await expect(page.locator('[data-card-row^="proveit-demo-registry"]')).toHaveCount(0);
  await page.goto("/demo/3");
  await expect(page.getByText("demo card").first()).toBeVisible();
  await page.goto("/create");
  await page.getByRole("button", { name: "Connect" }).first().click();
  await expect(page.getByText("Network: mainnet")).toBeVisible();
});
