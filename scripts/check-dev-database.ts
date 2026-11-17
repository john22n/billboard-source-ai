import { sql } from 'drizzle-orm'
import { closeDb, getDb } from '../db'
import { serverConfig } from '../lib/config'

// Run only with separately approved app-identity dev configuration. No schema or
// application data is read or written, and errors never print credentials.
try {
  const driver = serverConfig.database.driver
  if (driver === 'neon' || serverConfig.runtime.isProductionDeployment) {
    throw new Error('Dev diagnostic cannot target production')
  }
  if (driver === 'postgres') {
    const url = new URL(serverConfig.database.url)
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.searchParams.has('host') ||
      url.searchParams.has('hostaddr')
    ) {
      throw new Error(
        'Local dev diagnostic requires a loopback app-identity proxy',
      )
    }
  }
  const db = await getDb()
  await db.execute(sql`SELECT 1`)
  console.log(JSON.stringify({ connected: true }))
} catch {
  console.error('Dev database check failed')
  process.exitCode = 1
} finally {
  await closeDb().catch(() => {
    console.error('Dev database cleanup failed')
    process.exitCode = 1
  })
}
