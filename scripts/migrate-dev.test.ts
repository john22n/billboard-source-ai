import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import { afterAll, beforeAll, expect, test } from 'vitest'
import * as schema from '../db/schema'

// Opt in because this suite starts disposable PostgreSQL 18 with pgvector.
const enabled = process.env.BILLBOARD_MIGRATION_TEST === '1'
const owner = 'amp-billboard-db@cs-poc-l0o7at4xalxqxcyxekiay2j.iam'
let directory: string
let admin: Client
let migrationClient: Client
let expectedSchema: unknown[]
let started = false

const catalog = `
  SELECT c.relname AS name,
    (SELECT jsonb_agg(jsonb_build_object('name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attname)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
    (SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY pg_get_constraintdef(oid))
     FROM pg_constraint WHERE conrelid=c.oid) AS constraints,
    (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid::regclass::text)
     FROM pg_index WHERE indrelid=c.oid) AS indexes
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`

beforeAll(async () => {
  if (!enabled) return
  directory = mkdtempSync(join(tmpdir(), 'billboard-migrations-'))
  execFileSync(
    'initdb',
    ['-D', directory, '-U', 'postgres', '-A', 'trust', '--no-locale'],
    { stdio: 'pipe' },
  )
  execFileSync(
    'pg_ctl',
    [
      '-D',
      directory,
      '-l',
      join(directory, 'postgres.log'),
      '-o',
      `-h '' -k ${directory}`,
      '-w',
      'start',
    ],
    { stdio: 'pipe' },
  )
  started = true
  admin = new Client({
    host: directory,
    user: 'postgres',
    database: 'postgres',
  })
  await admin.connect()
  expect(
    Number(
      (await admin.query('SHOW server_version_num')).rows[0].server_version_num,
    ),
  ).toBeGreaterThanOrEqual(180000)
  await admin.query(
    `CREATE ROLE "${owner}" LOGIN; CREATE ROLE billboard_app_dev LOGIN`,
  )
  await admin.query('CREATE DATABASE billboard_dev')
  await admin.query('CREATE DATABASE expected_schema')
  const expected = new Client({
    host: directory,
    user: 'postgres',
    database: 'expected_schema',
  })
  await expected.connect()
  try {
    await expected.query('CREATE EXTENSION vector')
    // Independent source of truth: current application schema, not migration SQL.
    for (const sql of await generateMigration(
      generateDrizzleJson({}),
      generateDrizzleJson(schema),
    )) {
      await expected.query(sql)
    }
    expectedSchema = (await expected.query(catalog)).rows
  } finally {
    await expected.end()
  }
  await admin.end()
  admin = new Client({
    host: directory,
    user: 'postgres',
    database: 'billboard_dev',
  })
  await admin.connect()
  await admin.query(
    `CREATE EXTENSION vector; GRANT CONNECT, CREATE ON DATABASE billboard_dev TO "${owner}"; GRANT USAGE, CREATE ON SCHEMA public TO "${owner}"`,
  )
  migrationClient = new Client({
    host: directory,
    user: owner,
    database: 'billboard_dev',
  })
  await migrationClient.connect()
}, 30000)

afterAll(async () => {
  await migrationClient?.end()
  await admin?.end()
  if (started)
    execFileSync('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop'], {
      stdio: 'pipe',
    })
  if (directory) rmSync(directory, { recursive: true, force: true })
})

// Dynamic import lets the test-first commit typecheck before the runner exists.
async function runMigrations(client: Client) {
  const { migrateDev } = await import(
    pathToFileURL(join(process.cwd(), 'scripts/migrate-dev.ts')).href
  )
  await migrateDev(client)
}

test.skipIf(!enabled).each([
  { database: 'postgres', user: owner },
  { database: 'billboard_dev', user: 'postgres' },
])(
  'rejects target $database / $user before creating migration state',
  async ({ database, user }) => {
    const client = new Client({ host: directory, database, user })
    await client.connect()
    try {
      await expect(runMigrations(client)).rejects.toThrow(
        'Expected billboard_dev and its IAM migration identity',
      )
      expect(
        (await client.query("SELECT to_regnamespace('drizzle') AS journal"))
          .rows[0].journal,
      ).toBeNull()
    } finally {
      await client.end()
    }
  },
)

