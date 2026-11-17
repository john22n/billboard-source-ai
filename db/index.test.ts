import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { IdentityPoolClient } from 'google-auth-library'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import { sql } from 'drizzle-orm'
import { user } from './schema'

vi.mock('server-only', () => ({}))

const external = vi.hoisted(() => ({
  getOptions: vi.fn(),
  close: vi.fn(),
  token: vi.fn(),
  verify: vi.fn(),
  authClients: [] as IdentityPoolClient[],
}))

vi.mock('@google-cloud/cloud-sql-connector', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@google-cloud/cloud-sql-connector')>()
  return {
    ...original,
    Connector: class {
      constructor({ auth }: { auth: IdentityPoolClient }) {
        external.authClients.push(auth)
      }
      getOptions = external.getOptions
      close = external.close
    },
  }
})
vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: external.token,
  verifyVercelOidcToken: external.verify,
}))

const entryPath = './index'
const claims = {
  owner_id: 'team_dev',
  project_id: 'prj_dev',
  environment: 'dev',
  custom_environment_id: 'env_dev',
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  external.authClients.length = 0
  for (const [key, value] of Object.entries({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_TARGET_ENV: 'dev',
    DATABASE_DRIVER: 'cloudsql',
    CLOUD_SQL_INSTANCE_CONNECTION_NAME: 'project:us-central1:instance',
    CLOUD_SQL_DATABASE: 'billboard_dev',
    CLOUD_SQL_USER: 'app@project.iam',
    CLOUD_SQL_VERCEL_OWNER_ID: 'team_dev',
    CLOUD_SQL_VERCEL_PROJECT_ID: 'prj_dev',
    CLOUD_SQL_VERCEL_ENVIRONMENT_ID: 'env_dev',
    GCP_PROJECT_NUMBER: '123456789012',
    GCP_WORKLOAD_IDENTITY_POOL_ID: 'pool',
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'provider',
    GCP_SERVICE_ACCOUNT_EMAIL: 'app@project.iam.gserviceaccount.com',
  }))
    vi.stubEnv(key, value)
  external.getOptions.mockResolvedValue({})
  external.verify.mockResolvedValue({ payload: claims })
})

