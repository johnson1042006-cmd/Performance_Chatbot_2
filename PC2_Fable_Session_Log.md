# PC2 Fable Session Log

Running status log for the autonomous Preview-based fix session (started 7/9/2026).
Append-only — one entry per pause (merge go-ahead, blocking question, item finished
or abandoned). Trace-back tool: each fix should be independently identifiable by what
it touched and why.

---

## [2026-07-09 18:25 MDT] — Item 0: Plan-doc decision sync
**Status:** done (committed on its own, per mandate)
**Files changed:** PC2_Jacob_Fixes_Plan.md, PC2_Phase2a_Escalation_Plan.md, PC2_Fable_Session_Log.md (created)
**What changed and why:** Recorded the three resolved decisions in the in-repo plan docs before building against them: (1) Phase 2c defaults to Road 6 when the customer doesn't specify a generation — confirmed a ranking/default-selection bug, both products live on the storefront; (2) Phase 2b classification fallback — Sonnet low-confidence or error falls back to the current Haiku-only routing path, no escalation for that failure mode; (3) merge/production policy — implement and gate fully autonomously against Preview and its isolated Neon branch, production pushes and any production-Neon interaction require Antonio's explicit go-ahead per item. Also corrected the Phase 2a plan's Step 5 smoke-test target: it still said to test locally against .env.local "(NOT the broken Preview env)" — Preview is fixed and .env.local points at production Neon, so the doc now names Preview as the required test target.
**Test gate results:** n/a (docs only — no code changed)
**Waiting on:** nothing, just noting progress. Proceeding to Item 1 (Phase 2a test gate against Preview).

---

## [2026-07-09 19:54 MDT] — Item 1: Phase 2a test gate (paused overnight, mid-gate)
**Status:** in progress — paused by Antonio for the night; no gate failure
**Files changed:** none (no code changes this item; Phase 2a implementation was already on the branch)
**What changed and why:** Gate step 1 (unit tests) passed: 595/595. Steps 2–4 are blocked on one machine-local prerequisite: Playwright's chromium build 1217 (for the pinned Playwright 1.59.1) is not installed on this Windows machine and in-session install attempts stalled repeatedly; Antonio's manual install outside the session worked but grabbed build 1228 (ran without project deps resolved). `npm install` has since been run, so a `npx playwright install chromium chromium-headless-shell` from the project root is the one remaining setup step before the e2e runs.
**Test gate results:** unit 595/595 PASS · e2e:slow NOT RUN (browser missing; two earlier aborted runs failed on machine-local issues, not code: (1) `.env.local` has `NEXTAUTH_URL=""`/`VERCEL_URL=""` which breaks `next build` at prerender — worked around per-run with `NEXTAUTH_URL=http://localhost:3050`, worth fixing in `.env.local`; (2) e2e global-setup's non-localhost DB guard — expected, acknowledged with `E2E_ALLOW_REMOTE_DB=1`) · Playwright NOT RUN · browser pass NOT RUN
**Ready for pickup:** Preview Neon connection string obtained via Neon MCP (branch `br-rough-leaf-akxuxfmx`, endpoint `ep-dark-rice-*`; NOT stored anywhere — re-fetch via `mcp__neon__get_connection_string`); migration 0007 verified already present on the Preview branch; Preview deployment READY at commit ab7e839 (`performance-chatbot-2-git-fix-b02930-antonio-johnsons-projects.vercel.app`, behind Vercel SSO — mint a fresh share link via the Vercel MCP; tonight's expires 7/10 ~11:38 PM); live-pass driver script ready at the session scratchpad (`live-preview-pass.ts`). Run commands for pickup: `DATABASE_URL=<preview> NEXTAUTH_URL=http://localhost:3050 E2E_ALLOW_REMOTE_DB=1 npm run test:e2e:slow`, then same env with `npx playwright test --grep-invert @slow`.
**Waiting on:** nothing from Antonio — resuming next session with the chromium install, then gate steps 2–4.

---

## [2026-07-10 19:45 MDT] — Item 1: e2e:slow rerun FAILED (rate limiter, not bot quality) — holding for Antonio
**Status:** blocked — gate step 2 red for an infra reason; per instruction, no further fixes attempted, holding for review
**Files changed:** none in the repo (machine-local Playwright browser install only; diagnostic scripts live in the session scratchpad)
**What changed and why:**
- *Browser install root cause + fix:* `chromium_headless_shell-1217` was never installed — Playwright 1.59.1 runs headless tests through a separate headless-shell binary, and only a 5 MB stub of regular `chromium-1217` existed (the manual out-of-project install fetched build 1228, which 1.59.1 ignores). `npx playwright test --list` looked green because it never launches a browser. Playwright's own installer downloads fine but its Node zip extractor wedges on this machine (reproduced twice: download 100%, extraction frozen at 5 MB). Fix: killed the wedged installer, extracted its fully-downloaded build-1217 zip with Windows bsdtar (1.2 s), downloaded the matching `chrome-headless-shell-win64.zip` (CfT 147.0.7727.15) from Playwright's CDN, extracted it the same way, and added the `INSTALLATION_COMPLETE`/`DEPENDENCIES_VALIDATED` markers. Verified with a real headless launch via the project's pinned Playwright: `HEADLESS LAUNCH OK, chromium 147.0.7727.15`.
- *Rerun env (per-run only, never written to a file):* `DATABASE_URL` = Preview Neon branch `br-rough-leaf-akxuxfmx` (host `ep-dark-rice-akzcs241-pooler…`, re-fetched via Neon MCP and verified before launch), `E2E_ALLOW_REMOTE_DB=1`, `NEXTAUTH_URL=http://localhost:3050`.
**Test gate results:** e2e:slow **FAIL** — 48/50, 47/50, 47/50 across the initial run + 2 retries (threshold ≤5). **Not a bot-quality regression:** ~46 of the failures are the widget's session-bootstrap error ("We couldn't start your chat session. Refresh and try again.") — POST `/api/sessions` was 429'd by the IP rate limiter (5 sessions/min/IP, `app/api/sessions/route.ts:155`). The localhost bypass in `lib/rateLimit.ts:50` is gated on `NODE_ENV !== "production"`, which never fires under `next start` (how `test:e2e:slow` runs). Confirmed on the Preview DB: `rate_limit_buckets` key `sessions:::1` hit counts 174/82/44 in the 01:28–01:30 UTC windows — exactly the run's timeframe. The 50-question suite finished in ~2 min instead of 25–30 because everything after the first 5 sessions/min failed instantly. Browser/launch layer worked correctly (chromium fix held). Open question flagged for Antonio: how this suite passed at baseline given the bypass can't fire under `next start` — candidate explanations: baseline local DB lacked `rate_limit_buckets` (limiter is fail-open on DB error for this route) or the bypass/env behaved differently on the Mac.
**Waiting on:** Antonio — decide how the suite should clear the limiter against a real DB (e.g., extend the localhost bypass with an explicit e2e env flag set in `playwright.config.ts` webServer env, mirroring `E2E_ALLOW_REMOTE_DB`), then rerun gate step 2.
