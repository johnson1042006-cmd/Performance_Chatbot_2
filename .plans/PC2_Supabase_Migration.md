# Neon → Supabase Migration (PC2) — Phase 1: Host + Driver Swap

## Context

Performance Cycle chatbot (Next.js 14 on Vercel) runs Postgres on Neon (project
`fragrant-term-38731407`, us-west-2, PG 17.10, 21 MB / ~30k rows). Owner is consolidating
onto Supabase Pro (project ref `ouixdfvsbbjfpkpfvcvq`) and will later adopt Supabase Auth,
Realtime, RLS, and evaluate Storage/Edge Functions. Migration is **phased**: this plan
executes Phase 1 (pure host + driver swap) in full; Phases 2–5 are outlined at the end and
get their own plans later. No live users — brief downtime is fine; correctness is the
priority. Both Neon projects (incl. stale `bold-poetry-31521134`) are deleted after prod
verification. First execution step: copy this plan into `.plans/PC2_Supabase_Migration.md`
(the file the user created for it, currently empty).

**Why this is a driver swap, not a URL swap:** `lib/db/index.ts` uses Neon's proprietary
SQL-over-HTTP driver (`@neondatabase/serverless` `neon()` + `drizzle-orm/neon-http`),
which only speaks to `*.neon.tech`. 93 files import `@/lib/db` (safe if export shape is
preserved), but 13 files build their own `neon()` connections and must each be converted.

**Schema is 100% portable:** extensions `plpgsql` + `pg_trgm` only; `gen_random_uuid()`
PK defaults (built into PG17); 6 enums; 4 serial sequences; 2 GENERATED STORED tsvector
columns + GIN indexes (`drizzle/0004_phase5.sql`, `drizzle/0008_colorway_tsv.sql`);
functional `lower(email)` + partial indexes; no triggers/procs/pgvector. Junk table
`playing_with_neon` is excluded. Unit tests mock `@/lib/db` (driver-agnostic); only e2e
hits a real DB. No edge-runtime routes touch the DB.

## Design decisions

- **Driver:** `postgres` (postgres.js) + `drizzle-orm/postgres-js` (drizzle-orm 0.45.1
  already includes the dialect). First-class `prepare: false` (required by Supavisor
  transaction mode). Config: `{ prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 }`.
  No `db.transaction()`/`db.batch()` usage exists, so the drizzle API surface is identical.
- **Connection strings:** Vercel runtime uses the **transaction pooler** (port 6543,
  `aws-<region>.pooler.supabase.com`, IPv4 — Vercel has no IPv6 egress, and the direct
  `db.<ref>.supabase.co` host is IPv6-only without the paid add-on). drizzle-kit,
  dump/restore, and admin scripts use the **session pooler** (port 5432, same host —
  supports DDL + prepared statements + pg_dump). Both URLs come from Dashboard → Connect.
- **Env vars:** `DATABASE_URL` (transaction pooler) is the only runtime var —
  `getDatabaseUrl()` drops the `POSTGRES_URL*`/`DATABASE_URL_UNPOOLED` Vercel-Neon
  fallback chain. New `DIRECT_URL` (session pooler) used by `drizzle.config.ts`
  (falling back to `DATABASE_URL`).
- **Data move:** `pg_dump --format=custom` + `pg_restore` — preserves enums, generated
  columns, GIN/functional/partial indexes, and sequence values (`setval`) exactly.
  `drizzle-kit push` afterwards must report "no changes" — a free structural cross-check.
- **Needed from user at execution time:** Supabase DB password (Dashboard → Project
  Settings → Database) and the two pooler URLs.

## Step 0 — Prerequisites

- `brew install libpq` → PG17 `pg_dump`/`psql` at `$(brew --prefix libpq)/bin/` (local
  pg_dump is 14.20, too old for a PG17 server). No supabase CLI needed.
- Export for the session: `SUPABASE_TX_URL`, `SUPABASE_SESSION_URL`, `NEON_URL`
  (via `mcp__neon__get_connection_string`).

## Step 1 — Supabase provision checks (read-only)

`psql "$SUPABASE_SESSION_URL"`: confirm `version()` is 17.x (if PG15, upgrade in
Dashboard → Infrastructure **before** dumping), `pg_trgm` available, `public` schema empty.

## Step 2 — Code changes (branch `migrate/supabase-phase1`)

1. **New `lib/db/connect.ts`** — single connection factory replacing 14 copies of driver
   setup: `getDatabaseUrl()` (reads only `DATABASE_URL`), `createClient(url)` (postgres.js
   with the config above), `createDb(url)` returning `{ db, client }` so scripts can
   `await client.end()`. Exports `type Db = PostgresJsDatabase<typeof schema>`.
