/**
 * Phase 4 agent-productivity e2e suite.
 *
 * Heavily uses page.route stubs so the tests don't depend on real DB state,
 * agent presence, or live Anthropic credentials. We stub /api/sessions,
 * /api/sessions/{id}/messages, /api/sessions/{id}/notes, /api/canned, and
 * /api/sessions/{id}/ai-suggest so we can verify the UI flows deterministically.
 */
import { test, expect, Page } from "@playwright/test";

const AGENT_EMAIL =
  process.env.E2E_AGENT_EMAIL || "agent@performancecycle.com";
const AGENT_PASS = process.env.E2E_AGENT_PASS || "agent123";
const MANAGER_EMAIL =
  process.env.E2E_MANAGER_EMAIL || "manager@performancecycle.com";
const MANAGER_PASS = process.env.E2E_MANAGER_PASS || "manager123";

const SESSION_A = "11111111-1111-1111-1111-111111111111";
const SESSION_B = "22222222-2222-2222-2222-222222222222";

interface SessionStub {
  id: string;
  customerIdentifier: string;
  pageContext: null;
  startedAt: string;
  status: string;
  claimedByUserId: string | null;
  claimedByKind: string | null;
  claimedBy: { id: string; name: string } | null;
  customerCity: string | null;
  customerRegion: string | null;
  customerCountry: string | null;
  lastCustomerActivityAt: string;
}

