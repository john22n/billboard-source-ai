import {
  AuthTypes,
  Connector,
  IpAddressTypes,
} from '@google-cloud/cloud-sql-connector'
import { getVercelOidcToken, verifyVercelOidcToken } from '@vercel/oidc'
import { attachDatabasePool } from '@vercel/functions'
import { IdentityPoolClient } from 'google-auth-library'
import { Pool } from 'pg'
import type { ServerConfig } from '@/lib/config'

type CloudSqlConfig = NonNullable<ServerConfig['database']['cloudSql']>

export async function createCloudSqlPool(config: CloudSqlConfig) {
  const federation = config.federation
  const audience = `https:${federation.audience}`
  const auth = new IdentityPoolClient({
    type: 'external_account',
    audience: federation.audience,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(federation.serviceAccountEmail)}:generateAccessToken`,
    scopes: [
      'https://www.googleapis.com/auth/sqlservice.admin',
      'https://www.googleapis.com/auth/sqlservice.login',
    ],
    subject_token_supplier: {
      async getSubjectToken() {
        const token = await getVercelOidcToken({ audience })
        const { payload } = await verifyVercelOidcToken(token, {
          audience,
          projectId: federation.projectId,
          ownerId: federation.ownerId,
          environment: 'staging',
        })
        if (
          payload.owner_id !== federation.ownerId ||
          payload.project_id !== federation.projectId ||
          payload.environment !== 'staging' ||
          payload.custom_environment_id !== federation.environmentId
        ) {
          throw new Error('Cloud SQL staging identity mismatch')
        }
        return token
      },
    },
  })
  const connector = new Connector({ auth })
  const options = await connector.getOptions({
    instanceConnectionName: config.instanceConnectionName,
    ipType: IpAddressTypes.PUBLIC,
    authType: AuthTypes.IAM,
  })
  // Do not close a failed initial refresh: connector 1.13 close() creates an
  // unhandled rejection in that case. No pool or refresh timer exists yet.
  const pool = new Pool({
    ...options,
    user: config.user,
    database: config.database,
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    allowExitOnIdle: true,
    // The connector owns transport encryption and certificate verification.
    ssl: false,
  })
  pool.on('error', () => console.error('Cloud SQL idle connection failed'))
  attachDatabasePool(pool)
  return {
    pool,
    async close() {
      try {
        await pool.end()
      } finally {
        connector.close()
      }
    },
  }
}