2. **`lib/db/index.ts`** — swap internals to `createDb()`; keep `getDb()` + lazy `Proxy`
   `db` export shape so the 93 importers are untouched.
3. **13 direct-connection files** — replace `neon()`/`neon-http` imports with
   `createDb()` from the factory; add `await client.end()` at completion:
   `scripts/{preflight,seed-users,seed-catalog,seed-products,seed-pairings,rotate-prod-passwords,refresh-catalog-skeleton,sync-lightspeed-pairings,sync-knowledge,backfill-claim-kind,test-catalog}.ts`,
   `lib/knowledge/seedKnowledge.ts`, `e2e/global-setup.ts`.
4. **`e2e/global-setup.ts`** — keep `assertSafeDatabase()` logic (Supabase URLs still fail
   the localhost check correctly); update Neon-specific messages/comments. Keep warm-up
   fetches; fix stale "sleeping Neon compute" comments (Supabase Pro is always-on).
5. **`drizzle.config.ts`** — `url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!`.
6. **`package.json`** — remove `@neondatabase/serverless`, add `postgres` ^3.4.
7. **`.env.example`** — Supabase URL formats for `DATABASE_URL` + new `DIRECT_URL`.
8. **Comment-only:** `lib/rateLimit.ts`, `lib/sessions/lazyTick.ts`,
   `.claude/hooks/block-env-edits.js` (logic is provider-agnostic — no functional change).
9. **Docs:** `README.md`, `CLAUDE.md`, `docs/RUNBOOK.md` (replace Neon branch-endpoint
   references with Supabase project ref + pooler guidance),
   `.claude/skills/db-migrate/SKILL.md` (Neon-branch workflow → Supabase
   branch/backup workflow; `db:push` uses `DIRECT_URL`).
10. **De-risk check:** run `npm run verify` with the new driver still pointed at **Neon's
    TCP endpoint** (postgres.js speaks normal Postgres wire) — proves the driver swap
    independently of the host swap. `test:e2e:slow` not needed (no prompt/tool/catalog
    pipeline changes).

## Step 3 — Dump from Neon

```
pg_dump "$NEON_URL" --format=custom --no-owner --no-privileges \
  --exclude-table='public.playing_with_neon' --file=<scratchpad>/neon_<ts>.dump
```
Keep the dump until after Neon deletion — it's the archival backup.

## Step 4 — Restore into Supabase

```
pg_restore --dbname "$SUPABASE_SESSION_URL" --no-owner --no-privileges \
  --clean --if-exists --verbose <dump>
```
Ignorable: `extension "pg_trgm" already exists`. Anything else: stop and read.

## Step 5 — Post-restore verification

- SQL checks: 19 tables, 6 enums, 4 sequences with `last_value` matching Neon, non-null
  `content_tsv` / `colorway_tsv` counts, index list (GIN, `lower(email)`, partial).
- Per-table row counts vs Neon (`mcp__neon__run_sql` vs psql).
- Behavioral probes: `to_tsquery('simple','green')` against `product_colorways`;
  `lower(email)` lookup.
- `npx drizzle-kit push` against Supabase → must report **no changes**.

## Step 6 — Full app verification pre-flip

`.env.local` → Supabase URLs; `npm run preflight`, then `npm run verify` with
`E2E_REUSE_SERVER`/`E2E_ALLOW_REMOTE_DB=1` as needed. (E2E test sessions land in the
Supabase copy — fine pre-cutover; Neon remains authoritative.)

## Step 7 — Cutover (Vercel)

1. Disconnect the Neon marketplace integration (Dashboard → Integrations) so auto-injected
   `POSTGRES_URL*` vars disappear; verify with `vercel env ls`.
2. Replace `DATABASE_URL` (transaction pooler) and add `DIRECT_URL` (session pooler) for
   production **and preview** via `vercel env`.
3. Merge branch to main → prod deploy.

## Step 8 — Production verification

- `vercel env pull` + `npm run preflight` against prod env.
- Dashboard login (manager + agent) — NextAuth → `users` + `lower(email)` index.
- `/embed` chat flow with a product question — sessions/messages/KB/product search/Pusher.
- Colorway search ("green jacket") — proves restored `colorway_tsv` + GIN.
- Manager message search — proves `content_tsv`.
- Vercel logs: `/api/cron/tick` 200s each minute; `catalog-refresh` next morning;
  watch 15–30 min for connection/`prepare` errors (wrong-port symptom).

## Step 9 — Decommission (destructive — confirm with user first)

After 24–48 h clean: archive the dump durably, then delete Neon projects
`fragrant-term-38731407` and `bold-poetry-31521134`.

## Rollback (valid until Step 9)

