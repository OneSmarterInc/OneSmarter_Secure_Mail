import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 12000 },
  reporter: "list",
  use: {
    baseURL: process.env.E2E_URL || "http://127.0.0.1:5174",
    browserName: "chromium",
    channel: process.env.E2E_BROWSER || "msedge",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "off",
  },
});
