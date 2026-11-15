-- Reconcile recorded history with the current schema for the empty Cloud SQL dev database.
-- Existing databases with out-of-band schema changes need a separate reconciliation.
CREATE TABLE "app_metrics" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"main_calls_total" integer DEFAULT 0 NOT NULL
);

--> statement-breakpoint
CREATE TABLE "billboard_locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"county" text,
	"avg_daily_views" text,
	"four_week_range" text,
	"market" text,
	"market_range" text,
	"general_range" text,
	"details" text,
	"avg_bull_price_per_month" integer DEFAULT 0,
	"avg_stat_bull_views_per_week" integer DEFAULT 0,
	"avg_poster_price_per_month" integer DEFAULT 0,
	"avg_poster_views_per_week" integer DEFAULT 0,
	"avg_digital_price_per_month" integer DEFAULT 0,
	"avg_digital_views_per_week" integer DEFAULT 0,
	"avg_views_per_period" text,
	"embedding" vector(512),
	CONSTRAINT "city_state_unique" UNIQUE("city","state")
);

--> statement-breakpoint
CREATE TABLE "nutshell_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"nutshell_lead_id" integer NOT NULL,
	"description" text,
	"status" integer DEFAULT 0 NOT NULL,
	"value" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'USD',
	"assignee_email" text,
	"created_by_user_id" text,
	"nutshell_created_at" timestamp,
	"closed_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nutshell_leads_nutshell_lead_id_unique" UNIQUE("nutshell_lead_id")
);

--> statement-breakpoint
CREATE TABLE "Passkey" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"user_id" varchar(21) NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" varchar(32),
	"transports" text,
	"name" varchar(64) DEFAULT 'Passkey',
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "Passkey_credential_id_unique" UNIQUE("credential_id")
);

--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"key" varchar(160) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);

--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "twilio_phone_number" varchar(20);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "taskrouter_worker_sid" varchar(34);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "worker_activity" varchar(20) DEFAULT 'offline';
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "calls_accepted" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "calls_rejected" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "calls_missed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "last_attempt_sid" varchar(48);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN "last_reject_at" timestamp;
--> statement-breakpoint
ALTER TABLE "nutshell_leads" ADD CONSTRAINT "nutshell_leads_created_by_user_id_User_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_user_id_User_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."User"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "embedding_index" ON "billboard_locations" USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX "city_state_idx" ON "billboard_locations" USING btree ("city","state");
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_reset_at_idx" ON "rate_limit_buckets" USING btree ("reset_at");
--> statement-breakpoint
ALTER TABLE "User" ADD CONSTRAINT "user_twilio_phone_number_unique" UNIQUE("twilio_phone_number");
