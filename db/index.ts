import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import * as schema from './schema'
import { serverConfig } from '@/lib/config'

const databaseUrl = serverConfig.database.url

export const db = serverConfig.database.useNeon
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
