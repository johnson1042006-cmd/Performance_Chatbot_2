# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Embeddable customer support chat for Performance Cycle (a motorcycle gear shop). Customers chat through an iframe widget (`public/embed.js` → `/embed`); messages route through an AI fallback (Claude Haiku via `@anthropic-ai/sdk`) and to human agents via a role-based dashboard. Single Next.js 14 App Router app: widget UI, dashboards, and all API routes together. Postgres on Supabase via Drizzle ORM (postgres.js driver, Supavisor transaction pooler); realtime via Pusher; auth via Supabase Auth (email/password) — identity in `auth.users`, `role`/`isActive`/`mustResetPassword` in `public.users` (the app's authz source of truth, read via `getStaffSession()` in `lib/auth.ts`), with `store_manager` and `support_agent` roles; catalog/inventory from the BigCommerce REST API.

## Commands

```bash
npm run dev                # dev server on :3000
npm run lint               # ESLint (next lint)
npm run test               # Vitest unit/integration tests
npm run build              # production build
npm run verify             # lint + test + test:e2e (fast e2e, ~5 min)
npm run preflight          # env-var + DB seed sanity check before deploy
```

Single Vitest test: `npx vitest run app/api/__tests__/chat.test.ts` (add `-t "name"` for one case). Tests live in `**/__tests__/*.test.ts`, run in a node environment, and use the `@/` alias for the repo root.

E2E (Playwright, chromium, 1 worker, builds first, serves on port 3050):

```bash
npm run test:e2e                       # skips @slow tests — the normal run
npm run test:e2e:slow                  # only @slow: e2e/bot-quality.spec.ts, ~50 real Claude calls, 25–30 min
npm run test:e2e:all                   # everything
npx playwright test e2e/smoke.spec.ts  # single spec (needs a prior `npm run build`)
```

Set `E2E_REUSE_SERVER=1` to reuse a server already listening on 3050; `E2E_BASE_URL=<url>` to run against a deployment. E2E expects seeded users — `e2e/global-setup.ts` clears their `mustResetPassword` flag. Run `test:e2e:slow` before merging anything that touches the bot prompt, tool gating, or the catalog/knowledge-base pipeline.

**E2E writes to the live production database.** Since the Supabase migration (2026-07-22), local `.env.local` `DATABASE_URL` points at the production Supabase project — there is no separate preview branch DB. The suite writes test sessions/messages into whatever `DATABASE_URL` points at (the `assertSafeDatabase()` guard requires `E2E_ALLOW_REMOTE_DB=1` for any non-localhost DB — never set it reflexively). Run e2e deliberately and sparingly: as a merge gate for changes that touch the DB layer, session state machine, or dashboards — not as a routine check (`npm run test` covers that). After a run, `npm run db:retag-test` tags the test sessions. For frequent e2e iteration, point `DATABASE_URL` at a local Postgres or a Supabase branch database instead.

DB: `npm run db:push` applies the Drizzle schema (schema lives in `lib/db/schema.ts`, config in `drizzle.config.ts`); `npm run db:seed` plus `db:seed:knowledge|products|pairings|catalog|colorways` populate data. `.env.example` is the source of truth for required env vars.

## Architecture

### The AI turn pipeline (`lib/ai/`)

`runAi.ts` (`runAiTurn`) is the single orchestrator for every AI reply. It is called from three entry points: the inline path in `app/api/chat/route.ts` (AI already claimed the session, or auto-claims), the queued sweep in `app/api/chat/ai-fallback/route.ts`, and the cron sweep in `lib/sessions/state.ts` (`processDueAiClaims`). Sequence per turn:

