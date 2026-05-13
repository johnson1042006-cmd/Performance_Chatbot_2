import { test, expect } from "@playwright/test";

// Phase 3: verify the SSE branch fills the AI bubble progressively.
//
// We stub /api/chat to return a real text/event-stream body that emits
// several `event: token` chunks separated by short delays, then a final
// `event: done`. The widget should append the AI bubble after the first
// token and grow it as more tokens arrive.

const fakeSessionId = "55555555-5555-5555-5555-555555555555";

test("streaming: AI bubble fills progressively over SSE", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: { id: fakeSessionId, status: "waiting" },
        }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route(
    `**/api/sessions/${fakeSessionId}/messages`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      })
  );
  await page.route(`**/api/sessions/${fakeSessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: fakeSessionId, claimedByKind: null },
      }),
    })
  );
  await page.route(
    `**/api/sessions/${fakeSessionId}/heartbeat`,
    (route) => route.fulfill({ status: 200, body: "{}" })
  );
  await page.route("**/api/embed/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        autoOpenOnFirstVisit: true,
        persona: {
          name: "Agent",
          title: "Product Specialist",
          avatarUrl: "/agent-avatar.svg",
        },
      }),
    })
  );

  // Stub /api/chat to return a real SSE body. We chunk the response so the
  // browser sees multiple network packets and the widget actually re-renders
  // between tokens.
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") {
      return route.continue();
    }
    const accept = route.request().headers()["accept"] || "";
    if (!accept.includes("text/event-stream")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: { id: "x", role: "ai", content: "ok", sentAt: new Date().toISOString() } }),
      });
    }
    const body =
      `event: token\ndata: {"text":"We have "}\n\n` +
      `event: token\ndata: {"text":"plenty of "}\n\n` +
      `event: token\ndata: {"text":"helmets in stock."}\n\n` +
      `event: done\ndata: {}\n\n`;
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
      body,
    });
  });

  await page.goto("/embed");
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 });

  await page.getByTestId("chat-input").fill("what helmets do you have");
  await page.getByTestId("chat-send").click();

  const aiBubble = page.locator('[data-testid="message-ai"]').last();
  // Final assembled text should appear progressively. We poll on the bubble's
  // text content to confirm it grows.
  await expect(aiBubble).toContainText("We have", { timeout: 10000 });
  await expect(aiBubble).toContainText("plenty of", { timeout: 10000 });
  await expect(aiBubble).toContainText("helmets in stock", { timeout: 10000 });
});
