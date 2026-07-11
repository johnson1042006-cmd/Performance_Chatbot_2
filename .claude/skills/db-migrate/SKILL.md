---
name: db-migrate
description: Make a Postgres schema change safely with Drizzle + Neon — edit lib/db/schema.ts, push, update seeds/tests, verify. Use when adding or altering tables, columns, or enums.
---

# DB schema changes (Drizzle + Neon)

This repo uses `drizzle-kit push` (schema-diff push, no migration files).
`lib/db/schema.ts` is the single source of truth; `drizzle/meta/` snapshots
are managed by drizzle-kit — never edit them by hand.

## Workflow

1. **Edit `lib/db/schema.ts`.** Match existing naming: snake_case column
   names, camelCase TS properties.
2. **Push:** `npm run db:push`. Drizzle prompts before destructive operations —
   read the prompt carefully; a rename diffs as drop+add and loses data.
   For renames: add the new column, backfill, then drop the old one.
3. **Update dependents:**
   - Seed scripts (`scripts/seed-*.ts`) if the table is seeded
   - `lib/sessions/state.ts` if session columns changed (`status` is derived
     by `syncStatus()` — never set directly)
   - Pusher `session-update` payloads if dashboards need the new field
4. **Verify:** `npm run test`, then `npm run preflight` (DB reachability +
   required seed rows).

## Cautions

- `DATABASE_URL` points at a live Neon database — `db:push` applies
  immediately and there is no down-migration. For risky changes, create a
  Neon branch first and test the push there.
- Config-like data (bot settings, SLA windows) lives in `knowledge_base`
  rows, not new tables — check `botSettingsDefaults.ts` before adding a
  settings table.
