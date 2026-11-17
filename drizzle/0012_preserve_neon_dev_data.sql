CREATE TABLE "lead_notifications" (
	"id" varchar(80) PRIMARY KEY NOT NULL,
	"recipient_id" varchar(21),
	"assignee_id" varchar(80) NOT NULL,
	"assignee_email" text NOT NULL,
	"assignment_event_id" varchar(80) NOT NULL,
	"company_name" text NOT NULL,
	"lead_url" text NOT NULL,
	"lead_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nutshell_lead_summary_snapshot" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD',
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"total_leads" integer DEFAULT 0 NOT NULL,
	"won_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"lost_count" integer DEFAULT 0 NOT NULL,
	"total_won_value" numeric(14, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutshell_webhook_inbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" varchar(80) NOT NULL,
	"lead_id" varchar(80) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_reason" varchar(80),
	CONSTRAINT "nutshell_webhook_inbox_event_lead_unique" UNIQUE("event_id","lead_id")
);
--> statement-breakpoint
ALTER TABLE "art_wizard_settings" ADD COLUMN "image_settings" jsonb;--> statement-breakpoint
ALTER TABLE "lead_notifications" ADD CONSTRAINT "lead_notifications_recipient_id_User_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_notifications_recipient_idx" ON "lead_notifications" USING btree ("recipient_id","cleared_at","lead_created_at");--> statement-breakpoint
CREATE INDEX "nutshell_webhook_inbox_retry_idx" ON "nutshell_webhook_inbox" USING btree ("status","next_attempt_at");