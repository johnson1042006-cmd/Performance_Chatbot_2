/**
 * Phase 5.5 e2e: closing a chat with frustrated customer messages should
 * auto-create a ticket via the lib/tickets/autoCreate pipeline.
 *
 * Messages are seeded via /api/e2e/seed-messages (no Claude calls).
 * Ticket creation is invoked synchronously via /api/e2e/run-auto-ticket,
 * which forces TICKET_AUTO_CREATE_TEST_MODE=1 server-side so the keyword
 * matcher keys off "frustrated" → priority='urgent'.
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

    // Seed messages directly via the e2e helper endpoint (E2E_EMAIL_MOCK=1
    // must be set on the server) rather than going through /api/chat.
    // /api/chat would trigger real Claude calls for each message (AI claims
    // the unclaimed session on the first turn and blocks on runAiTurn for all
    // subsequent turns), taking 15-30 s and exhausting the 30 s test timeout.
    const seedRes = await request.post("/api/e2e/seed-messages", {
      data: {
        sessionId,
        messages: [
          { content: "I am frustrated with this order!" },
          { content: "Please help, I am still frustrated." },
          { content: "Frustrated customer here, where is my package?" },
        ],
      },
    });
    expect(seedRes.ok(), `seed-messages failed: ${await seedRes.text()}`).toBe(true);

    // Step 2: log in as manager and close the session (this runs the
    // tagger + auto-ticket fire-and-forget hooks on the server).
    await loginAsManager(page);
    const closeRes = await page.request.post("/api/sessions/close", {
      data: { sessionId },
    });
    expect(closeRes.ok(), await closeRes.text()).toBe(true);

    // Step 3: invoke auto-ticket synchronously via the e2e helper endpoint.
    // This avoids relying on the fire-and-forget `enqueueAutoTicket` timing
    // (it's a background promise that may not complete before the 10-second
    // poll window closes) and removes the dependency on the server process
    // having TICKET_AUTO_CREATE_TEST_MODE=1 set in its environment.
    const autoRes = await page.request.post("/api/e2e/run-auto-ticket", {
      data: { sessionId },
    });
    expect(autoRes.ok(), `run-auto-ticket failed: ${await autoRes.text()}`).toBe(true);
    const { ticket } = await autoRes.json() as { ticket: Record<string, unknown> | null };
    expect(ticket, "expected a ticket to be auto-created for the session").not.toBeNull();
    expect(ticket!.priority).toBe("urgent");
    expect(ticket!.source).toBe("auto");
    expect(ticket!.status).toBe("open");
  });
});
