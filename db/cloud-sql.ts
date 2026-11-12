import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector'
import { getVercelOidcToken } from '@vercel/oidc'
import { IdentityPoolClient } from 'google-auth-library'
import { Pool, type PoolClient } from 'pg'
import type { ServerConfig } from '@/lib/config'

type CloudSqlConfig = NonNullable<ServerConfig['database']['cloudSql']>
type ConnectCallback = Parameters<Pool['connect']>[0]

// Keep the normal pg Pool interface (including transactions), but defer Google
// authentication until the first query rather than contacting Google at build time.
export class CloudSqlPool extends Pool {
  private connector?: Connector
  private ready?: Promise<void>

  constructor(private readonly config: CloudSqlConfig) {
    super({
      user: config.user,
      password: config.password,
      database: config.database,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: true,
      // The connector encrypts and verifies the connection itself.
      ssl: false,
    })
    this.on('error', () => console.error('Cloud SQL idle connection failed'))
  }

  private async initialize() {
    const federation = this.config.federation
    const auth = federation
      ? new IdentityPoolClient({
          type: 'external_account',
          audience: federation.audience,
          subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
          token_url: 'https://sts.googleapis.com/v1/token',
          service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(federation.serviceAccountEmail)}:generateAccessToken`,
          scopes: ['https://www.googleapis.com/auth/sqlservice.admin'],
          subject_token_supplier: {
            // Fetch a current token on every refresh, not once at module load.
            getSubjectToken: () =>
              getVercelOidcToken({ audience: `https:${federation.audience}` }),
          },
        })
      : undefined
    const connector = new Connector({ auth })
    Object.assign(
      this.options,
      await connector.getOptions({
        instanceConnectionName: this.config.instanceConnectionName,
        ipType: IpAddressTypes.PUBLIC,
      }),
    )
    // Failed initial refreshes have no sockets or refresh timers to close.
    // Connector 1.13 close() on a failed refresh creates an unhandled rejection.
    this.connector = connector
  }

  override connect(): Promise<PoolClient>
  override connect(callback: ConnectCallback): void
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (this.ending) {
      return callback ? super.connect(callback) : super.connect()
    }
    this.ready ??= this.initialize().catch((error) => {
      this.ready = undefined
      throw error
    })
    const connection = this.ready.then(() => super.connect())
    if (!callback) return connection
    void connection.then(
      (client) => callback(undefined, client, client.release),
      (error) => callback(error, undefined, () => {}),
    )
  }

  override end(): Promise<void>
  override end(callback: () => void): void
  override end(callback?: () => void): Promise<void> | void {
    const ended = super.end().finally(async () => {
      await this.ready?.catch(() => {})
      this.connector?.close()
    })
    if (!callback) return ended
    void ended.then(callback)
  }
}
