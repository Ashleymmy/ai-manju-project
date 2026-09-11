import { defineConfig, devices } from "@playwright/test";

// 禁止默认值悄悄连接用户的 3100/3101 或已有生产数据库。
if (process.env.E2E_PHASE2_BROWSER !== "isolated-mock" ||
    process.env.E2E_BASE_URL !== "http://127.0.0.1:33110" ||
    process.env.E2E_API_URL !== process.env.E2E_BASE_URL ||
    !process.env.E2E_ADMIN_ACCOUNT?.startsWith("phase2-")) {
  throw new Error("Run scripts/sdvideo-phase2-e2e.py --browser with isolated compose.mock-deps");
}

export default defineConfig({
  testDir: "./apps/studio/e2e",
  testMatch: "sdvideo-phase2.spec.ts",
  outputDir: ".tmp/sdvideo-phase2/browser/results",
  timeout: 90_000,
  globalTimeout: 540_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: ".tmp/sdvideo-phase2/browser/report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