afterEach(async () => {
  const database = await import(entryPath)
  await database.closeDb?.()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('initializes only on demand, shares concurrent first requests, and can close and reopen', async () => {
  const { getDb, closeDb } = await import(entryPath)
  expect(external.authClients).toHaveLength(0)
  let finish: (options: object) => void = () => {}
  external.getOptions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = getDb()
  const second = getDb()
  finish({})
  const databases = await Promise.all([first, second])
  expect(databases[0]).toBe(databases[1])
  expect(await getDb()).toBe(databases[0])
  expect(external.authClients).toHaveLength(1)
  expect(external.getOptions).toHaveBeenCalledWith({
    instanceConnectionName: 'project:us-central1:instance',
    ipType: 'PUBLIC',
    authType: 'IAM',
  })
  await closeDb()
  expect(external.close).toHaveBeenCalledTimes(1)
  expect(await getDb()).not.toBe(databases[0])
})

it('lets concurrent callers observe initialization failure and recovers on a later request', async () => {
  const { getDb } = await import(entryPath)
  external.getOptions.mockRejectedValueOnce(
    new Error('transient federation failure'),
  )
  const results = await Promise.allSettled([getDb(), getDb()])
  expect(results.map((result) => result.status)).toEqual([
    'rejected',
    'rejected',
  ])
  const recovered = await getDb()
  expect(await getDb()).toBe(recovered)
  expect(external.authClients).toHaveLength(2)
})

it('fetches and verifies a fresh subject token on every credential refresh', async () => {
  const { getDb } = await import(entryPath)
  await getDb()
  expect(external.authClients[0].scopes).toContain(
    'https://www.googleapis.com/auth/sqlservice.login',
  )
  external.token
    .mockResolvedValueOnce('first-token')
    .mockResolvedValueOnce('rotated-token')
  expect(await external.authClients[0].retrieveSubjectToken()).toBe(
    'first-token',
  )
  expect(await external.authClients[0].retrieveSubjectToken()).toBe(
    'rotated-token',
  )
  expect(external.token).toHaveBeenCalledWith({
    audience:
      'https://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/pool/providers/provider',
  })
  expect(external.verify.mock.calls.map(([token]) => token)).toEqual([
    'first-token',
    'rotated-token',
  ])
})

it.each([
  { owner_id: 'other-owner' },
  { project_id: 'other-project' },
  { environment: 'production' },
  { custom_environment_id: 'other-environment' },
  { custom_environment_id: undefined },
])(
  'denies a token outside the configured dev identity: %j',
  async (override) => {
    const { getDb } = await import(entryPath)
    await getDb()
    external.token.mockResolvedValue('untrusted-token')
    external.verify.mockResolvedValue({ payload: { ...claims, ...override } })
    await expect(
      external.authClients[0].retrieveSubjectToken(),
    ).rejects.toThrow('Cloud SQL dev identity mismatch')
  },
)

it('does not retire a database handle still held by a caller after a long idle period', async () => {
  const { getDb } = await import(entryPath)
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const before = await getDb()
  now += 2 * 60 * 60_000
  expect(await getDb()).toBe(before)
  expect(external.close).not.toHaveBeenCalled()
})

it('rejects an initialization closed during shutdown without poisoning a new generation', async () => {
  const { getDb, closeDb } = await import(entryPath)
  let finish: (options: object) => void = () => {}
  external.getOptions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const first = getDb()
  const rejected = expect(first).rejects.toThrow(
    'Database initialization was closed',
  )
  const shutdown = closeDb()
  const successor = getDb()
  finish({})
  await Promise.all([rejected, shutdown])
  expect(await getDb()).toBe(await successor)
  expect(external.close).toHaveBeenCalledTimes(1)
})

it.runIf(process.env.BILLBOARD_DB_TEST === '1')(
  'uses real PostgreSQL as a non-owner for Drizzle reads, rate limits, transactions, vectors, and inherited grants',
  async () => {
    const scratch = resolve('.amp/in/orb-backup')
    mkdirSync(scratch, { recursive: true })
    const directory = mkdtempSync(resolve(scratch, 'runtime-db-'))
    const port = 54339
    let started = false
    const { getDb, closeDb } = await import(entryPath)
    let admin: Pool | undefined
    try {
      execFileSync(
        'initdb',
        ['-D', directory, '-U', 'schema_owner', '-A', 'trust', '--no-locale'],
        { stdio: 'pipe' },
      )
      execFileSync(
        'pg_ctl',
        [
          '-D',
          directory,
          '-l',
          resolve(directory, 'server.log'),
          '-o',
          `-h 127.0.0.1 -p ${port} -k ${directory}`,
          '-w',
          'start',
        ],
        { stdio: 'pipe' },
      )
      started = true
      const bootstrap = new Pool({
        host: '127.0.0.1',
        port,
        database: 'postgres',
        user: 'schema_owner',
      })
      try {
        await bootstrap.query('CREATE DATABASE billboard_dev')
        await bootstrap.query('CREATE ROLE billboard_app_dev NOLOGIN')
        await bootstrap.query(
          'CREATE ROLE "app@project.iam" LOGIN INHERIT IN ROLE billboard_app_dev',
        )
      } finally {
        await bootstrap.end()
      }
      admin = new Pool({
        host: '127.0.0.1',
        port,
        database: 'billboard_dev',
        user: 'schema_owner',
      })
      await admin.query(`
        CREATE EXTENSION vector;
        CREATE TABLE "User" (id text PRIMARY KEY, email text, twilio_phone_number text);
        INSERT INTO "User" VALUES ('caller-1', 'sales@example.test', '+15551234567');
        CREATE TABLE rate_limit_buckets (key varchar(160) PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
        CREATE TABLE parents (id serial PRIMARY KEY, name text);
        CREATE TABLE children (id serial PRIMARY KEY, parent_id integer REFERENCES parents(id));
        GRANT USAGE ON SCHEMA public TO billboard_app_dev;
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO billboard_app_dev;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO billboard_app_dev;
        ALTER DEFAULT PRIVILEGES FOR ROLE schema_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO billboard_app_dev;
        ALTER DEFAULT PRIVILEGES FOR ROLE schema_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO billboard_app_dev;
      `)
      // Only Google's transport is replaced; pg, Drizzle and SQL grants are real.
      external.getOptions.mockResolvedValue({ host: '127.0.0.1', port })
      const databases = await Promise.all([getDb(), getDb(), getDb()])
      expect(databases[0]).toBe(databases[2])
      const db = databases[0]
      expect(
        await db
          .select({
            email: user.email,
            twilioPhoneNumber: user.twilioPhoneNumber,
          })
          .from(user),
      ).toEqual([
        { email: 'sales@example.test', twilioPhoneNumber: '+15551234567' },
      ])
      const raw = await db.execute(
        sql`SELECT current_user AS identity, 17::int AS answer`,
      )
      expect(raw.rows).toEqual([{ identity: 'app@project.iam', answer: 17 }])
      const { rateLimit } = await import('../lib/rate-limit')
      expect((await rateLimit('test', 'caller', 1, 60)).allowed).toBe(true)
      expect((await rateLimit('test', 'caller', 1, 60)).allowed).toBe(false)
      await db.transaction(async (transaction: typeof db) => {
        await transaction.execute(
          sql`INSERT INTO parents (name) VALUES ('committed')`,
        )
      })
      await expect(
        db.transaction(async (transaction: typeof db) => {
          await transaction.execute(
            sql`INSERT INTO parents (name) VALUES ('rolled back')`,
          )
          throw new Error('rollback requested')
        }),
      ).rejects.toThrow('rollback requested')
      expect(
        (await db.execute(sql`SELECT name FROM parents ORDER BY id`)).rows,
      ).toEqual([{ name: 'committed' }])
      await expect(
        db.execute(sql`INSERT INTO children (parent_id) VALUES (999)`),
      ).rejects.toThrow()
      const distance = await db.execute(
        sql`SELECT '[1,2,3]'::vector <-> '[2,4,6]'::vector AS distance`,
      )
      expect(Number(distance.rows[0].distance)).toBeCloseTo(Math.sqrt(14))
      const smokeEnv = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        DATABASE_DRIVER: 'postgres',
        DATABASE_URL: `postgresql://app%40project.iam@127.0.0.1:${port}/billboard_dev`,
      } satisfies NodeJS.ProcessEnv
      const smoke = execFileSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/check-dev-database.ts'],
        {
          env: smokeEnv,
          encoding: 'utf8',
        },
      )
      expect(JSON.parse(smoke)).toEqual({ connected: true })
      // Even a reachable loopback override must be rejected, so the failure
      // cannot be explained by a remote host being unreachable.
      expect(() =>
        execFileSync(
          process.execPath,
          ['--import', 'tsx', 'scripts/check-dev-database.ts'],
          {
            env: {
              ...smokeEnv,
              DATABASE_URL: `${smokeEnv.DATABASE_URL}?host=127.0.0.1`,
            },
            stdio: 'pipe',
          },
        ),
      ).toThrow('Dev database check failed')
      await expect(
        db.execute(sql`CREATE TABLE forbidden (id int)`),
      ).rejects.toThrow()
      await expect(
        db.execute(sql`ALTER TABLE parents ADD COLUMN forbidden int`),
      ).rejects.toThrow()
      await admin.query(
        'CREATE TABLE future_records (id serial PRIMARY KEY, value text)',
      )
      expect(
        (
          await db.execute(
            sql`INSERT INTO future_records (value) VALUES ('inherited') RETURNING id, value`,
          )
        ).rows,
      ).toEqual([{ id: 1, value: 'inherited' }])
      const held = await db.$client.connect()
      const shutdown = closeDb()
      let secondShutdownFinished = false
      const secondShutdown = closeDb().then(() => {
        secondShutdownFinished = true
      })
      try {
        await new Promise((resolve) => setImmediate(resolve))
        expect(secondShutdownFinished).toBe(false)
        expect((await held.query('SELECT 23::int AS answer')).rows).toEqual([
          { answer: 23 },
        ])
      } finally {
        held.release()
      }
      await Promise.all([shutdown, secondShutdown])
      expect(external.close).toHaveBeenCalledTimes(1)
      const reopened = await getDb()
      expect(
        (
          await reopened.execute(
            sql`SELECT COUNT(*)::int AS count FROM parents`,
          )
        ).rows,
      ).toEqual([{ count: 1 }])
      await closeDb()
      let failInitialization: (error: Error) => void = () => {}
      external.getOptions.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            failInitialization = reject
          }),
      )
      const failedInitialization =
        expect(getDb()).rejects.toThrow('failed refresh')
      const failedShutdown = expect(closeDb()).rejects.toThrow('failed refresh')
      const successor = await getDb()
      const successorClient = await successor.$client.connect()
      let successorShutdownFinished = false
      const successorShutdown = closeDb().then(
        () => {
          successorShutdownFinished = true
        },
        (error: unknown) => {
          successorShutdownFinished = true
          return error
        },
      )
      failInitialization(new Error('failed refresh'))
      await failedInitialization
      await new Promise((resolve) => setImmediate(resolve))
      let joiningShutdownFinished = false
      const joiningShutdown = closeDb().then(() => {
        joiningShutdownFinished = true
      })
      let finishedWhileHeld: boolean[]
      try {
        await new Promise((resolve) => setImmediate(resolve))
        finishedWhileHeld = [successorShutdownFinished, joiningShutdownFinished]
      } finally {
        successorClient.release()
      }
      await failedShutdown
      expect(await successorShutdown).toEqual(new Error('failed refresh'))
      await joiningShutdown
      expect(finishedWhileHeld).toEqual([false, false])
    } finally {
      await closeDb()
      await admin?.end()
      if (started)
        execFileSync('pg_ctl', ['-D', directory, '-m', 'fast', '-w', 'stop'], {
          stdio: 'pipe',
        })
      rmSync(directory, { recursive: true, force: true })
    }
  },
  60_000,
)
