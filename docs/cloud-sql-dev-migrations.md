# Cloud SQL dev migration rollout

## Neon dev data reconciliation and import

On 2026-11-16, migration `0012_preserve_neon_dev_data` was applied to
`billboard-source-db-dev` / `billboard_dev`, followed by the explicitly approved
data copy from Neon `billboardsourceAI-dev` (`neondb` on
`ep-wandering-bar-ah76v51o-pooler.c-3.us-east-1.aws.neon.tech`).
The source snapshot began at **2026-11-16 22:07:51.207012 UTC**.

The additive migration creates `lead_notifications`, `nutshell_webhook_inbox`,
and `nutshell_lead_summary_snapshot`, and adds nullable `image_settings` to
`art_wizard_settings`. The existing individual-record `nutshell_leads` is
unchanged. John approved preserving the source aggregate separately, without
changing app statistics or manufacturing individual leads.

| Source table           | Destination table              | Rows copied |
| ---------------------- | ------------------------------ | ----------: |
| User                   | User                           |           4 |
| Passkey                | Passkey                        |           0 |
| app_metrics            | app_metrics                    |           1 |
| art_wizard_settings    | art_wizard_settings            |           1 |
| billboard_locations    | billboard_locations            |      30,310 |
| lead_notifications     | lead_notifications             |           8 |
| nutshell_leads         | nutshell_lead_summary_snapshot |           1 |
| nutshell_webhook_inbox | nutshell_webhook_inbox         |         121 |
| openai_logs            | openai_logs                    |          84 |
| rate_limit_buckets     | rate_limit_buckets             |          25 |
| reported_issues        | reported_issues                |           0 |

**30,555 rows copied; no source table omitted.** Destination individual leads
remain empty. All 12 destination tables were rechecked empty under exclusive
table locks before import, with the migration advisory lock held. A complete
rehearsal was rolled back before the committed copy. Data moved in memory using
a repeatable-read, read-only source transaction; no customer-data dump or
credentials were written to disk. Destination constraints remained enabled.

Before commit and again through a new read-only connection after commit, all
table counts and full-row SHA256 checksums matched the source snapshot. All
13 migration hashes/timestamps matched the checkout; the prior 12 journal
records were preserved. Existing owners/grants, role attributes, and default
grants were unchanged during reconciliation, and schema/security/journal
readbacks were unchanged during the data copy. New objects inherit the existing
app grant policy. No GCP IAM policy changes were made.

Sequence next allocations were preserved and checked above imported IDs:
`billboard_locations_id_seq` **31,511**, `openai_logs_id_seq` **86**,
`nutshell_webhook_inbox_id_seq` **126**, and `nutshell_leads_id_seq` **1,572**.
The last sequence retains the source's historical allocation despite the empty
individual-lead table. Transactional `ALTER SEQUENCE RESTART` preserves next
allocation, representing it as `last_value=next, is_called=false` rather than
copying the source's `is_called=true` encoding. No sequence was advanced merely
to test it.

Neon remained writable by its existing users: the inbox grew from 116 rows at
initial discovery to 121 before the snapshot. No row-count drift was observed
at postflight (22:10:44 UTC). This is a point-in-time copy, not ongoing replication.
No discrepancies against the imported snapshot were found. Neon source data,
production, application statistics logic, and connection configuration were not
modified. The proxy was stopped afterward.

Validation: seven database integration tests, 364 unit tests, 15 Playwright
tests, typecheck, targeted ESLint, and Drizzle metadata checks passed. The browser
fixture includes the new nullable column so existing settings writes remain
covered. The new regression checks retained notification/settings/summary data
after a migration rerun and confirms no individual leads were invented.

**Publish migration 0012 before another main CI verification:** the dev journal
now contains it, so an older checkout correctly rejects the unknown history.
Do not edit prior migration hashes or rerun the data copy into this populated DB.

## Initial empty-schema rollout (historical)

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

## GitHub Actions dev migrations (disabled until provisioned)

The CI workflow rehearses the chain in disposable PostgreSQL 18 with pgvector
0.8.5 on pull requests and pushes to `main`, without cloud credentials. Only a
successful `main` push can reach the shared-dev migration job, after quality,
browser, security, and migration checks pass. No production migration job exists;
production remains on Neon. App runtime routing is unchanged by this workflow.

The job is additionally gated by the **repository** Actions variable
`DEV_MIGRATIONS_ENABLED=true`. Leave it unset until the following administrator
setup is approved and verified. Do not put this switch in an environment: job
conditions are evaluated before environment variables become available.

