/**
 * Phase 5 manager search e2e.
 *
 * Stubs /api/admin/search so the test is hermetic and doesn't require any
 * particular Tech-Air content in the test database. We assert that:
 *   - the search input wires the q= query string through to the API
 *   - rendered rows include the snippet column with <mark> highlights
 *   - the UI shows the result count returned by the stub
 */
import { test, expect, Page } from "@playwright/test";

const MANAGER_EMAIL =
  process.env.E2E_MANAGER_EMAIL || "manager@performancecycle.com";
const MANAGER_PASS = process.env.E2E_MANAGER_PASS || "manager123";

async function loginAsManager(page: Page) {
  await page.goto("/login");
  await page.fill('input[id="email"]', MANAGER_EMAIL);
  await page.fill('input[id="password"]', MANAGER_PASS);
  const credsDone = page.waitForResponse(
    (r) => r.url().includes("/api/auth/callback/credentials"),
    { timeout: 45000 }
  );
  await page.click('button[type="submit"]');
  await credsDone;
  await page.goto("/dashboard/manager");
}

test.describe("Manager search", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/admin/users", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [] }),
      })
    );
    await page.route(/\/api\/admin\/search.*/, async (route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams.get("q") ?? "";
      if (!q) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ results: [], page: 1, limit: 25, total: 0 }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              started_at: new Date().toISOString(),
              closed_at: null,
              status: "closed",
              customer_email: "rider@example.com",
              customer_identifier: "Customer #ABCD",
              intent: "tech_air_service",
              agent_name: "Casey Agent",
              message_count: 8,
              ai_count: 5,
              ai_percent: 62,
              snippet:
                "Question about the <mark>Tech-Air</mark> 5 servicing schedule",
            },
          ],
          page: 1,
          limit: 25,
          total: 1,
        }),
      });
    });
  });

  test("search 'Tech-Air' returns a row with a <mark> highlight", async ({
    page,
  }) => {
    await loginAsManager(page);
    await page.goto("/dashboard/manager/search");
    await page.fill('[data-testid="search-input"]', "Tech-Air");

    // Debounce is 300 ms; give the network response a generous window.
    const row = page.locator('[data-testid="search-result-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });

    const snippet = page.locator('[data-testid="search-result-snippet"]').first();
    await expect(snippet).toBeVisible();
    const html = await snippet.innerHTML();
    expect(html.toLowerCase()).toContain("<mark>");
    expect(html.toLowerCase()).toContain("tech-air");

    await expect(page.locator("text=1 match")).toBeVisible();
  });
});
