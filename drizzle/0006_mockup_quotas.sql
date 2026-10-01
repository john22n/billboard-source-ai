-- Minimal quota accounting only: no prompts, conversations, or generated images.
CREATE TABLE "mockup_quotas" (
  "user_id" varchar(21) PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "day" varchar(10) NOT NULL,
  "successes" integer NOT NULL DEFAULT 0 CHECK (successes BETWEEN 0 AND 10),
  "reservation" varchar(36),
  "reserved_until" timestamptz
);
