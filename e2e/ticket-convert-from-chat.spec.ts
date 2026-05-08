/**
 * Phase 5.5 e2e: the "Convert to Ticket" path (POST /api/tickets with
 * source='chat'). Mirrors the call ChatPanel.tsx makes when a manager
 * clicks the button on a claimed session.
 *
 * Verifies:
 *   - manual-from-chat creation succeeds against a claimed session,
 *   - dedupe kicks in on a second attempt for the same session (409),
 *   - the ticket appears in GET /api/tickets,
 *   - the linked ticket surfaces on GET /api/sessions.
 */
import { test, expect, Page, APIRequestContext } from "@playwright/test";

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

async function findSessionTicketLink(
  request: APIRequestContext,
  sessionId: string,
  timeoutMs = 5000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get("/api/sessions");
    if (res.ok()) {
      const data = await res.json();
      const found = (data.sessions ?? []).find(
        (s: { id: string }) => s.id === sessionId
      );
      if (found?.linkedTicket?.id) return found.linkedTicket;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

test.describe("Convert chat to ticket", () => {
  test("manager converts a claimed chat into a ticket, dedupe holds, linkedTicket surfaces", async ({
    page,
    request,
  }) => {
    // Step 1: anonymously create a fresh session.
    const createSession = await request.post("/api/sessions", {
      data: {
        customerIdentifier: `e2e_convert_${Date.now()}`,
        pageContext: null,
      },
    });
    expect(
      createSession.status(),
      await createSession.text()
    ).toBeLessThan(300);
    const sessJson = await createSession.json();
    const sessionId: string = sessJson?.session?.id;
    expect(sessionId).toBeTruthy();

    // Step 2: log in as manager. Managers bypass the "must be claimed
    // by requester" check on POST /api/tickets source='chat', so we
    // don't need to claim the session first.
    await loginAsManager(page);

    const convertRes = await page.request.post("/api/tickets", {
      data: {
        sessionId,
        source: "chat",
        subject: "E2E convert-to-ticket",
        priority: "high",
      },
    });
    expect(convertRes.status(), await convertRes.text()).toBe(201);
    const convertBody = await convertRes.json();
    const ticketId: string = convertBody?.ticket?.id;
    const ticketNumber: number = convertBody?.ticket?.ticketNumber;
    expect(ticketId).toBeTruthy();
    expect(typeof ticketNumber).toBe("number");

    // Step 3: dedupe — a second POST returns 409.
    const dupeRes = await page.request.post("/api/tickets", {
      data: {
        sessionId,
        source: "chat",
        subject: "E2E convert-to-ticket again",
        priority: "high",
      },
    });
    expect(dupeRes.status()).toBe(409);
    const dupeBody = await dupeRes.json();
    expect(dupeBody.ticketId).toBe(ticketId);

    // Step 4: GET /api/tickets returns it (manager scope).
    const listRes = await page.request.get("/api/tickets");
    expect(listRes.ok()).toBe(true);
    const list = await listRes.json();
    const matched = (list.tickets ?? []).find(
      (t: { id: string }) => t.id === ticketId
    );
    expect(matched, "expected the new ticket to appear in /api/tickets").toBeTruthy();
    expect(matched.sessionId).toBe(sessionId);

    // Step 5: linkedTicket surfaces on /api/sessions.
    const link = await findSessionTicketLink(page.request, sessionId);
    expect(link?.id).toBe(ticketId);
    expect(link?.ticketNumber).toBe(ticketNumber);
  });
});
