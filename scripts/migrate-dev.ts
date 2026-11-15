import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'

const database = 'billboard_dev'
const user = 'amp-billboard-db@cs-poc-l0o7at4xalxqxcyxekiay2j.iam'
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
// Stable database-local lock namespace and rollout key; all dev runners must share these.
const devMigrationLock = [181818, 15432]

async function assertMigrationHistory(client: Client) {
  const migrations = readMigrationFiles({ migrationsFolder })
  const {
    rows: [state],
  } = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS journal",
  )
  const applied = state.journal
    ? (
        await client.query(
          'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows
    : []
  if (
    applied.some(
      (entry, index) =>
        entry.hash !== migrations[index]?.hash ||
        Number(entry.created_at) !== migrations[index]?.folderMillis,
    )
  ) {
    throw new Error(
      'Migration history does not match this checkout; refusing changes',
    )
  }
  if (applied.length === 0) {
    const existing =
      await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LIMIT 1`)
    if (existing.rowCount)
      throw new Error(
        'Untracked database objects; reconcile them separately before migrating',
      )
  }
}

/** Only call with a dedicated, idle connection through the dev Auth Proxy. */
export async function migrateDev(client: Client) {
  const {
    rows: [identity],
  } = await client.query(
    'SELECT current_database() AS database, current_user AS username, session_user AS login',
  )
  if (
    identity.database !== database ||
    identity.username !== user ||
    identity.login !== user
  ) {
    throw new Error(
      'Expected billboard_dev and its IAM migration identity; refusing changes',
    )
  }
  const extension = await client.query(`SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector' AND n.nspname='public'`)
  if (!extension.rowCount)
    throw new Error(
      'Install vector in public using an approved administrator session first',
    )
  const app =
    await client.query(`SELECT 1 FROM pg_roles WHERE rolname='billboard_app_dev'
    AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
    AND has_database_privilege(oid, current_database(), 'CONNECT')
    AND has_schema_privilege(oid, 'public', 'USAGE')
    AND NOT has_schema_privilege(oid, 'public', 'CREATE')
    AND NOT pg_has_role(oid, current_user, 'MEMBER')`)
  if (!app.rowCount)
    throw new Error(
      'billboard_app_dev must have CONNECT/USAGE without DDL or migration-role membership',
    )

  const {
    rows: [lock],
  } = await client.query(
    'SELECT pg_try_advisory_lock($1, $2) AS acquired',
    devMigrationLock,
  )
  if (!lock.acquired) throw new Error('Another dev migration is running')
  try {
    await assertMigrationHistory(client)
    await client.query('SET search_path TO public')
    // Drizzle applies all pending migrations in a transaction; do not replace it with push.
    await migrate(drizzle(client), { migrationsFolder })
    // Separate, repeatable grant transaction. If it fails, rerun after correcting the cause;
    // the verified journal prevents replaying already-applied migrations.
    await client.query('BEGIN')
    try {
      await client.query(`
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO billboard_app_dev;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO billboard_app_dev;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO billboard_app_dev;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO billboard_app_dev;
      `)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1, $2)', devMigrationLock)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.slice(2).join(' ') !== '--apply-dev') {
    throw new Error(
      'No changes made. After explicit dev rollout approval, run: pnpm db:migrate:dev --apply-dev',
    )
  }
  // Never load dotenv or DATABASE_URL: that may select Neon or production.
  const client = new Client({
    host: '127.0.0.1',
    port: 15432,
    database,
    user,
    password: '',
    ssl: false,
    connectionTimeoutMillis: 30000,
  })
  try {
    await client.connect()
    await migrateDev(client)
    console.log('Dev migrations and app grants completed')
  } finally {
    await client.end()
  }
}
