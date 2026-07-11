-- Phase 2a: escalation mode split — AI pause mechanism.
-- New chat_event_type values for the pause audit trail, and two nullable
-- columns on sessions. Additive + nullable: safe to apply before the code
-- that uses them deploys, but the code REQUIRES these columns (drizzle
-- selects all mapped columns), so apply this migration to an environment's
-- database BEFORE deploying Phase 2a code there.
ALTER TYPE "chat_event_type" ADD VALUE IF NOT EXISTS 'ai_paused';
ALTER TYPE "chat_event_type" ADD VALUE IF NOT EXISTS 'ai_pause_cleared';
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ai_paused_at" timestamp;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "ai_pause_reason" varchar(40);
