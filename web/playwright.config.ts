import { defineConfig } from "@playwright/test";

// T5.3. Runs the app with NEXT_PUBLIC_E2E=1 (fake NEAR wallet) on localhost:3000, which the
// OutLayer keystore allows, so the direct path is exercised; one test forces the relay.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm exec next dev -p 3000",
    url: "http://localhost:3000/healthz",
    env: { NEXT_PUBLIC_E2E: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