test.skipIf(!enabled)(
  'rejects a missing vector extension and untracked tables before writing',
  async () => {
    await admin.query('DROP EXTENSION vector')
    try {
      await expect(runMigrations(migrationClient)).rejects.toThrow(
        'Install vector in public',
      )
      expect(
        (
          await migrationClient.query(
            "SELECT to_regnamespace('drizzle') AS journal",
          )
        ).rows[0].journal,
      ).toBeNull()
    } finally {
      await admin.query('CREATE EXTENSION vector')
    }
    await migrationClient.query('CREATE TABLE untracked (id integer)')
    try {
      await expect(runMigrations(migrationClient)).rejects.toThrow(
        'Untracked database objects',
      )
      expect(
        (
          await migrationClient.query(
            "SELECT to_regnamespace('drizzle') AS journal",
          )
        ).rows[0].journal,
      ).toBeNull()
    } finally {
      await migrationClient.query('DROP TABLE untracked')
    }
  },
)

test.skipIf(!enabled)(
  'the complete migration history produces the application schema and can be rerun',
  async () => {
    const db = drizzle(migrationClient)
    await migrate(db, { migrationsFolder: './drizzle' })
    expect((await migrationClient.query(catalog)).rows).toEqual(expectedSchema)
    const before = await migrationClient.query(
      'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
    )
    await migrate(db, { migrationsFolder: './drizzle' })
    expect(
      (
        await migrationClient.query(
          'SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows,
    ).toEqual(before.rows)
  },
  30000,
)

test.skipIf(!enabled)(
  'app can use existing and future objects but cannot perform DDL or edit migration history',
  async () => {
    await runMigrations(migrationClient)
    const app = new Client({
      host: directory,
      user: 'billboard_app_dev',
      database: 'billboard_dev',
    })
    await app.connect()
    try {
      await app.query(
        `INSERT INTO "User" (id,email) VALUES ('permissions-test','test@example.invalid')`,
      )
      const inserted = await app.query(
        `INSERT INTO openai_logs (user_id,model,prompt_tokens,completion_tokens,total_tokens,cost) VALUES ('permissions-test','test',2,3,5,0) RETURNING id`,
      )
      expect(inserted.rows[0].id).toBe(1)
      await app.query(
        `UPDATE "User" SET calls_accepted=7 WHERE id='permissions-test'`,
      )
      expect(
        (
          await app.query(
            `SELECT calls_accepted FROM "User" WHERE id='permissions-test'`,
          )
        ).rows[0].calls_accepted,
      ).toBe(7)
      await expect(
        app.query('ALTER TABLE "User" ADD COLUMN forbidden integer'),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        app.query('CREATE TABLE forbidden (id integer)'),
      ).rejects.toMatchObject({ code: '42501' })
      await expect(
        app.query('DELETE FROM drizzle.__drizzle_migrations'),
      ).rejects.toMatchObject({ code: '42501' })
      await migrationClient.query(
        'CREATE TABLE public.future_permissions (id serial PRIMARY KEY, value text)',
      )
      await migrationClient.query(
        'ALTER TABLE public.future_permissions ADD COLUMN migrated boolean DEFAULT true',
      )
      expect(
        (
          await app.query(
            "INSERT INTO future_permissions (value) VALUES ('future') RETURNING id,migrated",
          )
        ).rows,
      ).toEqual([{ id: 1, migrated: true }])
      await app.query(`DELETE FROM "User" WHERE id='permissions-test'`)
      expect(
        (await app.query('SELECT count(*)::int AS count FROM openai_logs'))
          .rows[0].count,
      ).toBe(0)
      const journal = (
        await migrationClient.query(
          'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
        )
      ).rows
      await runMigrations(migrationClient)
      expect(
        (
          await migrationClient.query(
            'SELECT * FROM drizzle.__drizzle_migrations ORDER BY id',
          )
        ).rows,
      ).toEqual(journal)
    } finally {
      await app.end()
      await migrationClient.query(
        'DROP TABLE IF EXISTS public.future_permissions',
      )
    }
  },
)

test.skipIf(!enabled)(
  'rejects a modified migration journal rather than skipping unknown history',
  async () => {
    const original = (
      await migrationClient.query(
        'SELECT id,hash FROM drizzle.__drizzle_migrations ORDER BY id LIMIT 1',
      )
    ).rows[0]
    await migrationClient.query(
      'UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',
      ['tampered', original.id],
    )
    try {
      await expect(runMigrations(migrationClient)).rejects.toThrow(
        'Migration history does not match',
      )
    } finally {
      await migrationClient.query(
        'UPDATE drizzle.__drizzle_migrations SET hash=$1 WHERE id=$2',
        [original.hash, original.id],
      )
    }
  },
)
