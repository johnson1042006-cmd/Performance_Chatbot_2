import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

// All three tests stub the relevant API responses so the suite is independent
// of BigCommerce sandbox state, agent presence, and Resend availability. The
// goal is to exercise the chip → form → bubble flows in the widget UI.

test.describe("Customer service chips — Track an order", () => {
  test("submitting a known order shows the AI summary bubble", async ({
    page,
  }) => {
    // 1. Stub session creation so we get a deterministic dbSessionId.
    const fakeSessionId = "11111111-1111-1111-1111-111111111111";
    const fakeMessageId = "22222222-2222-2222-2222-222222222222";

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

    // 2. Stub the messages endpoint — initially empty, then returns the AI
    //    summary message after the lookup is "submitted".
    let messagesResponse = { messages: [] as Array<Record<string, unknown>> };
    await page.route(
      `**/api/sessions/${fakeSessionId}/messages`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(messagesResponse),
        });
      }
    );
    await page.route(`**/api/sessions/${fakeSessionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: { id: fakeSessionId, claimedByKind: null },
        }),
      });
    });
    // No-op heartbeat / config so the widget doesn't error on missing routes.
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

    // 3. Stub /api/orders/lookup and pre-populate the messages response so
    //    the widget's poll fetches the AI bubble.
    await page.route("**/api/orders/lookup", async (route) => {
      const body = route.request().postDataJSON() as {
        email: string;
        orderId: number;
        sessionId: string;
      };
      expect(body.email).toBe("test@example.com");
      expect(body.orderId).toBe(12345);

      messagesResponse = {
        messages: [
          {
            id: fakeMessageId,
            role: "ai",
            content:
              "**Order #12345** — *Shipped* (Jan 12, 2026)\nTotal: **$234.50**\nItems shipped: 3 / 3",
            sentAt: new Date().toISOString(),
          },
        ],
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          found: true,
          order: { id: 12345, status: "Shipped" },
          message: { id: fakeMessageId, sentAt: new Date().toISOString() },
        }),
      });
    });

    await page.goto("/embed");
    await expect(page.getByTestId("chip-track_order")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("chip-track_order").click();

    await expect(page.getByTestId("order-lookup-form")).toBeVisible();
    await page.getByTestId("order-lookup-email").fill("test@example.com");
    await page.getByTestId("order-lookup-id").fill("12345");
    await page.getByTestId("order-lookup-submit").click();

    // The summary bubble shows up via the 8-second poll. Bump the timeout to
    // give it a buffer.
    await expect(page.locator('[data-testid="message-ai"]')).toContainText(
      "Order #12345",
      { timeout: 15000 }
    );
  });
});

test.describe("Customer service chips — Find tires", () => {
  test("tire fitment form submits and shows catalog link + connect chip", async ({
    page,
  }) => {
    const fakeSessionId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

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
    await page.route(
      `**/api/sessions/${fakeSessionId}/tire-escalate`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
    );

    await page.goto("/embed");
    await expect(page.getByTestId("chip-find_tires")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("chip-find_tires").click();

    await expect(page.getByTestId("tire-fitment-form")).toBeVisible();
    await page.getByTestId("tire-year").fill("2020");
    await page.getByTestId("tire-make").fill("Yamaha");
    await page.getByTestId("tire-model").fill("MT-07");
    await page.getByTestId("tire-riding-type").selectOption("Adventure");
    await page.getByTestId("tire-fitment-submit").click();

    await expect(page.locator('[data-testid="message-ai"]')).toContainText(
      "https://performancecycle.com/tires/adventure/",
      { timeout: 10000 }
    );
    await expect(page.getByTestId("tire-fitment-actions")).toBeVisible();
    await expect(page.getByTestId("action-chip-connect_team")).toBeVisible();

    await page.getByTestId("action-chip-connect_team").click();
    await expect(page.getByTestId("connecting-human-banner")).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Customer service chips — Talk to a human", () => {
  test("submitting an email when no agents are online shows confirmation", async ({
    page,
  }) => {
    const fakeSessionId = "33333333-3333-3333-3333-333333333333";
    const confirmationMsgId = "44444444-4444-4444-4444-444444444444";

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

    let messagesResponse = { messages: [] as Array<Record<string, unknown>> };
    await page.route(
      `**/api/sessions/${fakeSessionId}/messages`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(messagesResponse),
        });
      }
    );
    await page.route(`**/api/sessions/${fakeSessionId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: { id: fakeSessionId, claimedByKind: null },
        }),
      });
    });
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

    // Talk-to-human says "no agents online" → triggers email-capture form.
    await page.route(
      `**/api/sessions/${fakeSessionId}/request-human`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ status: "needs_email" }),
        })
    );

    // Contact saves successfully.
    await page.route(
      `**/api/sessions/${fakeSessionId}/contact`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
    );

    // Notify-support drops the AI confirmation. We pre-populate the
    // messages list so the next poll picks it up.
    await page.route(
      `**/api/sessions/${fakeSessionId}/notify-support`,
      (route) => {
        messagesResponse = {
          messages: [
            {
              id: confirmationMsgId,
              role: "ai",
              content:
                "Thanks — we'll email you at **test@example.com** as soon as a teammate is back.",
              sentAt: new Date().toISOString(),
            },
          ],
        };
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    );

    await page.goto("/embed");
    await expect(page.getByTestId("chip-talk_to_human")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("chip-talk_to_human").click();

    await expect(page.getByTestId("email-capture-form")).toBeVisible();
    await page.getByTestId("email-capture-email").fill("test@example.com");
    await page.getByTestId("email-capture-submit").click();

    await expect(page.locator('[data-testid="message-ai"]')).toContainText(
      "as soon as a teammate is back",
      { timeout: 15000 }
    );
  });
});

