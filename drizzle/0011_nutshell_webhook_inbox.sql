CREATE TABLE "nutshell_webhook_inbox" (
  "id" serial PRIMARY KEY NOT NULL,
  "event_id" varchar(80) NOT NULL,
  "lead_id" varchar(80) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "nutshell_webhook_inbox_event_lead_unique" UNIQUE("event_id", "lead_id")
);
