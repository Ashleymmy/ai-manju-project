import { defineConfig, devices } from "@playwright/test";

const providerPort = Number(process.env.E2E_PROVIDER_PORT || 45991);

export default defineConfig({
  testDir: "./apps/studio/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./apps/studio/e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: "node apps/studio/e2e/mock-provider-server.mjs",
    url: `http://127.0.0.1:${providerPort}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: { E2E_PROVIDER_PORT: String(providerPort) },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