function makeSessionStub(
  id: string,
  identifier: string,
  overrides: Partial<SessionStub> = {}
): SessionStub {
  return {
    id,
    customerIdentifier: identifier,
    pageContext: null,
    startedAt: new Date().toISOString(),
    status: "waiting",
    claimedByUserId: null,
    claimedByKind: null,
    claimedBy: null,
    customerCity: "Denver",
    customerRegion: "CO",
    customerCountry: "US",
    lastCustomerActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Log in by waiting for the NextAuth credentials fetch response (which
 * carries the Set-Cookie header) then doing a hard page.goto("/dashboard").
 *
 * Why not waitForURL?  The login page uses `redirect: false` + router.push.
 * Next.js's app-router prefetches /dashboard before Set-Cookie is committed,
 * the prefetch goes out without the session cookie, middleware bounces the
 * browser to /login?callbackUrl=…, and waitForURL spins forever because the
 * callbackUrl variant never has ?error=.
 *
 * By waiting for the *response* we know the cookie is in the jar, then we
 * navigate directly — Playwright's page.goto is a full browser navigation
 * that always sends the latest cookies, bypassing the prefetch race.
 */
async function loginAsAgent(page: Page) {
  await page.goto("/login");
  await page.fill('input[id="email"]', AGENT_EMAIL);
  await page.fill('input[id="password"]', AGENT_PASS);
  // 45 s covers Neon serverless cold-start on the first credentials check.
  const credsDone = page.waitForResponse(
    (r) => r.url().includes("/api/auth/callback/credentials"),
    { timeout: 45000 }
  );
  await page.click('button[type="submit"]');
  await credsDone;
  // Cookie is now committed — hard-navigate to dashboard.
  await page.goto("/dashboard");
}

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
  await page.goto("/dashboard");
}

async function stubChatsRoutes(
  page: Page,
  opts: {
    sessions: SessionStub[];
    /** Per-session message lists, keyed by session id. */
    messages?: Record<string, Array<Record<string, unknown>>>;
    canned?: Array<{ id: string; title: string; body: string; category: string }>;
    aiSuggestion?: string;
    /** Initial notes (newest first) keyed by session id. */
    notes?: Record<
      string,
      Array<{ id: string; body: string; authorName: string; createdAt: string }>
    >;
  }
) {
  const sessionsState: SessionStub[] = [...opts.sessions];
  const notesState: Record<
    string,
    Array<{ id: string; body: string; authorName: string; createdAt: string }>
  > = { ...(opts.notes ?? {}) };

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sessions: sessionsState,
          unclaimedCount: sessionsState.filter((s) => s.status === "waiting")
            .length,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Single-session GET
  for (const s of sessionsState) {
    await page.route(`**/api/sessions/${s.id}`, async (route) => {
      const current = sessionsState.find((x) => x.id === s.id) ?? s;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: current }),
      });
    });
  }

  // Messages
  await page.route(/\/api\/sessions\/[^/]+\/messages$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/")[3];
    const list = opts.messages?.[id] ?? [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: list }),
    });
  });

  // Trace (so AI Trace tab doesn't error)
  await page.route(/\/api\/sessions\/[^/]+\/trace$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [] }),
    });
  });

  // Heartbeat / typing — no-op
  await page.route(/\/api\/sessions\/[^/]+\/heartbeat$/, (route) =>
    route.fulfill({ status: 200, body: "{}" })
  );
  await page.route(/\/api\/sessions\/[^/]+\/typing$/, (route) =>
    route.fulfill({ status: 200, body: "{}" })
  );

  // Claim — flip the session in-memory and fall through to handler.
  await page.route("**/api/sessions/claim", async (route) => {
    const body = route.request().postDataJSON() as { sessionId: string };
    const idx = sessionsState.findIndex((s) => s.id === body.sessionId);
    if (idx >= 0) {
      sessionsState[idx] = {
        ...sessionsState[idx],
        status: "active_human",
        claimedByKind: "human",
        claimedByUserId: "agent-1",
        claimedBy: { id: "agent-1", name: "Test Agent" },
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: sessionsState[idx] }),
      });
    } else {
      await route.fulfill({ status: 404, body: "{}" });
    }
  });

  // Release / close — drop the session.
  await page.route("**/api/sessions/release", async (route) => {
    const body = route.request().postDataJSON() as { sessionId: string };
    const idx = sessionsState.findIndex((s) => s.id === body.sessionId);
    if (idx >= 0) {
      sessionsState[idx] = {
        ...sessionsState[idx],
        status: "waiting",
        claimedByKind: null,
        claimedByUserId: null,
        claimedBy: null,
      };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: sessionsState[idx] ?? null }),
    });
  });
  await page.route("**/api/sessions/close", async (route) => {
    await route.fulfill({ status: 200, body: "{}" });
  });

  // Canned replies (with placeholder substitution already applied)
  await page.route("**/api/canned*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        replies:
          opts.canned ??
          [
            {
              id: "canned-1",
              title: "Greeting",
              body: "Hi there! How can I help you today?",
              category: "openers",
            },
            {
              id: "canned-2",
              title: "Thanks",
              body: "Thanks for reaching out — call us at 303-744-2011.",
              category: "closers",
            },
          ],
      }),
    });
  });

  // AI suggest
  await page.route(/\/api\/sessions\/[^/]+\/ai-suggest$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestion:
          opts.aiSuggestion ??
          "Based on what you mentioned, I'd recommend the Bell helmet. Want details?",
      }),
    });
  });

  // Notes
  await page.route(/\/api\/sessions\/[^/]+\/notes$/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/")[3];
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { body: string };
      const note = {
        id: `note-${Date.now()}`,
        body: body.body,
        authorName: "Test Agent",
        createdAt: new Date().toISOString(),
      };
      notesState[id] = [note, ...(notesState[id] ?? [])];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ note }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notes: notesState[id] ?? [] }),
      });
    }
  });

  // Customer history (empty)
  await page.route(
    /\/api\/sessions\/by-customer\/[^/]+/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ history: [] }),
      });
    }
  );

  // Settings — agent-readable
  await page.route("**/api/chat/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        aiEnabled: true,
        fallbackTimerSeconds: 60,
        hotkeysEnabled: true,
      }),
    })
  );

  // Send agent message (POST /api/chat) — capture and echo.
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        message: string;
        sessionId: string;
        agentName?: string;
      };
      const msg = {
        id: `msg-${Date.now()}`,
        sessionId: body.sessionId,
        role: "agent",
        content: body.message,
        sentAt: new Date().toISOString(),
        agentName: body.agentName ?? "Test Agent",
      };
      // Append to messages stub so the next /messages poll renders it.
      if (opts.messages) {
        opts.messages[body.sessionId] = [
          ...(opts.messages[body.sessionId] ?? []),
          msg,
        ];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: msg, sessionStatus: "active_human" }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route("**/api/admin/team-presence", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ agents: [] }),
    })
  );
}

