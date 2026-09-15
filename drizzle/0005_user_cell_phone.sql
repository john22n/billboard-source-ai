-- Only add the account cell number; older schema changes were applied outside
-- the recorded Drizzle snapshots and must not be recreated by this migration.
ALTER TABLE "User" ADD COLUMN "cell_phone_number" varchar(16);
