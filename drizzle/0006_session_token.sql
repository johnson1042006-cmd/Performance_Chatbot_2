-- Phase 6: per-session customer access token.
-- Adds sessions.token_hash, holding the SHA-256 hash of the raw token handed
-- to the widget at session creation. Customer-facing [id]/* routes verify the
-- token against this hash. Nullable so sessions created before this migration
-- keep working (legacy grace handled in lib/sessions/verifySessionToken.ts).

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "token_hash" text;