1. Create GitHub Environment `dev` in `john22n/billboard-source-ai`, restrict its
   deployment branches to `main`, and configure required reviewers where the
   repository plan supports them. Protect `main` and review workflow/migration
   changes before merging. Anyone able to change trusted workflow code can use
   the migration identity; the runtime app must never receive it.
2. Inspect existing GCP resources before creating anything. Use a **separate**
   WIF pool `github-billboard-dev` and provider `github-actions` in project
   `789243463553`, not the existing Amp pool/provider. Issuer:
   `https://token.actions.githubusercontent.com`. Use the provider's default
   audience. Map `google.subject=assertion.sub` and
   `attribute.repository_id=assertion.repository_id`.
3. Require this exact provider attribute condition (repository and owner IDs
   were read from GitHub, not inferred from their names):

   ```text
   assertion.repository_id == '1016437788' &&
   assertion.repository_owner_id == '15069297' &&
   assertion.sub == 'repo:john22n/billboard-source-ai:environment:dev' &&
   assertion.ref == 'refs/heads/main' &&
   assertion.event_name == 'push' &&
   assertion.workflow_ref == 'john22n/billboard-source-ai/.github/workflows/ci-cd.yml@refs/heads/main'
   ```

4. On **only** service account
   `amp-billboard-db@cs-poc-l0o7at4xalxqxcyxekiay2j.iam.gserviceaccount.com`, grant
   `roles/iam.workloadIdentityUser` to
   `principalSet://iam.googleapis.com/projects/789243463553/locations/global/workloadIdentityPools/github-billboard-dev/attribute.repository_id/1016437788`.
   Preserve existing Amp bindings and the service account's exact dev-instance
   Cloud SQL conditions. Do not grant Cloud SQL Admin or project-wide access.
   Reusing the dev migration owner avoids transferring existing object ownership
   and keeps owner-specific default privileges effective. This is an additional
   trusted caller of the migration account, not an app identity.
5. Read back provider condition, account policy, and dev-only Cloud SQL role
   bindings. Confirm the instance/database still match this runbook. Keep the
   repository switch `false` through verification. Enable it only after a
   successful GitHub verification run and separate rollout approval. Enabling
   it does not run a migration immediately; the next successful push to `main`
   (or rerun of a qualifying push) can do so.

### Read-only identity verification

The `verify-dev` job runs after all four CI checks on a `main` push, independently
of `DEV_MIGRATIONS_ENABLED`. Pull requests cannot invoke it. It uses the same
GitHub WIF provider, migration identity, and exact dev proxy target as the rollout
job, without calling the migrator. It connects with read-only transactions enabled
and checks the database name, session/current user, read-only state, vector in
`public`, and every applied journal hash/timestamp against this checkout. It
reports the pending count without applying anything. A missing/empty journal or
incompatible history fails verification; pending migrations are allowed.

The checks use a repeatable-read, read-only transaction and finish with rollback.
They do not inspect application records, grant privileges, seed data, or prove
schema parity/DDL privileges. The underlying migration identity still has write
privileges; read-only mode protects this job, not arbitrary trusted workflow code.
`migrate-dev` additionally requires successful verification and the explicit
enable switch. Publishing/running the workflow needs separate approval; no
`workflow_dispatch` trigger or broader WIF condition was added.

The exact embedded verification program passed against Cloud SQL dev via the
existing **Amp** identity path: vector 0.8.5, 12 applied migrations, zero pending.
The proxy was stopped afterward. This validates the SQL checks, not GitHub's OIDC
exchange, which must still pass in GitHub before enabling migrations.

No service-account key or database password is stored in GitHub. The auth action
creates short-lived external-account credentials immediately before the proxy
starts and removes them at job cleanup. The proxy binary is version- and
SHA256-pinned, listens only on loopback, checks readiness, and is stopped on
success or failure. The existing runner ignores `DATABASE_URL` and validates the
database, IAM username, extension, app privileges, and migration history.

Push workflows and the migration job do not cancel in-progress runs; the shared
job concurrency group and database advisory lock prevent overlapping migrations.
GitHub concurrency can replace pending runs, so not every intermediate commit is
guaranteed a rollout; the retained checkout applies its complete pending chain.
Do not edit already-applied SQL. A stale checkout with incompatible history fails
closed. To disable future rollouts, unset the repository switch; this does not
cancel an already-running migration or undo schema changes.

Do not use workflow reruns as blind retries: inspect history and any failed grant
transaction first. This pipeline does not deploy or order Vercel deployments;
schema changes must remain compatible with independently deployed app versions.
GitHub OIDC exchange and runner package installation still require verification
in the first approved CI run; local rehearsal cannot prove either platform path.
