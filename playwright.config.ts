import { defineConfig, devices } from "@playwright/test";

// Dedicated port avoids clashing with a normal `npm run dev` on 3000 — when
// 3000 is taken, Next falls back to 3001 while Playwright still used baseURL
// 3000, so tests hit the wrong host or hung.
const e2ePort = process.env.E2E_PORT || "3050";
const defaultBase = `http://localhost:${e2ePort}`;
const baseURL = process.env.E2E_BASE_URL || defaultBase;
const useExternalServer = !!process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/global-setup.ts"],
  // Clear the mustResetPassword flag on seeded test users before any test
  // runs, so the smoke suite can log straight into /dashboard. See
  // e2e/global-setup.ts for the reasoning.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  timeout: 30000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer:
    process.env.CI || useExternalServer
      ? undefined
      : {
          command: `npm run dev -- --port ${e2ePort}`,
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120000,
        },
});
