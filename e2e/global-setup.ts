/**
 * Playwright globalSetup: runs once before any test in the suite.
 *
 * Phase 1 added a `mustResetPassword=true` flag on the seeded manager and
 * agent users — the production-correct behavior is to force a password
 * change on first login. The seed script faithfully sets that flag on every
 * `npm run db:seed`, which means the e2e smoke suite (which logs the same
 * test users in many times with their default passwords) would always be
 * redirected to /password-reset and never reach /dashboard.
 *
 * This setup flips the flag back to `false` for the two known test
 * accounts ONCE per suite run. It does not change passwords, does not
 * touch any other user, and runs entirely against the same DATABASE_URL
 * the dev server reads from .env.local — so production seeds remain
 * security-correct (default credentials still expire on first login),
 * but the e2e suite gets a clean slate every time it starts.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { inArray } from "drizzle-orm";
import { createDb } from "../lib/db/connect";
import { users } from "../lib/db/schema";

const MANAGER_EMAIL =
  process.env.E2E_MANAGER_EMAIL || "manager@performancecycle.com";
const AGENT_EMAIL =
  process.env.E2E_AGENT_EMAIL || "agent@performancecycle.com";

const e2ePort = process.env.E2E_PORT || "3050";
const serverBase = process.env.E2E_BASE_URL || `http://localhost:${e2ePort}`;

// Vercel Deployment Protection bypass for the warm-up fetches below. When
// running against a protected preview (E2E_BASE_URL on *.vercel.app), these
// server-side requests must carry the bypass header or they hit Vercel's auth
// wall instead of the app (csrf JSON parse fails, warm-ups no-op). Empty when
// the secret is unset so local runs are unaffected.
const bypassHeaders: Record<string, string> = process.env
  .VERCEL_AUTOMATION_BYPASS_SECRET
  ? {
      "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    }
  : {};

/**
 * Safety guard: the e2e suite writes into whatever DATABASE_URL points at
 * (it flips mustResetPassword, warms the login path, and individual specs
 * seed sessions/messages). It previously ran against the production database
 * and contaminated real data. Refuse to run unless we're clearly pointed at a
 * local database or the operator has explicitly opted in.
 */
function assertSafeDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
  const allowRemote = process.env.E2E_ALLOW_REMOTE_DB === "1";
  if (!isLocal && !allowRemote) {
    throw new Error(
      "[e2e/global-setup] Refusing to run: DATABASE_URL does not point at " +
        "localhost. The e2e suite writes to this database. Set " +
        "E2E_ALLOW_REMOTE_DB=1 to override (NOT against production).",
    );
  }
}

export default async function globalSetup() {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[e2e/global-setup] DATABASE_URL not set — skipping mustResetPassword clear",
    );
    return;
  }

  assertSafeDatabase();

  const { db, client } = createDb();

  const result = await db
    .update(users)
    .set({ mustResetPassword: false })
    .where(inArray(users.email, [MANAGER_EMAIL, AGENT_EMAIL]))
    .returning({ id: users.id, email: users.email });

  await client.end();

  console.log(
    `[e2e/global-setup] cleared mustResetPassword on ${result.length} test user(s): ${result.map((r) => r.email).join(", ")}`,
  );

  // Warm up the webServer's database connection pool. The Next.js process
  // opens its pooled Postgres connection lazily; the first credentials check
  // pays that setup cost. By firing one full login here (before any test
  // runs), we ensure the connection is established for the actual tests.
  try {
    const csrfRes = await fetch(`${serverBase}/api/auth/csrf`, {
      headers: { ...bypassHeaders },
    });
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const body = new URLSearchParams({
      email: AGENT_EMAIL,
      // Seed passwords are now env-driven (FIX-7). Prefer the explicit e2e var,
      // then the seed var the suite ran db:seed with, then the legacy default.
      password:
        process.env.E2E_AGENT_PASS ??
        process.env.SEED_AGENT_PASSWORD ??
        "agent123",
      csrfToken,
      json: "true",
    });
    await fetch(`${serverBase}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...bypassHeaders,
      },
      body: body.toString(),
      // Don't follow the redirect — we only care that the request was processed.
      redirect: "manual",
    });
    console.log("[e2e/global-setup] warmed up NextAuth credentials handler");
  } catch (err) {
    // Non-fatal: test will be slower on cold start but not broken.
    console.warn("[e2e/global-setup] warm-up request skipped:", String(err));
  }

  // Warm the AI reply path with one throwaway turn: the first Claude turn
  // after boot pays for the BigCommerce category-map build, catalog HTTP
  // connections, and the Anthropic client — observed at 30-37 s cold, which
  // blows the 25 s per-question reply wait in bot-quality/catalog specs when
  // that first turn lands inside a real test. Costs one Haiku call per run.
  try {
    const sRes = await fetch(`${serverBase}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...bypassHeaders },
      body: JSON.stringify({ customerIdentifier: `e2e-warmup-${Date.now()}` }),
    });
    const sData = (await sRes.json()) as {
      session?: { id?: string };
      sessionToken?: string;
    };
    if (sData.session?.id) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 90_000);
      await fetch(`${serverBase}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...bypassHeaders,
          ...(sData.sessionToken
            ? { "x-session-token": sData.sessionToken }
            : {}),
        },
        body: JSON.stringify({
          sessionId: sData.session.id,
          message: "warmup: do you carry helmets?",
        }),
        signal: controller.signal,
      });
      clearTimeout(t);
      console.log("[e2e/global-setup] warmed AI reply path");
    }
  } catch (err) {
    // Non-fatal: the first test just eats the cold-start latency.
    console.warn("[e2e/global-setup] AI warm-up skipped:", String(err));
  }
}
