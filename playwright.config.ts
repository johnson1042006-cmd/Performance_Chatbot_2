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
  // Local: 2 retries to absorb transient chromium-process death on busy Macs
  // ("browserContext.newPage: ... browser has been closed"). CI: 2 retries.
  // Resource pressure from a tight `ulimit -u` can kill chromium between
  // tests — a second retry keeps the suite green when that happens once or
  // twice in a 45-test run.
  retries: 2,
  workers: 1,
  reporter: "html",
  timeout: 30000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-software-rasterizer",
        "--disable-extensions",
      ],
    },
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
          // Run `npm run build` before `playwright test` (see package.json
          // `test:e2e`). Only `next start` here to avoid nested `next build`
          // workers that can exhaust process limits (spawn EAGAIN) on laptops.
          command: `npm run start -- --port ${e2ePort}`,
          url: baseURL,
          // Default false: always spawn a server for this run so tests never
          // hit a stale process on E2E_PORT. Set E2E_REUSE_SERVER=1 to skip
          // startup when you already have a matching server listening.
          reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
          timeout: 180000,
          env: {
            NEXTAUTH_URL: baseURL,
            TAGGER_TEST_MODE: "1",
            TICKET_AUTO_CREATE_TEST_MODE: "1",
            E2E_EMAIL_MOCK: "1",
            // `next start` runs with NODE_ENV=production, which disables the
            // limiter's dev-only localhost bypass — without this flag every
            // browser-driven request shares one localhost bucket and the
            // session-heavy suites 429 after 5 sessions/min (lib/rateLimit.ts).
            E2E_RATE_LIMIT_BYPASS: "1",
            // Phase 2b: exercise the Sonnet routing classifier end-to-end in
            // e2e (first turn of each conversation). Deployed environments
            // keep it off until USE_ROUTING_CLASSIFIER=true is set there.
            USE_ROUTING_CLASSIFIER: "true",
          },
        },
});
