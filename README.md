# Performance Cycle Chat

Embeddable customer support chat for Performance Cycle. Customers chat through a widget on the storefront; messages route through an AI fallback (Claude Haiku) and to human support agents via a role-based dashboard.

## Architecture

- **Framework**: Next.js 14 (App Router) — UI and API routes in one app
- **DB**: Postgres on Neon, accessed via Drizzle ORM
- **AI**: Anthropic Claude Haiku (`claude-haiku-4-5`)
- **Realtime**: Pusher (channels per session + a shared `dashboard` channel)
- **Auth**: NextAuth (Credentials + JWT), with `store_manager` and `support_agent` roles
- **Catalog/Inventory**: BigCommerce REST API; optional Lightspeed sync for product pairings

### Key routes

| Route | Purpose |
|-------|---------|
| `/embed`, `/chat` | Iframe-able widget UI (used by `public/embed.js`) |
| `/login` | NextAuth sign-in |
| `/dashboard/manager/*` | Manager hub: analytics, team, knowledge, configure, pairings |
| `/dashboard/agent`, `/dashboard/chats`, `/dashboard/history` | Agent live queue and history |
| `/api/chat` | Customer message intake |
| `/api/chat/ai-fallback` | AI reply trigger (skipped when `active_human`) |
| `/api/sessions/*` | Session lifecycle: create, claim, release, close |

## Local setup

```bash
npm install
cp .env.example .env.local        # then fill in values
npm run db:push                   # apply Drizzle schema to Neon
npm run db:seed                   # users (manager + agent)
npm run db:seed:knowledge         # knowledge base
npm run db:seed:products          # product catalog
npm run db:seed:pairings          # gear pairings
npm run db:seed:catalog           # local catalog (optional)
npm run db:seed:colorways         # colorway data (optional)
npm run dev
```

Default seeded credentials (change before production):

| Role | Email | Password |
|------|-------|----------|
| Manager | `manager@performancecycle.com` | `manager123` |
| Agent | `agent@performancecycle.com` | `agent123` |

## Environment variables

All required variables are listed in [`.env.example`](.env.example):

| Variable | Required | Notes |
|----------|----------|-------|
| `ANTHROPIC_API_KEY` | yes | For Claude AI fallback |
| `DATABASE_URL` | yes | Neon Postgres connection string |
| `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` | yes | Server-side Pusher |
| `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER` | yes | Client-side Pusher |
| `NEXTAUTH_SECRET` | yes | NextAuth JWT signing |
| `NEXTAUTH_URL` | yes | **Must match the deployed origin** (e.g. `https://your-app.vercel.app`) |
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

The script in [`public/embed.js`](public/embed.js) hardcodes the chat host URL at the top of the file — update `PC_CHAT_URL` if you deploy under a different domain. The same applies to [`public/fbt-widget.js`](public/fbt-widget.js) (`PC_FBT_URL`) for the frequently-bought-together widget.

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
- `NEXTAUTH_URL` is **not** `localhost`
- DB is reachable
- `users`, `knowledge_base`, `products`, and `product_pairings` each have at least one row

For Vercel deployments, the env vars must also be configured in the Vercel project's **Settings → Environment Variables**.

### 3. Embed URL alignment

Open [`public/embed.js`](public/embed.js) and [`public/fbt-widget.js`](public/fbt-widget.js) and confirm `PC_CHAT_URL` / `PC_FBT_URL` match the production deployment URL exactly. The embed snippet on the storefront should also point to the same host.

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
- Confirm `NEXTAUTH_SECRET` is unique per environment and not the example value.

## Testing notes

- Vitest specs live under `**/__tests__/*.test.ts`. The most security-relevant suite is [`app/api/__tests__/security.test.ts`](app/api/__tests__/security.test.ts), which exercises authz on every admin/analytics/session endpoint.
- Playwright smoke tests are in [`e2e/smoke.spec.ts`](e2e/smoke.spec.ts). They expect seeded manager + agent users (use `E2E_*` env vars to override the defaults).
- Set `E2E_BASE_URL=https://your-app.vercel.app` to run the smoke suite against a deployed environment.
