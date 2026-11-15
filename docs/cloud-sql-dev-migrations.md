# Cloud SQL dev migration rollout

The approved rollout is complete on `billboard-source-db-dev` / `billboard_dev`.
John installed pgvector 0.8.5 in `public`; Amp applied migrations `0000–0011`
and app grants through the dev-only IAM identity after fixing the review findings.
**Production, the existing Neon database, and application deployment were untouched.**

Read-only post-rollout validation confirmed all 12 migration hashes/timestamps,
9 application tables, 82 columns, and 3 sequences. Column definitions,
constraints, and indexes match a separate local database generated from the
current application schema. App DML/sequence privileges and owner-specific
default privileges are correct; schema CREATE, migration-role membership,
journal access, and elevated role privileges remain denied. All application
tables contain zero rows. The proxy and disposable local PostgreSQL were stopped.

The six strengthened migration tests, 364 unit tests, 15 browser tests,
typecheck, targeted ESLint, and Fallow audit passed. The rehearsal enforces
PostgreSQL major version 18 and pgvector 0.8.5, and checks that reruns preserve
schema, representative data, permissions, defaults, and journal entries.

The procedure below is retained for reference, not an instruction to rerun the
completed rollout. Future shared-database writes require their own approval.

## What changes

`0011_complete_application_schema.sql` preserves migrations `0000–0010` and adds
the five missing tables (`Passkey`, `billboard_locations`, `nutshell_leads`,
`app_metrics`, `rate_limit_buckets`), eight missing `User` columns, foreign keys,
unique constraints, and indexes, including the 512-dimension vector HNSW index.
The new snapshot records the complete current schema for future generation.

This migration is for the empty Cloud SQL dev database or a database built from
the recorded chain. **Do not apply it blindly to an existing database with
out-of-band changes.** It deliberately does not use `IF NOT EXISTS` to conceal
incompatible definitions. Existing migration `0008` deletes saved wizard settings
and `0009` drops the obsolete quota table; on the empty dev bootstrap neither
contains user data. Do not copy production data into this rehearsal.

## Reproduce the local rehearsal

Install PostgreSQL **18** server/client tools and pgvector **0.8.5** (the version
currently available in Cloud SQL dev). Put the PostgreSQL 18 `bin` directory on
`PATH`; run as a non-root user. The test uses disposable Unix-socket-only clusters,
trust authentication only inside those clusters, synthetic data, and no cloud
credentials or `DATABASE_URL`. It stops PostgreSQL and removes its data afterward.

```bash
PATH=/usr/lib/postgresql/18/bin:$PATH pnpm test:db
pnpm exec drizzle-kit check
```

The test compares actual PostgreSQL columns, defaults, constraints, and indexes
after the full migration chain against an independently created database from
`db/schema.ts`. It checks reruns, app DML and sequence access, future-object
permissions, denial of app DDL/journal edits, and refusal of wrong identities,
wrong databases, missing pgvector, untracked objects, and modified history.
The regular Vitest command skips this opt-in integration suite; run `test:db`
explicitly when changing migrations or the schema. Browser tests use a partial
fixture schema and are not a substitute for this rehearsal.

## Approved rollout: prepare the extension first

After approval, use an existing administrator session in Cloud SQL Studio on
**billboard-source-db-dev**, database **billboard_dev**. Confirm the instance in
the console; the SQL database name alone cannot distinguish two servers. Run:

```sql
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'billboard_dev' THEN
    RAISE EXCEPTION 'Expected billboard_dev';
  END IF;
END
$guard$;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public VERSION '0.8.5';
COMMIT;
SELECT e.extname, e.extversion, n.nspname
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'vector';
```

Expect `vector`, `0.8.5`, `public`. If already installed at another version or in
another schema, stop and review; do not upgrade, move, or drop it automatically.
The IAM migration user cannot install this untrusted extension. No password
reset, new network rule, or broader IAM grant is needed for this step.

## Approved rollout: apply through the dev-only identity

Use the configured Amp WIF database identity, not the infrastructure account or
the application password. Start the Cloud SQL Auth Proxy with automatic IAM
authentication for exactly:

`cs-poc-l0o7at4xalxqxcyxekiay2j:us-central1:billboard-source-db-dev`

Bind it to `127.0.0.1:15432` with no portal, using the database external-account
configuration from the completed connection setup. Verify the proxy's connection
test succeeds. The executable only uses that loopback endpoint, database
`billboard_dev`, and IAM user
`amp-billboard-db@cs-poc-l0o7at4xalxqxcyxekiay2j.iam`.

Only after approval and inspection of the exact pending SQL:

```bash
pnpm db:migrate:dev --apply-dev
```

Without `--apply-dev`, the command exits before connecting. It never loads `.env`
or `DATABASE_URL`. SQL checks independently verify database, session identity,
pgvector, and a non-DDL app role. The dedicated WIF identity's dev-only Cloud SQL
IAM condition and the exact proxy target provide the instance boundary; SQL
names alone are not proof of instance identity. Do not use `db:push:dev` here.

The runner requires an empty public schema or an exact recorded migration-history
prefix, comparing both hashes and timestamps. It refuses untracked objects on a
fresh bootstrap and serializes this runner with an advisory lock. It does not
prove the absence of manual schema drift after recorded migrations; if anyone
has edited an already-migrated database manually, inspect and reconcile it first.

Pending migration SQL runs in Drizzle's transaction. The migration identity owns
its objects; no ownership is transferred. A separate repeatable transaction
grants `billboard_app_dev` SELECT/INSERT/UPDATE/DELETE on public tables and
USAGE/SELECT on sequences. Owner-specific default privileges cover future objects
created by this same migration identity in `public`. The app gets no schema CREATE,
table ALTER, role membership, or access to the `drizzle` migration journal.
The runner checks existing app CONNECT/USAGE rights rather than trying to grant
rights on the administrator-owned database/schema.

If migration SQL fails, its transaction rolls back; Drizzle's empty journal schema
may remain. If the later grants fail, the schema migrations remain committed:
inspect the error and rerun the same reviewed command after correcting it. The
verified journal prevents replaying completed migrations. Never edit journal
hashes to force acceptance and never reset/drop a shared database to recover.

After success, read back the journal, schema and effective permissions. Stop the
proxy. Do not seed application data, create an admin account, import production
data, or deploy as part of this rollout.

## Deployment remains separate

This is database preparation, not a Vercel cutover. `lib/config-core.ts` currently
selects Neon HTTP when running on Vercel; swapping `DATABASE_URL` alone will not
connect the app to Cloud SQL. Driver selection, runtime credentials/networking,
and any data migration need a separate reviewed change and authorization.
