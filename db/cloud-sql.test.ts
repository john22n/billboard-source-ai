import { expect, it, vi } from 'vitest'
import { CloudSqlPool } from './cloud-sql'

vi.mock('@vercel/oidc', () => ({
  getVercelOidcToken: async () => {
    throw new Error('OIDC token unavailable')
  },
}))

it('rejects queries cleanly when federation fails, including retries and shutdown', async () => {
  const pool = new CloudSqlPool({
    instanceConnectionName: 'project:us-central1:instance',
    database: 'database',
    user: 'user',
    password: 'test-password',
    federation: {
      audience:
        '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/pool/providers/provider',
      serviceAccountEmail: 'test@project.iam.gserviceaccount.com',
    },
  })
  try {
    await expect(pool.query('SELECT 1')).rejects.toThrow(
      'OIDC token unavailable',
    )
    await expect(pool.query('SELECT 1')).rejects.toThrow(
      'OIDC token unavailable',
    )
  } finally {
    await pool.end()
  }
})
