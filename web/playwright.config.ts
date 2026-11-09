import { defineConfig } from "@playwright/test";

// T5.3. Runs the app with NEXT_PUBLIC_E2E=1 (fake NEAR wallet) on localhost:3000, which the
// OutLayer keystore allows, so the direct path is exercised; one test forces the relay.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    // A production build: the dev server reloads pages mid-test, and this is what ships.
    command: "pnpm exec next build && pnpm exec next start -p 3000",
    url: "http://localhost:3000/healthz",
    env: { NEXT_PUBLIC_E2E: "1", REACTIONS_PATH: "test-results/reactions.json" },
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
