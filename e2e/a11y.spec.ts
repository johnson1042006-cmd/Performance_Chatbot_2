import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function runAxe(page: import("@playwright/test").Page, label: string) {
  // Legacy mode avoids finishRun()'s spare context.newPage() merge step (flaky
  // "browser has been closed" on some Chromium setups).
  const results = await new AxeBuilder({ page }).setLegacyMode(true).analyze();

  const seriousOrCritical = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact || "")
  );
  const moderateOrMinor = results.violations.filter((v) =>
    ["moderate", "minor"].includes(v.impact || "")
  );

  if (moderateOrMinor.length) {
    // eslint-disable-next-line no-console
    console.log(
      `[axe][warn] ${label}:`,
      moderateOrMinor.map((v) => `${v.id} (${v.impact})`).join(", ")
    );
  }

  expect(
    seriousOrCritical,
    seriousOrCritical
      .map((v) => `${v.id} (${v.impact}) - ${v.description}`)
      .join("\n")
  ).toHaveLength(0);
}

test.describe("Accessibility (axe)", () => {
  test("embed + login + manager pages", async ({ page }) => {
    await page.goto("/embed");
    await runAxe(page, "/embed (widget closed)");

    // Open widget (chips visible initially due to auto-open config in e2e stubs).
    // The /embed page itself renders the widget; we just ensure the input exists.
    await page.getByTestId("chat-input").waitFor({ timeout: 10000 });
    await runAxe(page, "/embed (widget open)");

    // Order lookup form
    await page.getByTestId("chip-track_order").click();
    await page.getByTestId("order-lookup-form").waitFor();
    await runAxe(page, "/embed (order lookup form)");
    await page.getByLabel("Cancel").click();

    // Tire fitment form
    await page.getByTestId("chip-find_tires").click();
    await page.getByTestId("tire-fitment-form").waitFor();
    await runAxe(page, "/embed (tire fitment form)");
    await page.getByLabel("Cancel").click();

    // End-of-session card: stub close by navigating to a real close path is complex;
    // we at least load the page and assert baseline a11y.

    await page.goto("/login");
    await runAxe(page, "/login");

    // Manager pages require auth; Playwright global-setup seeds users and allows login.
    // Reuse the existing login flow from smoke test by posting credentials.
    await page.goto("/login");
    await page.getByLabel("Email").fill("manager@performancecycle.com");
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.goto("/dashboard/manager");
    await runAxe(page, "/dashboard/manager");

    await page.goto("/dashboard/manager/tickets");
    await runAxe(page, "/dashboard/manager/tickets");
  });
});

