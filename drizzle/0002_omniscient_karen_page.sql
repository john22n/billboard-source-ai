ALTER TABLE "openai_logs" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "openai_logs" ADD COLUMN "status" text DEFAULT 'completed';