1. Pre-compute sentiment + request-classification signals (`quality.ts`)
2. `buildPrompt.ts` — assembles system prompt from `rules.ts` (behavior rules), `taxonomy.ts`, knowledge base rows, and product-search context (`lib/search/productSearch.ts`, BigCommerce enrichment). History is capped (first 2 + last 16 messages).
3. `callClaude.ts` — the Anthropic call; tools from `tools.ts` are only wired when `USE_AI_TOOLS=true`. Tool calls persist as `chat_events` rows; streaming goes through `sse.ts` to the widget.
4. Confidence assessment (`quality.ts`) + escalation decision (`escalationMode.ts`). On a **pausing** turn the model's entire visible reply is *replaced* with deterministic handoff copy — never appended after it.
5. Persist the message row, fire Pusher events, auto-escalate (notify at most once per session).

### Escalation + AI pause (Phase 2a)

`lib/ai/escalationMode.ts` is pure decision logic (no I/O, deliberately free of DB/SDK imports so it unit-tests directly). It distinguishes escalation modes: `no_data` (low confidence AND data tools returned nothing) and `undeliverable_offer` (same, but the previous AI message offered the info — detected by regex, no extra model call) both pause the AI; bare low confidence with retrieved data (`unsupported`) is notify-only. It also owns the punt-sentence scrubber.

`lib/sessions/aiPause.ts` owns the pause mechanics and **all customer-facing handoff copy** (`HANDOFF_HUMAN_COMING`, `HANDOFF_AFTER_HOURS`, `PAUSED_HOLDING_ACK` — copy variants are owner-approved; don't reword casually). A paused session suppresses inline AI turns until a human claims/releases it or the 45-minute timeout lapses (evaluated lazily, no cron needed). While paused, at most one holding acknowledgment is sent in a row.

### Session state machine (`lib/sessions/state.ts`)

Single source of truth for session transitions. All writes to `claimed_by_kind` / `claimed_by` / `closed_at` go through here; `sessions.status` (`waiting` → `active_ai` | `active_human` → `closed`) is always derived by `syncStatus()` — never set directly elsewhere. Human claims are race-safe atomic conditional updates. A human claim cancels the AI (`isHumanTakeoverError` marks mid-turn takeover).

### Realtime + timers

Pusher channels are defined in `lib/pusher/channels.ts`: one channel per session plus a shared `DASHBOARD_CHANNEL`. The AI fallback timer (default 60s, configurable) is driven by `/api/cron/tick` every minute (Vercel Pro), with a lazy backstop (`lib/sessions/lazyTick.ts`) fired from the customer heartbeat endpoint for Hobby-plan deployments. `/api/cron/cleanup` runs monthly retention. Both cron routes are gated by `CRON_SECRET`.

### Configuration lives in the DB

Bot settings (AI enabled, fallback timer seconds, SLA windows, retention) are stored as a `knowledge_base` row with `topic = "bot_settings"` (defaults in `components/dashboard/manager/botSettingsDefaults.ts`), edited from the manager dashboard — not env vars.

### Route surface

- `/embed`, `/chat` — widget UI; `/api/chat` — customer message intake (SSE streaming)
- `/dashboard/manager/*` — manager hub (analytics, team, knowledge, configure, pairings); `/dashboard/agent`, `/dashboard/chats`, `/dashboard/history` — agent queue/history
- `/api/sessions/*` — session lifecycle (create/claim/release/close/escalate); `/api/admin/*` — manager-only endpoints

`app/api/__tests__/security.test.ts` exercises authz on every admin/analytics/session endpoint — new endpoints in those areas need coverage there.

## Conventions

- Structured logging via `lib/log.ts` (`log`, `serializeError`) with `event="..."` names — these are grepped in Vercel logs for incident response (see `docs/RUNBOOK.md`).
- Customer PII is redacted before storage (`lib/utils/redactPII.ts`); rate limiting via `lib/rateLimit.ts`.
- Internal prompt scaffolding (section headers like STORE CATALOG, bracket tags like `[IN STOCK]`) must never leak into customer-facing text — there are rules and tests enforcing this.
- `docs/RUNBOOK.md` covers env-var rotation, cron reference, incident response, and log filters.
