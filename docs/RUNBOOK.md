## Architecture overview

```mermaid
flowchart LR
  customer[Customer_browser] --> embedJs[public/embed.js]
  embedJs --> embedPage[/embed_iframe]
  embedPage --> apiChat[/api/chat]
  apiChat --> callClaude[lib/ai/callClaude]
  callClaude --> anthropic[Claude_API]
  callClaude --> tools[lib/ai/tools]
  apiChat --> kb[knowledge_base]
  apiChat --> db[(Postgres)]
  db --> pusher[Pusher]
  pusher --> embedPage

  agent[Agent_dashboard] --> dashboardApi[Next_app_routes]
  dashboardApi --> db
  dashboardApi --> pusher
  pusher --> agent
```

## Environment variables

Source of truth for what’s required locally is `.env.example`.

- **ANTHROPIC_API_KEY**: Claude API key (Phase 1). Rotate in Anthropic console; update Vercel env var.
- **DATABASE_URL**: Postgres connection string (Phase 1). Rotate by issuing new DB credentials / connection string.
- **PUSHER_APP_ID / PUSHER_KEY / PUSHER_SECRET / PUSHER_CLUSTER**: Pusher server credentials (Phase 2). Rotate in Pusher dashboard; update Vercel env vars.
- **NEXT_PUBLIC_PUSHER_KEY / NEXT_PUBLIC_PUSHER_CLUSTER**: Pusher browser values (Phase 2). Rotate with the Pusher key/cluster.
- **NEXTAUTH_SECRET**: NextAuth signing secret (Phase 1). Rotate with `openssl rand -base64 32`; invalidate existing sessions.
- **NEXTAUTH_URL**: Base URL for auth callbacks (Phase 1). Set to production URL in Vercel.
- **BIGCOMMERCE_STORE_HASH / BIGCOMMERCE_ACCESS_TOKEN**: BigCommerce API access (Phase 2). Rotate token in BigCommerce admin.
- **CRON_SECRET**: Auth secret for `/api/cron/*` (Phase 5). Rotate with `openssl rand -base64 32`; update Vercel.
- **SLACK_WEBHOOK_URL**: Slack alert notifications (Phase 5). Rotate by creating a new webhook URL.
- **NEXT_PUBLIC_DASHBOARD_URL**: Slack “View dashboard” button URL (Phase 5). Update if dashboard URL changes.
- **SERVICE_INBOX**: Tech-Air service request inbox (Phase 6). Update to the correct operational inbox.
- **RESEND_API_KEY / RESEND_FROM_EMAIL**: Email sending via Resend (Phase 5.5). Rotate in Resend dashboard.
- **SUPPORT_INBOX**: Offline “talk to a human” callback inbox (Phase 3/5.5).

### Local env files — pull safely

Local env lives in `.env.local` only. Do NOT keep a `.env.production.local` in
the repo directory: `next build`/`next start` run with NODE_ENV=production and
prefer that file over `.env.local`, so (a) Vercel "Sensitive" vars pull as
empty strings — an empty `NEXTAUTH_URL=""` makes next-auth throw `Invalid URL`
and fails every page at prerender — and (b) its `DATABASE_URL` points local
servers (including the e2e webServer) at the PRODUCTION database. This exact
footgun broke local builds on 2026-07-12.

To refresh local env: `vercel env pull .env.local --environment=preview`, then
fix up the values that pull empty (Sensitive-type vars — Pusher, VAPID,
CRON_SECRET, `USE_ROUTING_CLASSIFIER`) from their dashboards, and make sure
`NEXTAUTH_URL="http://localhost:3000"` and `DATABASE_URL` targets the Preview
Neon branch (`ep-dark-rice…`), never production (`ep-withered-silence…`). If
you need production values for an incident, pull to a file OUTSIDE the repo
and delete it when done.

## Verification suite (`npm run verify`)

`npm run verify` chains lint + unit tests + e2e (Playwright). The default e2e
run **excludes** tests tagged `@slow` so it completes in roughly 5 minutes
locally.

- **`npm run test:e2e`** — fast e2e (skips `@slow`). Used by `verify`.
- **`npm run test:e2e:slow`** — run only the slow suite. Currently this is
  `e2e/bot-quality.spec.ts`, which makes 50 sequential Claude calls and takes
  ~25–30 minutes. Run before merging changes that touch the bot prompt,
  tool-gating, or the catalog/knowledge-base pipeline.
- **`npm run test:e2e:all`** — every Playwright spec including `@slow`.

CI should run `test:e2e:all` (or schedule `test:e2e:slow` separately) so
regressions in `bot-quality` are still caught — they’re just kept off the
fast local feedback loop.

## Common operational tasks

- **Rotate Anthropic key**: update `ANTHROPIC_API_KEY` in Vercel → redeploy.
- **Rotate BigCommerce token**: update `BIGCOMMERCE_ACCESS_TOKEN` in Vercel → redeploy.
- **Rotate Resend key**: update `RESEND_API_KEY` in Vercel → redeploy.
- **Add a knowledge_base entry**: manager dashboard → KB section (or seed via scripts if intended to be default).
- **Edit a canned response**: update KB entries used by prompt (`knowledge_base` rows).
- **Change SLA windows**: manager dashboard → Bot Settings → SLA windows.
- **Add an alert threshold / ack / claim / reassign / force-close**: manager dashboard Alerts / Live Chats surfaces (Phase 5+).
- **Run prelaunch defaults reset**: `npx tsx scripts/prelaunch-reset.ts`
- **Run preflight checks**: `npm run preflight`

## Cron jobs reference

- **`/api/cron/tick`**: every minute. Evaluates alerts + SLA breach detection.
- **`/api/cron/cleanup`**: monthly. Runs retention cleanup / maintenance tasks.

## Proactive engagement pulse (manual verification)

Playwright does not wait 60 seconds for timers in a stable way. Manual test:

- Visit a product-like path (examples): `/products/...`, `/helmets/...`, `/boots/...`, `/tires/...`, `/jackets/...`
- Keep the widget closed and do not send a message.
- Wait 60 seconds.
- Confirm:
  - bubble does a subtle pulse animation
  - a small notification dot appears
  - refresh does not re-fire within the same tab session (uses `sessionStorage['pc-pulse-fired']`)

## Known limitations + post-launch fix list

- See Phase 7 for enhancements and any deferred items (tracking doc owned post-launch).

## Incident response

- **Bot hallucinating / wrong KB content**: disable AI (`aiEnabled=false`) in manager settings temporarily; verify KB entries; check tool gating (`USE_AI_TOOLS`).
- **500s in chat**: inspect Vercel function logs for `/api/chat` and session subroutes; confirm env vars present.
- **Missing escalations**: verify `/api/cron/tick` schedule + logs; verify agent presence heartbeat and Pusher config.
- **Emails not sending**: check `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and target inbox env vars (`SUPPORT_INBOX`, `SERVICE_INBOX`).

## Where to find logs (Vercel)

Use Vercel function logs. Useful filters:

- `event="tech_air_request.unhandled"`
- `event="email.disabled_no_api_key"`
- `event="notify_support.unhandled"`
- `event="ai.run.pusher_failed"`

## Ownership / contacts

- **Built by**: Antonio J.
- **Owner post-Phase-8**: Performance Cycle owners (handoff after launch)

