/**
 * Phase 5.5 e2e: ticket comment thread visibility + first-response stamp.
 *
 * Verifies through the API that:
 *   - A staff GET on /api/tickets/[id] returns BOTH internal and public
 *     comments (the in-route filter is currently a defensive guard for
 *     a future customer-facing surface).
 *   - The very first non-internal staff comment stamps
 *     `tickets.first_response_at`; an internal-only first comment does
 *     not.
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
}

test.describe("Ticket comments", () => {
  test("first non-internal comment stamps first_response_at; internal stays private to staff feed", async ({
    page,
  }) => {
    await loginAsManager(page);

    // Step 1: create a manual ticket as the manager.
    const createRes = await page.request.post("/api/tickets", {
      data: {
        subject: "E2E comments thread",
        priority: "normal",
        source: "manual",
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = await createRes.json();
    const ticketId: string = created?.ticket?.id;
    expect(ticketId).toBeTruthy();

    // Step 2: post an INTERNAL note first. This must NOT stamp
    // first_response_at.
    const internalRes = await page.request.post(
      `/api/tickets/${ticketId}/comments`,
      {
        data: { body: "internal triage note", isInternal: true },
      }
    );
    expect(internalRes.status(), await internalRes.text()).toBe(201);

    let detailRes = await page.request.get(`/api/tickets/${ticketId}`);
    expect(detailRes.ok()).toBe(true);
    let detail = await detailRes.json();
    expect(detail.ticket.firstResponseAt).toBeNull();
    expect(detail.comments.length).toBe(1);
    expect(detail.comments[0].isInternal).toBe(true);

    // Step 3: post a PUBLIC reply. This is the first non-internal
    // staff comment so first_response_at must now be set.
    const publicRes = await page.request.post(
      `/api/tickets/${ticketId}/comments`,
      {
        data: { body: "thanks, we are looking into this", isInternal: false },
      }
    );
    expect(publicRes.status(), await publicRes.text()).toBe(201);

    detailRes = await page.request.get(`/api/tickets/${ticketId}`);
    detail = await detailRes.json();

    expect(detail.ticket.firstResponseAt).toBeTruthy();
    expect(detail.comments.length).toBe(2);

    // Both internal + public are visible in the staff thread (in
    // chronological order).
    const flags = detail.comments
      .map((c: { isInternal: boolean }) => c.isInternal)
      .sort();
    expect(flags).toEqual([false, true]);
  });
});
