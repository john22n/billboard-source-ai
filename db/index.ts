import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import * as schema from './schema'
import { serverConfig } from '@/lib/config'
import { createCloudSqlPool } from './cloud-sql'

async function createDatabase() {
  const cloudSql = serverConfig.database.cloudSql
  if (cloudSql) {
    const { pool, close } = await createCloudSqlPool(cloudSql)
    return {
      db: drizzlePostgres({ client: pool, schema, casing: 'snake_case' }),
      close,
    }
  }

  const databaseUrl = serverConfig.database.url.replace(
    /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/i,
    '$1verify-full',
  )

  if (serverConfig.database.driver === 'neon') {
    return {
      db: drizzleNeon({
        client: neon(databaseUrl),
        schema,
        casing: 'snake_case',
      }),
      close: async () => {},
    }
  }
  const pool = new Pool({ connectionString: databaseUrl })
  return {
    db: drizzlePostgres({ client: pool, schema, casing: 'snake_case' }),
    close: () => pool.end(),
  }
}

let current: ReturnType<typeof createDatabase> | undefined
const shutdowns = new Set<Promise<void>>()

/** Initialize inside the request, sharing one pool across concurrent callers. */
export function getDb() {
  if (!current) {
    const pending = createDatabase().catch((error) => {
      if (process.env.VERCEL_TARGET_ENV === 'staging') {
        console.error('[DEBUG-staging-db] initialization failed', {
          issuerMismatch: /issuer.*(match|expected)/i.test(
            String(error?.message),
          ),
          issuerConnectionFailed: /connecting.*issuer/i.test(
            String(error?.message),
          ),
          rejectedCondition: /attribute condition/i.test(
            String(error?.message),
          ),
        })
      }
      if (current === pending) current = undefined
      throw error
    })
    current = pending
  }
  const pending = current
  return pending.then(({ db }) => {
    if (current !== pending) {
      throw new Error('Database initialization was closed')
    }
    return db
  })
}

/** Operator/test shutdown; the next request can initialize a fresh pool. */
export async function closeDb() {
  const pending = current
  current = undefined
  const shutdown = pending?.then(({ close }) => close())
  if (shutdown) shutdowns.add(shutdown)
  try {
    const results = await Promise.allSettled(shutdowns)
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  } finally {
    if (shutdown) shutdowns.delete(shutdown)
  }
}