test.describe("Phase 4 agent productivity", () => {
  test("agent claims a chat, picks a canned reply, edits and sends", async ({
    page,
  }) => {
    // First test in the suite — Neon DB may be cold, allow extra time.
    test.setTimeout(90000);
    const sessions = [makeSessionStub(SESSION_A, "embed_alpha")];
    const messagesBySession: Record<string, Array<Record<string, unknown>>> = {
      [SESSION_A]: [],
    };
    await loginAsAgent(page);
    await stubChatsRoutes(page, {
      sessions,
      messages: messagesBySession,
    });

    await page.goto("/dashboard/chats");

    // Claim from queue.
    const card = page.locator('[data-testid="session-card"]').first();
    await expect(card).toBeVisible();
    await card.locator("text=Claim Chat").click();

    // Now reply textarea should be visible.
    const textarea = page.locator('[data-testid="chat-reply-textarea"]');
    await expect(textarea).toBeVisible();

    // Type "/" to open canned popover.
    await textarea.click();
    await textarea.type("/");
    const popover = page.locator('[data-testid="canned-popover"]');
    await expect(popover).toBeVisible();

    // Pick the first reply.
    await page.locator('[data-testid="canned-option"]').first().click();
    await expect(popover).not.toBeVisible();
    await expect(textarea).toHaveValue(/Hi there|Thanks/);

    // Edit and send.
    await textarea.fill("Hi there — quick custom edit!");
    await page.locator('[data-testid="chat-send-btn"]').click();

    // The message thread renders the new message (poll-based — wait up to 4s).
    await expect(
      page.locator("text=Hi there — quick custom edit!").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("multi-tab drafts persist across tab switches", async ({ page }) => {
    test.setTimeout(90000);
    // Both sessions start unclaimed so the "Claim Chat" button is visible.
    // Claiming via the UI sets justClaimed=true in ChatPanel which bypasses
    // the claimedBy.id === myId check and makes the textarea appear.
    const sessions = [
      makeSessionStub(SESSION_A, "embed_alpha"),
      makeSessionStub(SESSION_B, "embed_beta"),
    ];
    const messagesBySession: Record<string, Array<Record<string, unknown>>> = {
      [SESSION_A]: [],
      [SESSION_B]: [],
    };
    await loginAsAgent(page);
    await stubChatsRoutes(page, {
      sessions,
      messages: messagesBySession,
    });

    await page.goto("/dashboard/chats");

    // Claim A — this sets justClaimed=true so the textarea is visible.
    const cardA = page.locator('[data-testid="session-card"]').first();
    await expect(cardA).toBeVisible();
    await cardA.locator("text=Claim Chat").click();

    const textarea = page.locator('[data-testid="chat-reply-textarea"]');
    await expect(textarea).toBeVisible();
    await textarea.fill("Draft for chat A");

    // After claiming A, the queue reorders: unclaimed sessions (B) appear
    // in the "In Queue" section first, claimed (A) moves to "Active" below.
    // So B is now the first session card. Wait for that refetch to settle.
    const cardB = page.locator('[data-testid="session-card"]').first();
    await expect(cardB.locator("text=Claim Chat")).toBeVisible({ timeout: 5000 });
    await cardB.locator("text=Claim Chat").click();
    // Tab strip should now have 2 tabs.
    const tabs = page.locator('[data-testid="chat-tab"]');
    await expect(tabs).toHaveCount(2);

    // We're now on session B (just claimed). Type a draft.
    await expect(textarea).toBeVisible();
    await textarea.fill("Draft for chat B");

    // Switch back to A via tab strip.
    await tabs.nth(0).click();
    await expect(textarea).toHaveValue("Draft for chat A");

    // Switch to B again.
    await tabs.nth(1).click();
    await expect(textarea).toHaveValue("Draft for chat B");
  });

  test("internal note posts via API, never reaches messages list", async ({
    page,
  }) => {
    const sessions = [
      makeSessionStub(SESSION_A, "embed_alpha", {
        status: "active_human",
        claimedByKind: "human",
        claimedByUserId: "agent-1",
        claimedBy: { id: "agent-1", name: "Test Agent" },
      }),
    ];
    const messagesBySession: Record<string, Array<Record<string, unknown>>> = {
      [SESSION_A]: [],
    };
    await loginAsAgent(page);
    await stubChatsRoutes(page, {
      sessions,
      messages: messagesBySession,
    });

    await page.goto("/dashboard/chats");
    await page.locator('[data-testid="session-card"]').first().click();

    await page.locator('[data-testid="chat-tab-notes"]').click();
    const noteInput = page.locator('[data-testid="note-input"]');
    await expect(noteInput).toBeVisible();
    await noteInput.fill("INTERNAL: customer is a VIP");
    await page.locator('[data-testid="note-form"] button[type="submit"]').click();

    // Note is rendered.
    await expect(
      page.locator('[data-testid="note-row"]').first()
    ).toContainText("INTERNAL: customer is a VIP");

    // The customer-facing message thread must NOT contain the note text.
    // We've stubbed the messages endpoint with [] so there should be no
    // matching text in the MessageThread region. Verify the note body
    // never appears outside the notes panel.
    await page.locator('[data-testid="chat-tab-trace"]').click();
    await expect(page.locator("text=INTERNAL: customer is a VIP")).toHaveCount(0);
  });

  test("AI Suggest button fills the textarea with the suggestion", async ({
    page,
  }) => {
    // Start unclaimed so the agent can claim via UI (sets justClaimed=true
    // in ChatPanel, which makes the textarea and AI-suggest button visible).
    const sessions = [makeSessionStub(SESSION_A, "embed_alpha")];
    const messagesBySession: Record<string, Array<Record<string, unknown>>> = {
      [SESSION_A]: [],
    };
    await loginAsAgent(page);
    await stubChatsRoutes(page, {
      sessions,
      messages: messagesBySession,
      aiSuggestion: "Try the Bell MX-9 Adventure — great fit for ADV riders.",
    });

    await page.goto("/dashboard/chats");

    // Claim via UI so justClaimed=true → textarea visible.
    const card = page.locator('[data-testid="session-card"]').first();
    await expect(card).toBeVisible();
    await card.locator("text=Claim Chat").click();

    const textarea = page.locator('[data-testid="chat-reply-textarea"]');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue("");

    await page.locator('[data-testid="ai-suggest-btn"]').click();
    await expect(textarea).toHaveValue(
      "Try the Bell MX-9 Adventure — great fit for ADV riders."
    );
  });

  test("LocationBadge renders city/region from the session payload", async ({
    page,
  }) => {
    const sessions = [
      makeSessionStub(SESSION_A, "embed_alpha", {
        status: "active_human",
        claimedByKind: "human",
        claimedByUserId: "agent-1",
        claimedBy: { id: "agent-1", name: "Test Agent" },
        customerCity: "Denver",
        customerRegion: "CO",
        customerCountry: "US",
      }),
    ];
    const messagesBySession: Record<string, Array<Record<string, unknown>>> = {
      [SESSION_A]: [],
    };
    await loginAsAgent(page);
    await stubChatsRoutes(page, {
      sessions,
      messages: messagesBySession,
    });

    await page.goto("/dashboard/chats");
    await page.locator('[data-testid="session-card"]').first().click();

    // Both the queue card and the chat header should show "Denver, CO".
    const badges = page.locator('[data-testid="location-badge"]');
    await expect(badges.first()).toBeVisible();
    await expect(page.locator("text=Denver, CO").first()).toBeVisible();
  });
});

test.describe("Phase 4 manager canned-replies UI", () => {
  test("manager creates a canned reply via the new tab", async ({ page }) => {
    await loginAsManager(page);

    // Stub the admin endpoints so the test is hermetic.
    const replies: Array<{
      id: string;
      title: string;
      body: string;
      category: string;
      createdAt: string;
      updatedAt: string;
    }> = [];

    await page.route("**/api/admin/canned*", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ replies }),
        });
      } else if (method === "POST") {
        const body = route.request().postDataJSON() as {
          title: string;
          body: string;
          category: string;
        };
        const reply = {
          id: `r-${replies.length + 1}`,
          title: body.title,
          body: body.body,
          category: body.category,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        replies.push(reply);
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ reply }),
        });
      } else {
        await route.fulfill({ status: 200, body: "{}" });
      }
    });

    // Knowledge GET (existing tabs)
    await page.route("**/api/admin/knowledge", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ entries: [] }),
      })
    );

    await page.goto("/dashboard/manager/knowledge");

    await page.locator("text=Canned Replies").first().click();
    await page.locator('[data-testid="canned-new"]').click();

    await page.fill('[data-testid="canned-form-title"]', "Greeting");
    await page.fill('[data-testid="canned-form-category"]', "openers");
    await page.fill(
      '[data-testid="canned-form-body"]',
      "Hi {customer_name}!"
    );
    await page.locator('[data-testid="canned-form-save"]').click();

    await expect(
      page.locator('[data-testid="canned-row"]').first()
    ).toContainText("Greeting");
  });
});