- Pre-flip: nothing to do.
- Post-flip: fastest path is env-only — point `DATABASE_URL` back at Neon's TCP string
  (new driver works against Neon); or Vercel Instant Rollback + env restore.
- Damaged Supabase data: re-run `pg_restore --clean` from the Step 3 dump.
- After Neon deletion: dump file is the only fallback — hence the 24–48 h window.

## Explicitly NOT changed in Phase 1

NextAuth, Pusher, SSE streaming, AI pipeline, session state machine, rate limiting,
crons, BigCommerce/Lightspeed/Resend, all app logic. No RLS (app connects as `postgres`,
which bypasses RLS — enabling now would be theater). No `@supabase/supabase-js`.

## Phases 2–5 (outlines — separate plans later)

**Phase 2 — Supabase Auth replaces NextAuth:** migrate `users` → `auth.users` via Admin
API (bcrypt imports cleanly); roles in `app_metadata`; public `users` row becomes profile
FK'd to `auth.users.id`; `@supabase/ssr` cookie sessions replace NextAuth JWT; rebuild
`mustResetPassword` flow; rewrite `security.test.ts` mocks + e2e login helpers.
Risks: user-ID FK changes across sessions/messages; e2e coupling to NextAuth endpoints.

**Phase 3 — Supabase Realtime replaces Pusher:** map `lib/pusher/channels.ts` (per-session
+ `DASHBOARD_CHANNEL`) to Broadcast channels; server publishes via service-role client;
SSE streaming stays. Widget is unauthenticated → anon-key Broadcast with channel authz
(RLS on `realtime.messages`). Risks: delivery semantics, reconnect ordering, claim-race UX.

**Phase 4 — RLS:** only meaningful after Phase 2 (queries must carry user JWTs) or with
service-role/anon separation. Start with `users`/`sessions`/`messages`, enable
table-by-table. Risks: cron/script paths silently returning 0 rows; policy perf on hot
`messages` path.

**Phase 5 — Storage/Edge Functions:** nothing uses file storage (transcripts via Resend,
images via BigCommerce URLs); Vercel crons already work and catalog-refresh needs 300 s.
**Evaluate, likely skip both.**

## Verification summary

`npm run verify` twice (Step 2 vs Neon, Step 6 vs Supabase), `npm run preflight` twice
(local + prod env), SQL structural + behavioral probes (Step 5), `drizzle-kit push`
no-change check, and the live prod checklist (Step 8).

---

## EXECUTION LOG — Phase 1 completed 2026-07-22

**Status: LIVE ON SUPABASE.** Prod deploy `73b1344` (dpl_2QyDmxhQzmLHqv2QPDBZRZcQ6Mhz).

- Supabase project `ouixdfvsbbjfpkpfvcvq`, region **aws-1 ca-central-1**, PG 17.6.
- Data: pg_dump/pg_restore clean; all 19 row counts exact; schema dumps byte-identical;
  colorway FTS + lower(email) probes pass. Dump archived: `~/Desktop/PC2_db_backups/neon_prod_20260722_2017.dump`.
- Gates: 752 unit tests; e2e vs Neon TCP w/ new driver 108 pass; e2e vs Supabase 112 pass/0 fail.
- **Deviation:** skipped drizzle-kit push no-change check (can't dry-run; byte-identical
  schema diff used instead — stronger).
- **Fix found:** pool `max` 1→10 (`DB_POOL_MAX` env override). max:1 serialized all queries
  per process; at ca-central-1 latency (~120 ms RTT) concurrent dashboard loads stacked past 30 s.
- **Pre-existing finding (not migration):** `messages.content_tsv` is a plain NULL column in
  prod — the generated-column migration (drizzle/0004_phase5.sql) never landed via db:push.
  Message FTS has been silently degraded on Neon too. Follow-up candidate.
- Vercel env: `DATABASE_URL` (tx pooler :6543) + `DIRECT_URL` (session pooler :5432) in
  prod/preview/dev; all 15 Neon/`POSTGRES_*` vars removed via CLI.
- Prod verified: /api/chat/settings, session create, streamed AI reply with real green-jacket
  colorway results, cron tick 200s every minute, zero runtime errors.

**Open items:**
1. User: one manual dashboard login (auth path exercised in e2e, not yet clicked in prod).
2. User: disconnect Neon marketplace integration (Vercel dashboard → Storage) so it can't re-inject vars.
3. Local `.env.local` still points at Neon — update DATABASE_URL/DIRECT_URL to Supabase (hook blocks Claude editing it).
4. **Step 9 (after 24–48 h clean):** delete Neon projects `fragrant-term-38731407` + `bold-poetry-31521134` (explicit go required).
5. Confirm `/api/cron/catalog-refresh` succeeds next morning.
