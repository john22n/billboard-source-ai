import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  createPublicConfig,
  createServerConfig,
  redactConfigValue,
} from './config-core'

describe('server config', () => {
  const cloudSqlEnv = {
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    VERCEL_TARGET_ENV: 'dev',
    DATABASE_DRIVER: 'cloudsql',
    CLOUD_SQL_INSTANCE_CONNECTION_NAME: 'project:us-central1:database',
    CLOUD_SQL_DATABASE: 'billboard_dev',
    CLOUD_SQL_USER: 'app@project.iam',
    CLOUD_SQL_VERCEL_OWNER_ID: 'team_dev',
    CLOUD_SQL_VERCEL_PROJECT_ID: 'prj_dev',
    CLOUD_SQL_VERCEL_ENVIRONMENT_ID: 'env_dev',
    GCP_PROJECT_NUMBER: '123456789012',
    GCP_WORKLOAD_IDENTITY_POOL_ID: 'test-pool',
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'test-provider',
    GCP_SERVICE_ACCOUNT_EMAIL: 'app@project.iam.gserviceaccount.com',
  }

  it('requires an explicit driver and preserves existing deployment defaults', () => {
    for (const env of [
      { VERCEL: '1', VERCEL_ENV: 'production' },
      { VERCEL: '1', VERCEL_ENV: 'preview' },
      { ...cloudSqlEnv, DATABASE_DRIVER: undefined, VERCEL_ENV: 'production' },
    ]) {
      const config = createServerConfig(env)
      expect(Reflect.get(config.database, 'driver')).toBe('neon')
      expect(config.database.cloudSql).toBeNull()
    }
    expect(Reflect.get(createServerConfig({}).database, 'driver')).toBe(
      'postgres',
    )
  })

  it('selects the isolated dev IAM login without a database password', () => {
    const config = createServerConfig(cloudSqlEnv)
    expect(Reflect.get(config.database, 'driver')).toBe('cloudsql')
    expect(config.database.cloudSql).toEqual({
      instanceConnectionName: 'project:us-central1:database',
      database: 'billboard_dev',
      user: 'app@project.iam',
      federation: {
        audience:
          '//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/test-pool/providers/test-provider',
        serviceAccountEmail: 'app@project.iam.gserviceaccount.com',
        ownerId: 'team_dev',
        projectId: 'prj_dev',
        environmentId: 'env_dev',
      },
    })
  })

  it('fails closed for invalid drivers and production overrides', () => {
    for (const env of [
      { DATABASE_DRIVER: 'typo' },
      { ...cloudSqlEnv, VERCEL_ENV: 'production' },
      { ...cloudSqlEnv, VERCEL_TARGET_ENV: 'production' },
      { VERCEL: '1', VERCEL_ENV: 'production', DATABASE_DRIVER: 'postgres' },
    ]) {
      expect(() =>
        Reflect.get(createServerConfig(env).database, 'driver'),
      ).toThrow(ConfigError)
    }
  })

  it('rejects Cloud SQL outside the intended custom environment or with incomplete identity', () => {
    for (const override of [
      { VERCEL: undefined },
      { VERCEL_TARGET_ENV: undefined },
      { VERCEL_TARGET_ENV: 'preview' },
      { VERCEL_TARGET_ENV: 'development' },
      { CLOUD_SQL_DATABASE: undefined },
      { CLOUD_SQL_INSTANCE_CONNECTION_NAME: undefined },
      { CLOUD_SQL_VERCEL_ENVIRONMENT_ID: undefined },
      { CLOUD_SQL_VERCEL_OWNER_ID: undefined },
      { CLOUD_SQL_VERCEL_PROJECT_ID: undefined },
      { GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: undefined },
      { CLOUD_SQL_USER: 'migration-owner' },
    ]) {
      expect(
        () =>
          createServerConfig({ ...cloudSqlEnv, ...override }).database.cloudSql,
      ).toThrow(ConfigError)
    }
  })

  it('requires a sufficiently long JWT secret without falling back', () => {
    const config = createServerConfig({})

    expect(() => config.auth.jwtSecret).toThrow(ConfigError)
    expect(() => config.auth.jwtSecret).toThrow('JWT_SECRET')
  })

  it('does not include secret values in invalid config errors', () => {
    const secret = 'short-secret-value'
    const config = createServerConfig({ JWT_SECRET: secret })

    expect(() => config.auth.jwtSecret).toThrow(ConfigError)

    try {
      void config.auth.jwtSecret
    } catch (error) {
      expect(String(error)).not.toContain(secret)
      expect(String(error)).toContain('serverConfig.auth.jwtSecret')
    }
  })

  it('exposes provider-specific service credentials', () => {
    const config = createServerConfig({
      OPENAI_API_KEY: 'openai-key',
      OPENAI_ADMIN_KEY: 'openai-admin-key',
      TWILIO_ACCOUNT_SID: 'account-sid',
      TWILIO_AUTH_TOKEN: 'auth-token',
      TWILIO_API_KEY_SID: 'api-key-sid',
      TWILIO_API_KEY_SECRET: 'api-key-secret',
      TASKROUTER_WORKSPACE_SID: 'workspace-sid',
      TASKROUTER_WORKFLOW_SID: 'workflow-sid',
      TASKROUTER_ACTIVITY_AVAILABLE_SID: 'available-sid',
      TASKROUTER_ACTIVITY_OFFLINE_SID: 'offline-sid',
      CRON_SECRET: 'cron-secret',
      DIALOGS_API_KEY: 'dialogs-key',
      RESEND_API_KEY: 'resend-key',
      VOICEMAIL_NOTIFICATION_EMAIL: 'voicemail@example.com',
      NUTSHELL_API_KEY: 'nutshell-key',
      VERCEL_API_TOKEN: 'vercel-token',
      VERCEL_PROJECT_ID: 'project-id',
      VERCEL_DEPLOYMENT_ID: 'deployment-id',
      VERCEL_TEAM_ID: 'team-id',
      SLACK_USER_TOKEN: 'slack-user-token',
      SLACK_AMP_CHANNEL_ID: 'CAMP123',
      SLACK_AMP_USER_ID: 'UAMP123',
    })

    expect(config.openai.requireApiKey()).toBe('openai-key')
    expect(config.openai.requireAdminKey()).toBe('openai-admin-key')
    expect(config.twilio.requireAccountCredentials()).toEqual({
      accountSid: 'account-sid',
      authToken: 'auth-token',
    })
    expect(config.twilio.requireVoiceCredentials()).toEqual({
      accountSid: 'account-sid',
      apiKeySid: 'api-key-sid',
      apiKeySecret: 'api-key-secret',
    })
    expect(config.taskRouter.requireWorkspaceSid()).toBe('workspace-sid')
    expect(config.taskRouter.requireWorkflowSid()).toBe('workflow-sid')
    expect(
      config.taskRouter.requireActivitySids(['available', 'offline'] as const),
    ).toEqual({ available: 'available-sid', offline: 'offline-sid' })
    expect(config.cron.requireSecret()).toBe('cron-secret')
    expect(config.marketData.requireApiKey()).toBe('dialogs-key')
    expect(config.email.requireResendApiKey()).toBe('resend-key')
    expect(config.voicemail.requireNotificationEmail()).toBe(
      'voicemail@example.com',
    )
    expect(config.nutshell.requireApiKey()).toBe('nutshell-key')
    expect(config.vercel.requireRuntimeLogCredentials()).toEqual({
      apiToken: 'vercel-token',
      projectId: 'project-id',
      deploymentId: 'deployment-id',
      teamId: 'team-id',
    })
    expect(config.slack.requireIssueReportingCredentials()).toEqual({
      userToken: 'slack-user-token',
      ampChannelId: 'CAMP123',
      ampUserId: 'UAMP123',
    })
  })

  it('requires the Vercel team ID but treats the deployment ID as optional', () => {
    const base = {
      NODE_ENV: 'production',
      VERCEL_API_TOKEN: 'vercel-token',
      VERCEL_PROJECT_ID: 'project-id',
    }
    const missingTeam = createServerConfig(base)
    expect(() => missingTeam.vercel.requireRuntimeLogCredentials()).toThrow(
      'VERCEL_TEAM_ID',
    )

    const projectWide = createServerConfig({ ...base, VERCEL_TEAM_ID: 'team' })
    expect(projectWide.vercel.requireRuntimeLogCredentials()).toEqual({
      apiToken: 'vercel-token',
      projectId: 'project-id',
      teamId: 'team',
      deploymentId: null,
    })
  })

  it('requires passkey config in every environment', () => {
    const missing = createServerConfig({ NODE_ENV: 'development' })
    expect(() => missing.passkey.rpId).toThrow('PASSKEY_RP_ID')
    expect(() => missing.passkey.origin).toThrow('PASSKEY_ORIGIN')

    const configured = createServerConfig({
      NODE_ENV: 'development',
      PASSKEY_RP_ID: 'localhost',
      PASSKEY_ORIGIN: 'http://localhost:3000',
    })
    expect(configured.passkey.rpId).toBe('localhost')
    expect(configured.passkey.origin).toBe('http://localhost:3000')
  })

  it('normalizes app URLs and applies the Vercel bypass token at one seam', () => {
    const config = createServerConfig({
      NEXT_PUBLIC_APP_URL: 'https://example.com/',
      VERCEL_BYPASS_TOKEN: 'bypass-secret',
    })

    expect(config.app.baseUrlFromRequest('https://preview.example/api')).toBe(
      'https://example.com',
    )

    const url = config.app.addVercelBypassToken(
      new URL('https://example.com/api/callback'),
    )
    expect(url.searchParams.get('x-vercel-protection-bypass')).toBe(
      'bypass-secret',
    )
  })
})

describe('public config', () => {
  it('exposes only public client configuration', () => {
    const config = createPublicConfig({
      NODE_ENV: 'development',
      NEXT_PUBLIC_GOOGLE_MAP_KEY: 'google-map-key',
      NEXT_PUBLIC_APP_URL: 'https://example.com',
      OPENAI_API_KEY: 'server-secret',
    })

    expect(config.runtime.isDevelopment).toBe(true)
    expect(config.googleMaps.apiKey).toBe('google-map-key')
    expect(config.app.url).toBe('https://example.com')
    expect('openai' in config).toBe(false)
  })
})

describe('redactConfigValue', () => {
  it('redacts values without echoing the full secret', () => {
    expect(redactConfigValue(undefined)).toBe('<empty>')
    expect(redactConfigValue('secret')).toBe('••••')
    expect(redactConfigValue('abcdefghijklmnop')).toBe('ab••••mnop')
  })
})
