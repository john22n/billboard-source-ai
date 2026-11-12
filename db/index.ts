import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import * as schema from './schema'
import { serverConfig } from '@/lib/config'
import { CloudSqlPool } from './cloud-sql'

function createDatabase() {
  const cloudSql = serverConfig.database.cloudSql
  if (cloudSql) {
    return drizzlePostgres({
      client: new CloudSqlPool(cloudSql),
      schema,
      casing: 'snake_case',
    })
  }

  const databaseUrl = serverConfig.database.url.replace(
    /([?&]sslmode=)(prefer|require|verify-ca)(?=&|$)/i,
    '$1verify-full',
  )

  return serverConfig.database.useNeon
    ? drizzleNeon({
        client: neon(databaseUrl),
        schema,
        casing: 'snake_case',
      })
    : drizzlePostgres({
        client: new Pool({
          connectionString: databaseUrl,
        }),
        schema,
        casing: 'snake_case',
      })
}

export const db = createDatabase()
