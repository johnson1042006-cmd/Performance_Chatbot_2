/**
 * Phase 5 tagger e2e.
 *
 * Creates a fresh session, closes it via the manager API, then polls
 * /api/sessions/{id} for up to 10 s to assert that the AI tagger filled
 * in the `intent` column. The dev-server env sets TAGGER_TEST_MODE=1 so
 * tagging never hits Anthropic.
 *
 * Even with an empty transcript the tagger persists a fail-open
 * `{intent: "other", ...}` row, so this test runs hermetically without
 * needing a separate message-insertion API.
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

async function pollIntent(
  request: APIRequestContext,
  sessionId: string,
  timeoutMs = 10000
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await request.get(`/api/sessions/${sessionId}`);
    if (res.ok()) {
      const data = await res.json();
      const intent = data?.session?.intent ?? null;
      if (intent) return intent;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.describe("Tagger on close", () => {
  test("Closing a session within 10 s populates sessions.intent", async ({
    page,
    request,
  }) => {
    // Step 1: anonymously create a fresh session.
    const createRes = await request.post("/api/sessions", {
      data: {
        customerIdentifier: `e2e_tagger_${Date.now()}`,
        pageContext: null,
      },
    });
    expect(createRes.status(), await createRes.text()).toBeLessThan(300);
    const created = await createRes.json();
    const sessionId: string = created?.session?.id;
    expect(sessionId).toBeTruthy();

    // Step 2: log in as manager and close the session.
    await loginAsManager(page);
    const closeRes = await page.request.post("/api/sessions/close", {
      data: { sessionId },
    });
    expect(closeRes.ok(), await closeRes.text()).toBe(true);

    // Step 3: poll until the tagger has persisted the intent column.
    const intent = await pollIntent(request, sessionId, 10000);
    expect(intent).not.toBeNull();
  });
});
