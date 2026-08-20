CREATE TABLE "reported_issues" (
	"report_id" varchar(12) PRIMARY KEY NOT NULL,
	"reporter_id" varchar(21),
	"reporter_email" varchar(64) NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"lookback_minutes" integer NOT NULL,
	"diagnosis" jsonb NOT NULL,
	"unavailable_sources" jsonb NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_id" varchar(21),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reported_issues" ADD CONSTRAINT "reported_issues_reporter_id_User_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reported_issues" ADD CONSTRAINT "reported_issues_resolved_by_id_User_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reported_issues_created_at_idx" ON "reported_issues" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX "reported_issues_resolved_at_idx" ON "reported_issues" USING btree ("resolved_at");
