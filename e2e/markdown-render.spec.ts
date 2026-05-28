/**
 * Markdown render regression test.
 *
 * Seeds a pre-crafted AI message containing every previously-broken pattern
 * (## headings, | pipe tables, --- horizontal rules) into the chat session,
 * then navigates to the embed widget and asserts that none of those raw
 * markdown symbols appear as visible text in the rendered AI bubble.
 *
 * No real AI/Claude call is made — the reply is injected directly via the
 * test-only seed endpoint, so the test is deterministic and fast (~2s).
 *
 * Requires E2E_EMAIL_MOCK=1 (set automatically by playwright.config.ts
 * webServer env when running locally).
 */

import { test, expect } from "@playwright/test";

// Contains one of each previously-broken pattern:
//   ## heading → should render as an <h3>, not literal "## Comparison"
//   | table |  → should render as <table>, not literal pipe characters
//   ---        → should render as <hr>, not literal dashes
//   **bold** and [link](url) must still work as before
const MARKDOWN_BODY = `
## Comparison

| Helmet | Price |
|--------|-------|
| Shoei RF-1400 | $549 |
| Bell Race Star Flex | $849 |

---

**Bottom line:** Check the [Returns page](https://performancecycle.com/returns-exchanges/) before ordering.
`.trim();

test.describe("Markdown rendering — no raw syntax in rendered DOM", () => {
  test("AI bubble renders headings, tables, and hr without raw markdown symbols", async ({
    page,
    request,
  }) => {
    const sessionId = `markdown-render-${Date.now()}`;

    // First create a session so the embed page recognises it.
    await request.post("/api/sessions", {
      data: { customerIdentifier: sessionId, pageContext: null },
    });

    // Seed the crafted AI message directly — no Claude call needed.
    const seedRes = await request.post("/api/e2e/seed-messages", {
      data: {
        sessionId,
        role: "ai",
        messages: [{ content: MARKDOWN_BODY }],
      },
    });
    expect(seedRes.ok(), "seed-messages endpoint must succeed").toBe(true);

    await page.goto(`/embed?sessionId=${sessionId}`);

    const bubble = page.locator('[data-testid="message-ai"]').first();
    await bubble.waitFor({ state: "visible", timeout: 10_000 });

    const text = await bubble.innerText();

    // --- Negative assertions: raw markdown must not leak into visible text ---
    expect(text, "h2 heading should not render as ## literal").not.toMatch(
      /^##/m
    );
    expect(
      text,
      "table pipes should not render as literal | characters"
    ).not.toContain("|");
    expect(
      text,
      "horizontal rule should not render as literal --- dashes"
    ).not.toMatch(/^---$/m);

    // --- Positive assertions: content must still be visible as plain text ---
    expect(text, "heading text should be visible").toContain("Comparison");
    expect(text, "first table cell should be visible").toContain("Shoei RF-1400");
    expect(text, "price cell should be visible").toContain("$549");
    expect(text, "bold text should be visible").toContain("Bottom line:");

    // Verify the link is rendered as an anchor, not raw markdown syntax
    const link = bubble.locator('a[href="https://performancecycle.com/returns-exchanges/"]');
    await expect(link, "Returns page link should be an <a> element").toBeVisible();
  });
});
