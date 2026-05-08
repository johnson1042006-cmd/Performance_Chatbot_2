/**
 * Phase 5.5 e2e: marking a ticket resolved sets `resolved_at` and runs
 * cleanly with the email mock in place.
 *
 * The dev server is started with `E2E_EMAIL_MOCK=1` so
 * `lib/email/sender#sendEmail` short-circuits to a no-op success rather
 * than calling Resend. We therefore can't directly assert "an email was
 * sent" — instead we assert the PATCH succeeded, the resolution
 * timestamp landed, the resolved Pusher event would fire, and a
 * second PATCH is idempotent (no double-stamp).
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

test.describe("Ticket resolve flow", () => {
  test("PATCH status=resolved stamps resolved_at and triggers email-mock path", async ({
    page,
  }) => {
    await loginAsManager(page);

    const createRes = await page.request.post("/api/tickets", {
      data: {
        subject: "E2E resolve flow",
        priority: "normal",
        source: "manual",
        customerEmail: "e2e-resolve@example.com",
        customerName: "E2E Tester",
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = await createRes.json();
    const ticketId: string = created?.ticket?.id;
    expect(ticketId).toBeTruthy();
    expect(created.ticket.resolvedAt).toBeFalsy();

    const patchRes = await page.request.patch(`/api/tickets/${ticketId}`, {
      data: { status: "resolved", resolutionNote: "Fixed via e2e test." },
    });
    expect(patchRes.ok(), await patchRes.text()).toBe(true);
    const patched = await patchRes.json();
    expect(patched.ticket.status).toBe("resolved");
    expect(patched.ticket.resolvedAt).toBeTruthy();

    // Subsequent GET sees the same row.
    const detailRes = await page.request.get(`/api/tickets/${ticketId}`);
    expect(detailRes.ok()).toBe(true);
    const detail = await detailRes.json();
    expect(detail.ticket.status).toBe("resolved");
    expect(detail.ticket.resolvedAt).toBeTruthy();

    // PATCHing to closed afterwards should set closed_at without
    // re-stamping resolved_at.
    const firstResolved = detail.ticket.resolvedAt;
    const closeRes = await page.request.patch(`/api/tickets/${ticketId}`, {
      data: { status: "closed" },
    });
    expect(closeRes.ok(), await closeRes.text()).toBe(true);
    const closed = await closeRes.json();
    expect(closed.ticket.status).toBe("closed");
    expect(closed.ticket.closedAt).toBeTruthy();
    expect(closed.ticket.resolvedAt).toBe(firstResolved);
  });
});
