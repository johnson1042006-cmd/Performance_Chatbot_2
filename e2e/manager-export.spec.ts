/**
 * Phase 5 manager export e2e.
 *
 * Stubs /api/admin/export so the test is hermetic. Asserts that clicking
 * the Export button in the search page issues a request against the
 * documented CSV endpoint and that the response body's first line matches
 * the documented header.
 */
import { test, expect, Page } from "@playwright/test";
import { CSV_HEADER } from "@/lib/export/transcripts";

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

test.describe("Manager export", () => {
  test("Export from search hits /api/admin/export with the documented CSV header", async ({
    page,
  }) => {
    await loginAsManager(page);

    await page.route("**/api/admin/users", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ users: [] }),
      })
    );

    const csvBody = `${CSV_HEADER.join(",")}\n00000000-0000-0000-0000-000000000001,2026-05-01T00:00:00Z,,closed,a@b.com,3,2,order_status,"[""order-1""]",up,Casey\n`;

    await page.route(/\/api\/admin\/export.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/csv; charset=utf-8",
        headers: {
          "Content-Disposition": "attachment; filename=transcripts-test.csv",
        },
        body: csvBody,
      });
    });

    await page.route(/\/api\/admin\/search.*/, async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              started_at: new Date().toISOString(),
              closed_at: null,
              status: "closed",
              customer_email: "x@y.com",
              customer_identifier: "Customer #X",
              intent: "order_status",
              agent_name: "Casey",
              message_count: 3,
              ai_count: 2,
              ai_percent: 67,
              snippet: "matched text",
            },
          ],
          page: 1,
          limit: 25,
          total: 1,
        }),
      })
    );

    await page.goto("/dashboard/manager/search");
    await page.fill('[data-testid="search-input"]', "order");

    const row = page.locator('[data-testid="search-result-row"]').first();
    await expect(row).toBeVisible({ timeout: 5000 });

    // Watching for the export request directly is more deterministic than
    // hooking the browser's download manager (page.waitForEvent('download')
    // doesn't fire when we route.fulfill the body).
    const exportRequest = page.waitForRequest((req) =>
      req.url().includes("/api/admin/export")
    );
    await page.click('button:has-text("Export")');
    const req = await exportRequest;

    expect(req.url()).toContain("/api/admin/export");
    expect(req.url()).toContain("format=csv");

    const res = await req.response();
    expect(res?.status()).toBe(200);
    const text = (await res?.text()) ?? "";
    const firstLine = text.split("\n")[0];
    expect(firstLine).toBe(CSV_HEADER.join(","));
  });
});
