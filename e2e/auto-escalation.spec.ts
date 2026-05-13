import { test, expect } from "@playwright/test";

// Phase 3: verify the customer can be auto-escalated without explicitly
// tapping "Talk to a human". After three frustrated messages, the server
// (stubbed here) emits a `request-contact` Pusher event OR returns SSE that
// includes auto-escalation metadata; the widget should render the
// email-capture form (or human banner if agents online).
//
// We exercise the simpler path: stub the chat route to return SSE with low-
// confidence text, and rely on the WIDGET-side fallback that surfaces
// EmailCaptureForm via the chip flow when the response indicates an
// escalation is needed. To avoid coupling to Pusher in e2e, we directly
// stub the request-human endpoint to indicate `needs_email` after the
// third message.

const fakeSessionId = "66666666-6666-6666-6666-666666666666";

test("auto-escalation: three frustrated messages surface email-capture form", async ({
  page,
}) => {
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

  let messagesResponse: { messages: Array<Record<string, unknown>> } = { messages: [] };
  await page.route(
    `**/api/sessions/${fakeSessionId}/messages`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(messagesResponse),
      })
  );
  await page.route(`**/api/sessions/${fakeSessionId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: { id: fakeSessionId, claimedByKind: "ai" },
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

  let chatCount = 0;
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    chatCount += 1;
    const accept = route.request().headers()["accept"] || "";

    // After the third frustrated message, append an auto-escalation
    // confirmation directly to the messages list and respond with SSE that
    // includes a `request-contact` style end-of-stream event the widget
    // observes via Pusher in production. In the e2e environment Pusher is
    // not connected, so we rely on the widget's own fallback: when the SSE
    // body contains the escalation markers, the widget shows the email
    // form. To exercise that without changing widget code, we instead
    // simulate the Pusher event by surfacing a 503 that the widget treats
    // as an escalation prompt.
    if (chatCount >= 3 && accept.includes("text/event-stream")) {
      // Emit token then done; the widget assembles a low-confidence reply
      // and the route would normally fire the request-contact Pusher event.
      // For the e2e we synthesize the email-capture trigger by also
      // returning a follow-up flag in the SSE message event.
      const body =
        `event: token\ndata: {"text":"I don't have that info right now."}\n\n` +
        `event: message\ndata: {"id":"x","sentAt":"${new Date().toISOString()}","autoEscalated":{"reason":"frustrated_customer","agentsOnline":false}}\n\n` +
        `event: done\ndata: {}\n\n`;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body,
      });
    } else if (accept.includes("text/event-stream")) {
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
        body:
          `event: token\ndata: {"text":"Hi — let me look into that."}\n\n` +
          `event: done\ndata: {}\n\n`,
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: { id: `m${chatCount}`, role: "customer", content: "x", sentAt: new Date().toISOString() },
          sessionStatus: "active_ai",
        }),
      });
    }
  });

  // Also stub request-human so if the customer happens to tap the chip,
  // it returns needs_email (asserts the form path).
  await page.route(
    `**/api/sessions/${fakeSessionId}/request-human`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "needs_email" }),
      })
  );

  await page.goto("/embed");
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 10000 });

  // Three increasingly frustrated messages.
  for (const text of [
    "where is my order",
    "this is ridiculous",
    "I want to speak to a manager NOW",
  ]) {
    await page.getByTestId("chat-input").fill(text);
    await page.getByTestId("chat-send").click();
    await expect(page.locator('[data-testid="message-customer"]').last()).toContainText(
      text,
      { timeout: 10000 }
    );
  }

  // Either the connecting-human banner or the email-capture form must
  // appear after the third frustrated message — without the customer
  // tapping "Talk to a human" themselves.
  await expect(
    page
      .getByTestId("connecting-human-banner")
      .or(page.getByTestId("email-capture-form"))
  ).toBeVisible({ timeout: 15000 });
});
