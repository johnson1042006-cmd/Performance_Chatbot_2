# Performance Cycle Chat

Embeddable customer support chat for Performance Cycle. Customers chat through a widget on the storefront; messages route through an AI fallback (Claude Haiku) and to human support agents via a role-based dashboard.

## Architecture

- **Framework**: Next.js 14 (App Router) — UI and API routes in one app
- **DB**: Postgres on Supabase, accessed via Drizzle ORM
- **AI**: Anthropic Claude Haiku (`claude-haiku-4-5`)
- **Realtime**: Pusher (channels per session + a shared `dashboard` channel)
- **Auth**: Supabase Auth (email/password) — identity in `auth.users`, roles/flags in `public.users`, with `store_manager` and `support_agent` roles
- **Catalog/Inventory**: BigCommerce REST API; optional Lightspeed sync for product pairings

### Key routes

| Route | Purpose |
|-------|---------|
| `/embed`, `/chat` | Iframe-able widget UI (used by `public/embed.js`) |
| `/login` | Supabase Auth sign-in |
| `/dashboard/manager/*` | Manager hub: analytics, team, knowledge, configure, pairings |
| `/dashboard/agent`, `/dashboard/chats`, `/dashboard/history` | Agent live queue and history |
| `/api/chat` | Customer message intake |
| `/api/chat/ai-fallback` | AI reply trigger (skipped when `active_human`) |
| `/api/sessions/*` | Session lifecycle: create, claim, release, close |

## Local setup

```bash
npm install
cp .env.example .env.local        # then fill in values
npm run db:push                   # apply Drizzle schema to Supabase
npm run db:seed                   # users (manager + agent)
npm run db:seed:knowledge         # knowledge base
npm run db:seed:products          # product catalog
npm run db:seed:pairings          # gear pairings
npm run db:seed:catalog           # local catalog (optional)
npm run db:seed:colorways         # colorway data (optional)
npm run dev
```

Seeded accounts (`manager@performancecycle.com`, `agent@performancecycle.com`)
get their passwords from the `SEED_MANAGER_PASSWORD` / `SEED_AGENT_PASSWORD`
env vars at seed time. If those vars are unset, `npm run db:seed` generates a
strong random password and prints it once to stdout. Seeded users are always
created with `mustResetPassword = true`, so the password must be changed on
first login. To rotate the seeded accounts later, set the same env vars and run
`npm run db:rotate-passwords`.

## Environment variables

All required variables are listed in [`.env.example`](.env.example):

| Variable | Required | Notes |
|----------|----------|-------|
| `ANTHROPIC_API_KEY` | yes | For Claude AI fallback |
| `DATABASE_URL` | yes | Supabase Postgres connection string (transaction pooler, port 6543) |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | yes | Server-side Pusher |
| `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER` | yes | Client-side Pusher |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL (browser-safe) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Supabase publishable key (browser-safe) |
| `SUPABASE_SECRET_KEY` | yes | Supabase service-role key (**server only**) |
| `BIGCOMMERCE_STORE_HASH`, `BIGCOMMERCE_ACCESS_TOKEN` | yes | Catalog/inventory enrichment |
| `LIGHTSPEED_ACCOUNT_ID`, `LIGHTSPEED_API_KEY` | optional | Only for `npm run sync:lightspeed` |

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start dev server on `http://localhost:3000` |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit/integration tests |
| `npm run test:e2e` | Playwright smoke tests (requires `npx playwright install` first) |
| `npm run preflight` | Verify env vars and DB seed data — run before deploying |
| `npm run db:push` | Apply Drizzle schema |
| `npm run db:seed*` | Seed users, knowledge, products, pairings, etc. |
| `npm run sync:lightspeed` | Sync pairings from Lightspeed (optional) |

## Embedding the widget

Add to any storefront page (e.g. BigCommerce theme footer):

```html
<script src="https://your-app.vercel.app/embed.js" async></script>
```