test.describe("End-of-session feedback", () => {
  test("clicking thumbs-up shows the thanks state", async ({ page }) => {
    const fakeSessionId = "55555555-5555-5555-5555-555555555555";

    await page.route("**/api/sessions", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          // status: "closed" forces the widget straight into the
          // EndOfSessionCard render path without any send-and-close step.
          body: JSON.stringify({
            session: { id: fakeSessionId, status: "closed" },
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
          session: { id: fakeSessionId, claimedByKind: null, status: "closed" },
        }),
      })
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

    await page.route(
      `**/api/sessions/${fakeSessionId}/feedback`,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
    );

    await page.goto("/embed");
    await expect(page.getByTestId("end-of-session-card")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("feedback-up").click();
    await expect(page.getByTestId("feedback-thanks")).toBeVisible({
      timeout: 5000,
    });
  });
});

// ---------------------------------------------------------------------------
// System message bubbles — Pusher handoff events
//
// Uses page.routeWebSocket to intercept the Pusher WebSocket and inject
// session-claimed / session-released events in Pusher wire format, then
// asserts the [data-testid="message-system"] bubble appears in the widget.
// ---------------------------------------------------------------------------

/**
 * Shared helper: stubs the minimal API routes the widget needs to boot and
 * wires up a Pusher WebSocket mock. Returns a function that, when called,
 * delivers a raw Pusher event on the session channel.
 */
async function setupWidgetWithPusherMock(
  page: Page,
  sessionId: string
): Promise<(event: string, data: Record<string, unknown>) => void> {
  let wsRoute: WebSocketRoute | null = null;
  const channelName = `private-session-${sessionId}`;

  // Intercept the Pusher WebSocket before page.goto so it is already in place
  // when the widget subscribes. The handler is called on connection open — no
  // separate onOpen exists in WebSocketRoute; we send the handshake immediately.
  await page.routeWebSocket(/pusher\.com/, (ws) => {
    ws.send(
      JSON.stringify({
        event: "pusher:connection_established",
        data: JSON.stringify({ socket_id: "test.1", activity_timeout: 120 }),
      })
    );
    ws.onMessage((msg) => {
      const parsed = JSON.parse(msg.toString()) as {
        event: string;
        data: { channel?: string };
      };
      if (
        parsed.event === "pusher:subscribe" &&
        parsed.data.channel === channelName
      ) {
        ws.send(
          JSON.stringify({
            event: "pusher_internal:subscription_succeeded",
            channel: channelName,
            data: "{}",
          })
        );
        wsRoute = ws;
      }
    });
  });

  // Private-channel auth — return a fake signature so pusher-js proceeds to
  // send pusher:subscribe over the (mocked) WebSocket.
  await page.route("**/api/pusher/auth", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ auth: "test-key:test-signature" }),
    })
  );

  // Session creation (POST /api/sessions is called on widget mount).
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ session: { id: sessionId, status: "waiting" } }),
      });
    } else {
      await route.continue();
    }
  });

  // Message history — empty so the thread starts clean.
  await page.route(`**/api/sessions/${sessionId}/messages`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    })
  );

  // Heartbeat — no-op.
  await page.route(`**/api/sessions/${sessionId}/heartbeat`, (route) =>
    route.fulfill({ status: 200, body: "{}" })
  );

  // Persona config.
  await page.route("**/api/embed/config", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        persona: {
          name: "Agent",
          title: "Product Specialist",
          avatarUrl: "/agent-avatar.svg",
        },
      }),
    })
  );

  // Return a trigger function the test can call to inject a Pusher event.
  return (event: string, data: Record<string, unknown>) => {
    if (!wsRoute) throw new Error("Pusher WebSocket not yet subscribed");
    wsRoute.send(
      JSON.stringify({
        event,
        channel: channelName,
        data: JSON.stringify(data),
      })
    );
  };
}

test.describe("System message bubbles — Pusher handoff events", () => {
  test("session-claimed kind=human inserts named-agent bubble in customer widget", async ({
    page,
  }) => {
    test.setTimeout(30000);
    const sessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const triggerPusher = await setupWidgetWithPusherMock(page, sessionId);

    await page.goto(`/embed?sessionId=${sessionId}`);

    // Wait for Pusher channel subscription to complete.
    await page.waitForTimeout(2000);

    // Fire session-claimed with agentName.
    triggerPusher("session-claimed", { kind: "human", agentName: "Sarah" });

    await expect(page.getByTestId("message-system")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId("message-system")).toContainText(
      "Sarah has joined the chat."
    );
  });

  test("session-released inserts AI-back bubble in customer widget", async ({
    page,
  }) => {
    test.setTimeout(30000);
    const sessionId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const triggerPusher = await setupWidgetWithPusherMock(page, sessionId);

    await page.goto(`/embed?sessionId=${sessionId}`);

    await page.waitForTimeout(2000);

    triggerPusher("session-released", {});

    await expect(page.getByTestId("message-system")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByTestId("message-system")).toContainText(
      "The agent stepped away. AI assistant is back."
    );
  });
});
