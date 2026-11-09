// The docs page, and the same content in the plain forms AI readers fetch.

import { expect, test } from "@playwright/test";

test("/docs renders the docs and points to the Markdown version", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Prove-It documentation" })).toBeVisible();
  await expect(page.locator("#the-five-checks")).toBeVisible();
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", /\/docs\.md$/);
});

test("AI readers get plain text without JavaScript", async ({ request }) => {
  const md = await request.get("/docs.md");
  expect(md.headers()["content-type"]).toContain("text/markdown");
  expect(await md.text()).toContain("## The five checks");

  const full = await request.get("/llms-full.txt");
  expect(await full.text()).toBe(await (await request.get("/docs.md")).text());

  const index = await (await request.get("/llms.txt")).text();
  expect(index).toMatch(/^# Prove-It\n\n> /);
  expect(index).toContain("/docs.md");

  const html = await (await request.get("/docs")).text();
  expect(html).toContain("The five checks");
});