The script in [`public/embed.js`](public/embed.js) hardcodes the chat host URL at the top of the file — update `PC_CHAT_URL` if you deploy under a different domain.

## Pre-launch checklist

Before deploying or running a demo, work through this list.

### 1. Code health

```bash
npm run lint
npm run test
npm run build
```

All three must pass.

### 2. Environment + DB sanity (preflight)

Set up your `.env.local` with **production** values, then:

```bash
npm run preflight
```

The script verifies:

- All required env vars are populated
- Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, publishable + secret keys) are populated
- DB is reachable
- `users`, `knowledge_base`, `products`, and `product_pairings` each have at least one row

For Vercel deployments, the env vars must also be configured in the Vercel project's **Settings → Environment Variables**.

### 3. Embed URL alignment

Open [`public/embed.js`](public/embed.js) and confirm `PC_CHAT_URL` matches the production deployment URL exactly. The embed snippet on the storefront should also point to the same host.

### 4. Manual end-to-end walkthrough

Open the deployed site in two browser tabs (or one normal + one private window):

1. **Tab A — customer:** open a storefront page that loads `embed.js`. Click the chat bubble. Send "I'm looking for a black helmet under $500."
2. **Tab B — agent:** sign in at `/login` with the agent credentials. Open `/dashboard/chats`. Confirm the new session appears in the queue in real time (Pusher).
3. **AI fallback:** wait for the configured `fallbackTimerSeconds` (default 60s). Confirm an AI reply arrives in Tab A.
4. **Human takeover:** in Tab B, click "Claim Chat" on the session. Confirm Tab A receives the `session-claimed` event (typing indicator clears, AI fallback timer cancels).
5. **Agent reply:** type and send a message from Tab B. Confirm it appears in Tab A as a human agent message.
6. **Close session:** close the session from Tab B. Confirm it moves out of the live queue and into `/dashboard/history`.
7. **Manager view:** sign in as the manager. Open `/dashboard/manager`. Confirm the session shows in metrics ("Chats Today" should increment).

### 5. Production secrets

- Rotate the seeded `manager123` / `agent123` passwords (or seed a fresh set of users).
- Confirm `SUPABASE_SECRET_KEY` is the service-role key and is set SERVER-ONLY (never `NEXT_PUBLIC_`).

## Testing notes

- Vitest specs live under `**/__tests__/*.test.ts`. The most security-relevant suite is [`app/api/__tests__/security.test.ts`](app/api/__tests__/security.test.ts), which exercises authz on every admin/analytics/session endpoint.
- Playwright smoke tests are in [`e2e/smoke.spec.ts`](e2e/smoke.spec.ts). They expect seeded manager + agent users (use `E2E_*` env vars to override the defaults).
- Set `E2E_BASE_URL=https://your-app.vercel.app` to run the smoke suite against a deployed environment.

## Production setup

### Required environment variables
See `.env.example` for the full list.

### Cron jobs
This app uses two scheduled jobs (defined in `vercel.json`):

- `/api/cron/tick` — every minute. Sweeps stale sessions and fires the AI fallback for queued chats whose timer has expired. Required for the AI fallback timer to work reliably regardless of whether the dashboard is open. **Requires Vercel Pro plan** (Hobby plan does not support sub-daily crons). On Hobby, the heartbeat endpoint provides a backstop that fires the sweep whenever a customer tab is open.

- `/api/cron/cleanup` — monthly. Deletes chat history older than the configured retention period (set via the manager dashboard).

Both endpoints are auth-gated by `CRON_SECRET`. Vercel automatically includes this in cron requests once the env var is set.

### External cron alternative
If staying on Vercel Hobby and the heartbeat backstop isn't sufficient (e.g. you want the timer to work even when no customer tab is open), schedule an external service (cron-job.org, GitHub Actions schedule, etc.) to GET `/api/cron/tick` every minute with the header `Authorization: Bearer <CRON_SECRET>`.
