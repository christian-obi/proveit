// The docs page, and the same content in the plain forms AI readers fetch.

import { expect, test } from "@playwright/test";

test("/docs renders the docs and points to the Markdown version", async ({ page }) => {
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1, name: "Prove-It documentation" })).toBeVisible();
  await expect(page.locator('link[rel="alternate"][type="text/markdown"]')).toHaveAttribute("href", /\/docs\.md$/);
  await page.getByRole("link", { name: "The five checks" }).first().click();
  await expect(page).toHaveURL(/\/docs\/the-five-checks$/);
  await expect(page.locator("#the-five-checks")).toBeVisible();
});

test("every page in SUMMARY.md is also served as Markdown and listed in llms.txt", async ({ request }) => {
  const index = await (await request.get("/llms.txt")).text();
  for (const page of ["the-five-checks", "reference/http-api"]) {
    expect(index).toContain(`/docs/${page}.md`);
    const md = await request.get(`/docs/${page}.md`);
    expect(md.status()).toBe(200);
    expect(md.headers()["content-type"]).toContain("text/markdown");
    expect(await md.text()).toMatch(/^# /);
  }
  expect((await request.get("/docs/no-such-page.md")).status()).toBe(404);
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
