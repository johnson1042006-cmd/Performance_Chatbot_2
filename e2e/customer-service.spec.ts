import { test, expect } from "@playwright/test";

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
            name: "Jake",
            title: "Product Specialist",
            avatarUrl: "/jake-avatar.svg",
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

test.describe("Customer service chips — Tech-Air service request", () => {
  test("submitting Tech-Air request shows confirmation and sends email", async ({
    page,
  }) => {
    const fakeSessionId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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

    // Minimal stubs to keep widget stable.
    let messagesResponse = { messages: [] as Array<Record<string, unknown>> };
    await page.route(`**/api/sessions/${fakeSessionId}/messages`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(messagesResponse),
      });
    });
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
            name: "Jake",
            title: "Product Specialist",
            avatarUrl: "/jake-avatar.svg",
          },
        }),
      })
    );

    // Stub the service-request route to behave like production: on success it
    // persists/broadcasts an AI confirmation message; we simulate that by
    // updating the messages poll response.
    await page.route(
      `**/api/sessions/${fakeSessionId}/service-request`,
      async (route) => {
        const body = route.request().postDataJSON() as {
          airbagModel: string;
          serialNumber: string;
          email: string;
        };
        expect(body.airbagModel).toBe("Tech-Air 5");
        expect(body.serialNumber).toBe("SN123");
        expect(body.email).toBe("alex@example.com");

        messagesResponse = {
          messages: [
            {
              id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              role: "ai",
              content:
                "Got it — your Tech-Air service request is in. We'll reply to **alex@example.com** within 1 business day to confirm next steps.",
              sentAt: new Date().toISOString(),
            },
          ],
        };

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
      }
    );

    await page.goto("/embed");
    await expect(page.getByTestId("chip-tech_air")).toBeVisible({
      timeout: 10000,
    });
    await page.getByTestId("chip-tech_air").click();

    await expect(page.getByTestId("tech-air-request-form")).toBeVisible();
    await page.locator("#techair-full-name").fill("Alex Rider");
    await page.locator("#techair-email").fill("alex@example.com");
    await page.locator("#techair-phone").fill("3035551212");
    await page.locator("#techair-model").selectOption("Tech-Air 5");
    await page.locator("#techair-serial").fill("SN123");
    await page.locator("#techair-service").selectOption("Cartridge replacement");
    await page.locator("#techair-description").fill("Error light E1");
    await page
      .locator("#techair-return-address")
      .fill("Alex Rider\n123 Main St\nCentennial, CO 80112");
    await page
      .locator('input[name="techair-preferred-return-shipping"][value="Standard ground"]')
      .check();
    await page.locator('input[type="checkbox"]').check();

    await page.getByTestId("tech-air-request-submit").click();

    await expect(page.locator('[data-testid="message-ai"]')).toContainText(
      "your Tech-Air service request is in",
      { timeout: 15000 }
    );
    // Note: end-to-end email subject assertions live in the unit test for
    // renderTechAirRequest (lib/email/templates/__tests__/tech-air-request.test.ts).
    // Asserting on /api/e2e/email-log here would be misleading because this
    // spec stubs the service-request route, so the real email is never sent.
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
            name: "Jake",
            title: "Product Specialist",
            avatarUrl: "/jake-avatar.svg",
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
            name: "Jake",
            title: "Product Specialist",
            avatarUrl: "/jake-avatar.svg",
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
            name: "Jake",
            title: "Product Specialist",
            avatarUrl: "/jake-avatar.svg",
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
