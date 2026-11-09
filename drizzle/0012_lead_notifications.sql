ALTER TABLE "nutshell_webhook_inbox" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "nutshell_webhook_inbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "nutshell_webhook_inbox" ADD COLUMN "last_reason" varchar(80);
CREATE INDEX "nutshell_webhook_inbox_retry_idx" ON "nutshell_webhook_inbox" ("status", "next_attempt_at");
CREATE TABLE "lead_notifications" (
  "id" varchar(80) PRIMARY KEY NOT NULL,
  "recipient_id" varchar(21) REFERENCES "User"("id"),
  "assignee_id" varchar(80) NOT NULL,
  "assignee_email" text NOT NULL,
  "assignment_event_id" varchar(80) NOT NULL,
  "company_name" text NOT NULL,
  "lead_url" text NOT NULL,
  "lead_created_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "cleared_at" timestamp with time zone
);
CREATE INDEX "lead_notifications_recipient_idx" ON "lead_notifications" ("recipient_id", "cleared_at", "lead_created_at");
