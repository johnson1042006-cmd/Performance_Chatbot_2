import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Phase 1 security guards
// ---------------------------------------------------------------------------
test.describe("Security guards", () => {
  test("anonymous GET /dashboard redirects to /login", async ({ request }) => {
    const res = await request.get("/dashboard", { maxRedirects: 0 });
    // NextAuth's withAuth middleware returns 307 in some Next versions, 302
    // in others. Either is acceptable as long as we don't render the page.
    expect([302, 307]).toContain(res.status());
    const location = res.headers()["location"] || "";
    expect(location).toMatch(/\/login|\/api\/auth/);
  });

  test("21st rapid POST to /api/chat from same IP within 60s returns 429", async ({
    request,
  }) => {
    // Each chat request triggers a Claude round-trip (~1–3s). Sequential 20×
    // blows past the default 30s test timeout, so the warmup runs in parallel
    // — the limiter's Postgres `count = count + 1` ON CONFLICT serializes
    // correctly under contention and still ratchets up to 20.
    test.setTimeout(60_000);

    // Use a synthetic IP so this test doesn't share a bucket with other tests
    // (or with the literal "unknown" key used by no-header callers). The
    // window resets in <=60s, so leftover counts can't poison reruns.
    const ip = "203.0.113.42";
    const headers = { "x-forwarded-for": ip };

    // Need a real session id to satisfy the 400 guard in /api/chat.
    // Use the same synthetic IP for the session POST so we're not subject to
    // the `:unknown` bucket — five other tests in the suite create sessions
    // without an x-forwarded-for header, and the per-IP sessions limiter
    // (5/60s) would otherwise leak state into this assertion.
    const sessionRes = await request.post("/api/sessions", {
      headers,
      data: {},
    });
    expect([200, 201]).toContain(sessionRes.status());
    const sessionBody = await sessionRes.json();
    const sessionId = sessionBody?.session?.id;
    expect(sessionId).toBeTruthy();

    // Fire 25 in parallel — well over the 20/60s threshold. The Postgres
    // counter increments atomically, so the surplus calls deterministically
    // come back as 429 with a Retry-After header. We assert "at least one
    // 429" rather than "exactly the 21st" to avoid relying on response
    // ordering, which can flip when individual Claude round-trips race.
    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        request.post("/api/chat", {
          headers,
          data: { message: `msg ${i}`, sessionId },
        }),
      ),
    );

    const blocked = responses.filter((r) => r.status() === 429);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0].headers()["retry-after"]).toBeDefined();
  });
});
