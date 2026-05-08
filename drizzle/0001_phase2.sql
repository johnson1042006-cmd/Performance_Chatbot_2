CREATE TABLE "customer_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32),
	"name" varchar(255),
	"consent" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"rating" varchar(8) NOT NULL,
	"comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "customer_email" varchar(255);--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "customer_name" varchar(255);--> statement-breakpoint
ALTER TABLE "customer_contacts" ADD CONSTRAINT "customer_contacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_contacts_session_id_idx" ON "customer_contacts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "customer_contacts_email_lower_idx" ON "customer_contacts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "feedback_session_id_idx" ON "feedback" USING btree ("session_id");