ALTER TYPE "public"."chat_event_type" ADD VALUE 'internal_note';--> statement-breakpoint
CREATE TABLE "canned_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(120) NOT NULL,
	"body" text NOT NULL,
	"category" varchar(60) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canned_responses" ADD CONSTRAINT "canned_responses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canned_responses_category_idx" ON "canned_responses" USING btree ("category");--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "customer_city" varchar(80);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "customer_region" varchar(80);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "customer_country" varchar(80);
