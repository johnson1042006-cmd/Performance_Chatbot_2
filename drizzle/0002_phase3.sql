ALTER TYPE "public"."chat_event_type" ADD VALUE 'tool_call';--> statement-breakpoint
ALTER TYPE "public"."chat_event_type" ADD VALUE 'auto_escalated';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "confidence" varchar(8);--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sentiment" integer;