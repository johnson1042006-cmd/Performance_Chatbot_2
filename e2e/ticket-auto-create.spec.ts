/**
 * Phase 5.5 e2e: closing a chat with frustrated customer messages should
 * auto-create a ticket via the lib/tickets/autoCreate pipeline. The
 * webServer is started with TICKET_AUTO_CREATE_TEST_MODE=1 so the keyword
 * matcher in autoCreate keys off "frustrated" → priority='urgent'.
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

async function pollForTicket(
  request: APIRequestContext,
  sessionId: string,
  timeoutMs = 10000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get("/api/tickets?status=open,pending,resolved,closed");
    if (res.ok()) {
      const data = await res.json();
      const match = (data.tickets ?? []).find(
        (t: { sessionId: string | null }) => t.sessionId === sessionId
      );
      if (match) return match;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.describe("Ticket auto-create on close", () => {
  test("closing a frustrated session creates an urgent ticket", async ({
    page,
    request,
  }) => {
    // Step 1: anonymously create a fresh session and post 3 customer
    // messages that contain the test-mode marker word "frustrated".
    const createRes = await request.post("/api/sessions", {
      data: {
        customerIdentifier: `e2e_ticket_${Date.now()}`,
        pageContext: null,
      },
    });
    expect(createRes.status(), await createRes.text()).toBeLessThan(300);
    const created = await createRes.json();
    const sessionId: string = created?.session?.id;
    expect(sessionId).toBeTruthy();

    for (const text of [
      "I am frustrated with this order!",
      "Please help, I am still frustrated.",
      "Frustrated customer here, where is my package?",
    ]) {
      // Direct DB inserts via the customer chat endpoint would require a
      // Pusher subscription; the close hook only needs at least one
      // customer message to compute a subject. We rely on the existing
      // `/api/chat` to persist a customer turn.
      await request.post("/api/chat", {
        data: {
          message: text,
          sessionId,
          pageContext: null,
        },
      });
    }

    // Step 2: log in as manager and close the session (this runs the
    // tagger + auto-ticket fire-and-forget hooks on the server).
    await loginAsManager(page);
    const closeRes = await page.request.post("/api/sessions/close", {
      data: { sessionId },
    });
    expect(closeRes.ok(), await closeRes.text()).toBe(true);

    // Step 3: poll the ticket list — within 10 s the autoCreate
    // semaphore should drain and the ticket appear.
    const ticket = await pollForTicket(page.request, sessionId, 10000);
    expect(ticket, "expected a ticket to be auto-created for the session").not.toBeNull();
    expect(ticket.priority).toBe("urgent");
    expect(ticket.source).toBe("auto");
    expect(ticket.status).toBe("open");
  });
});
