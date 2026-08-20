export type EnvSource = Record<string, string | undefined>

export interface ConfigIssue {
  path: string
  envKey: string
  reason: string
}

export class ConfigError extends Error {
  readonly issues: ConfigIssue[]

  constructor(issue: ConfigIssue | ConfigIssue[]) {
    const issues = Array.isArray(issue) ? issue : [issue]
    super(formatConfigIssues(issues))
    this.name = 'ConfigError'
    this.issues = issues
  }
}

export function isConfigError(error: unknown): error is ConfigError {
  return error instanceof ConfigError
}

export function redactConfigValue(value: string | null | undefined): string {
  if (!value) return '<empty>'
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 2)}••••${value.slice(-4)}`
}

function formatConfigIssues(issues: ConfigIssue[]): string {
  const details = issues
    .map((issue) => `${issue.path} (${issue.envKey}): ${issue.reason}`)
    .join('; ')
  return `Missing or invalid configuration: ${details}`
}

function optionalString(env: EnvSource, envKey: string): string | null {
  const value = env[envKey]?.trim()
  return value ? value : null
}

function requiredString(
  env: EnvSource,
  envKey: string,
  path: string,
  options: { minLength?: number } = {},
): string {
  const value = optionalString(env, envKey)

  if (!value) {
    throw new ConfigError({
      path,
      envKey,
      reason: 'required value is not set',
    })
  }

  if (options.minLength && value.length < options.minLength) {
    throw new ConfigError({
      path,
      envKey,
      reason: `must be at least ${options.minLength} characters`,
    })
  }

  return value
}

export type TaskRouterActivityName =
  | 'available'
  | 'unavailable'
  | 'offline'
  | 'busy'

export interface TaskRouterActivityConfig {
  available: string | null
  unavailable: string | null
  offline: string | null
  busy: string | null
}

export interface ServerConfig {
  runtime: {
    nodeEnv: string
    isProduction: boolean
    nextPhase: string | null
    isProductionBuildPhase: boolean
    isVercel: boolean
    vercelEnv: string | null
    isProductionDeployment: boolean
  }
  auth: {
    jwtSecret: string
    secureCookies: boolean
  }
  database: {
    url: string
    useNeon: boolean
  }
  openai: {
    apiKey: string | null
    adminKey: string | null
    requireApiKey: () => string
    requireAdminKey: () => string
  }
  twilio: {
    accountSid: string | null
    authToken: string | null
    apiKeySid: string | null
    apiKeySecret: string | null
    mainNumber: string | null
    overflowNumber: string | null
    requireAccountCredentials: () => {
      accountSid: string
      authToken: string
    }
    requireVoiceCredentials: () => {
      accountSid: string
      apiKeySid: string
      apiKeySecret: string
    }
    requireAuthToken: () => string
  }
  taskRouter: {
    workspaceSid: string | null
    workflowSid: string | null
    activitySids: TaskRouterActivityConfig
    requireWorkspaceSid: () => string
    requireWorkflowSid: () => string
    requireActivitySid: (activity: TaskRouterActivityName) => string
    requireActivitySids: <T extends readonly TaskRouterActivityName[]>(
      activities: T,
    ) => Record<T[number], string>
  }
  blob: {
    readWriteToken: string | null
    requireReadWriteToken: () => string
  }
  cron: {
    secret: string | null
    requireSecret: () => string
  }
  email: {
    resendApiKey: string | null
    requireResendApiKey: () => string
  }
  voicemail: {
    notificationEmail: string | null
    requireNotificationEmail: () => string
  }
  nutshell: {
    apiKey: string | null
    requireApiKey: () => string
  }
  passkey: {
    rpName: string
    rpId: string
    origin: string
  }
  app: {
    url: string | null
    vercelBypassToken: string | null
    baseUrlFromRequest: (requestUrl: string) => string
    addVercelBypassToken: (url: URL) => URL
  }
  vercel: {
    apiToken: string | null
    projectId: string | null
    deploymentId: string | null
    teamId: string | null
    requireRuntimeLogCredentials: () => {
      apiToken: string
      projectId: string
      deploymentId: string
      teamId: string
    }
  }
  amp: {
    issueWebhookUrl: string | null
    requireIssueWebhookUrl: () => string
  }
}

export interface PublicConfig {
  runtime: {
    nodeEnv: string
    isDevelopment: boolean
  }
  app: {
    url: string | null
  }
  googleMaps: {
    apiKey: string | null
  }
}

const taskRouterActivityEnvKeys: Record<TaskRouterActivityName, string> = {
  available: 'TASKROUTER_ACTIVITY_AVAILABLE_SID',
  unavailable: 'TASKROUTER_ACTIVITY_UNAVAILABLE_SID',
  offline: 'TASKROUTER_ACTIVITY_OFFLINE_SID',
  busy: 'TASKROUTER_ACTIVITY_BUSY_SID',
}

export function createServerConfig(env: EnvSource): ServerConfig {
  const nodeEnv = optionalString(env, 'NODE_ENV') ?? 'development'
  const isProduction = nodeEnv === 'production'
  const nextPhase = optionalString(env, 'NEXT_PHASE')
  const isVercel = optionalString(env, 'VERCEL') != null
  const vercelEnv = optionalString(env, 'VERCEL_ENV')
  const isProductionDeployment = vercelEnv === 'production'

  const app = {
    get url() {
      return optionalString(env, 'NEXT_PUBLIC_APP_URL')
    },
    get vercelBypassToken() {
      return optionalString(env, 'VERCEL_BYPASS_TOKEN')
    },
    baseUrlFromRequest(requestUrl: string) {
      const fallbackUrl = new URL(requestUrl)
      return (
        optionalString(env, 'NEXT_PUBLIC_APP_URL') ??
        `${fallbackUrl.protocol}//${fallbackUrl.host}`
      ).replace(/\/$/, '')
    },
    addVercelBypassToken(url: URL) {
      const bypassToken = optionalString(env, 'VERCEL_BYPASS_TOKEN')
      if (bypassToken) {
        url.searchParams.set('x-vercel-protection-bypass', bypassToken)
      }
      return url
    },
  }

  const openai = {
    get apiKey() {
      return optionalString(env, 'OPENAI_API_KEY')
    },
    get adminKey() {
      return optionalString(env, 'OPENAI_ADMIN_KEY')
    },
    requireApiKey() {
      return requiredString(env, 'OPENAI_API_KEY', 'serverConfig.openai.apiKey')
    },
    requireAdminKey() {
      return requiredString(
        env,
        'OPENAI_ADMIN_KEY',
        'serverConfig.openai.adminKey',
      )
    },
  }

  const twilio = {
    get accountSid() {
      return optionalString(env, 'TWILIO_ACCOUNT_SID')
    },
    get authToken() {
      return optionalString(env, 'TWILIO_AUTH_TOKEN')
    },
    get apiKeySid() {
      return optionalString(env, 'TWILIO_API_KEY_SID')
    },
    get apiKeySecret() {
      return optionalString(env, 'TWILIO_API_KEY_SECRET')
    },
    get mainNumber() {
      return optionalString(env, 'TWILIO_MAIN_NUMBER')
    },
    get overflowNumber() {
      return optionalString(env, 'TWILIO_OVERFLOW_NUMBER')
    },
    requireAccountCredentials() {
      return {
        accountSid: requiredString(
          env,
          'TWILIO_ACCOUNT_SID',
          'serverConfig.twilio.accountSid',
        ),
        authToken: requiredString(
          env,
          'TWILIO_AUTH_TOKEN',
          'serverConfig.twilio.authToken',
        ),
      }
    },
    requireVoiceCredentials() {
      return {
        accountSid: requiredString(
          env,
          'TWILIO_ACCOUNT_SID',
          'serverConfig.twilio.accountSid',
        ),
        apiKeySid: requiredString(
          env,
          'TWILIO_API_KEY_SID',
          'serverConfig.twilio.apiKeySid',
        ),
        apiKeySecret: requiredString(
          env,
          'TWILIO_API_KEY_SECRET',
          'serverConfig.twilio.apiKeySecret',
        ),
      }
    },
    requireAuthToken() {
      return requiredString(
        env,
        'TWILIO_AUTH_TOKEN',
        'serverConfig.twilio.authToken',
      )
    },
  }

  const taskRouter = {
    get workspaceSid() {
      return optionalString(env, 'TASKROUTER_WORKSPACE_SID')
    },
    get workflowSid() {
      return optionalString(env, 'TASKROUTER_WORKFLOW_SID')
    },
    get activitySids() {
      return {
        available: optionalString(env, taskRouterActivityEnvKeys.available),
        unavailable: optionalString(env, taskRouterActivityEnvKeys.unavailable),
        offline: optionalString(env, taskRouterActivityEnvKeys.offline),
        busy: optionalString(env, taskRouterActivityEnvKeys.busy),
      }
    },
    requireWorkspaceSid() {
      return requiredString(
        env,
        'TASKROUTER_WORKSPACE_SID',
        'serverConfig.taskRouter.workspaceSid',
      )
    },
    requireWorkflowSid() {
      return requiredString(
        env,
        'TASKROUTER_WORKFLOW_SID',
        'serverConfig.taskRouter.workflowSid',
      )
    },
    requireActivitySid(activity: TaskRouterActivityName) {
      return requiredString(
        env,
        taskRouterActivityEnvKeys[activity],
        `serverConfig.taskRouter.activitySids.${activity}`,
      )
    },
    requireActivitySids<T extends readonly TaskRouterActivityName[]>(
      activities: T,
    ): Record<T[number], string> {
      return activities.reduce(
        (acc, activity) => ({
          ...acc,
          [activity]: requiredString(
            env,
            taskRouterActivityEnvKeys[activity],
            `serverConfig.taskRouter.activitySids.${activity}`,
          ),
        }),
        {} as Record<T[number], string>,
      )
    },
  }

  const blob = {
    get readWriteToken() {
      return optionalString(env, 'BLOB_READ_WRITE_TOKEN')
    },
    requireReadWriteToken() {
      return requiredString(
        env,
        'BLOB_READ_WRITE_TOKEN',
        'serverConfig.blob.readWriteToken',
      )
    },
  }

  const cron = {
    get secret() {
      return optionalString(env, 'CRON_SECRET')
    },
    requireSecret() {
      return requiredString(env, 'CRON_SECRET', 'serverConfig.cron.secret')
    },
  }

  const email = {
    get resendApiKey() {
      return optionalString(env, 'RESEND_API_KEY')
    },
    requireResendApiKey() {
      return requiredString(
        env,
        'RESEND_API_KEY',
        'serverConfig.email.resendApiKey',
      )
    },
  }

  const voicemail = {
    get notificationEmail() {
      return optionalString(env, 'VOICEMAIL_NOTIFICATION_EMAIL')
    },
    requireNotificationEmail() {
      return requiredString(
        env,
        'VOICEMAIL_NOTIFICATION_EMAIL',
        'serverConfig.voicemail.notificationEmail',
      )
    },
  }

  const nutshell = {
    get apiKey() {
      return optionalString(env, 'NUTSHELL_API_KEY')
    },
    requireApiKey() {
      return requiredString(
        env,
        'NUTSHELL_API_KEY',
        'serverConfig.nutshell.apiKey',
      )
    },
  }

  const vercel = {
    get apiToken() {
      return optionalString(env, 'VERCEL_API_TOKEN')
    },
    get projectId() {
      return optionalString(env, 'VERCEL_PROJECT_ID')
    },
    get deploymentId() {
      return optionalString(env, 'VERCEL_DEPLOYMENT_ID')
    },
    get teamId() {
      return optionalString(env, 'VERCEL_TEAM_ID')
    },
    requireRuntimeLogCredentials() {
      return {
        apiToken: requiredString(
          env,
          'VERCEL_API_TOKEN',
          'serverConfig.vercel.apiToken',
        ),
        projectId: requiredString(
          env,
          'VERCEL_PROJECT_ID',
          'serverConfig.vercel.projectId',
        ),
        deploymentId: requiredString(
          env,
          'VERCEL_DEPLOYMENT_ID',
          'serverConfig.vercel.deploymentId',
        ),
        teamId: requiredString(
          env,
          'VERCEL_TEAM_ID',
          'serverConfig.vercel.teamId',
        ),
      }
    },
  }

  const amp = {
    get issueWebhookUrl() {
      return optionalString(env, 'AMP_ISSUE_WEBHOOK_URL')
    },
    requireIssueWebhookUrl() {
      return requiredString(
        env,
        'AMP_ISSUE_WEBHOOK_URL',
        'serverConfig.amp.issueWebhookUrl',
      )
    },
  }

  const passkey = {
    rpName: 'Billboard Source',
    get rpId() {
      return requiredString(env, 'PASSKEY_RP_ID', 'serverConfig.passkey.rpId')
    },
    get origin() {
      return requiredString(
        env,
        'PASSKEY_ORIGIN',
        'serverConfig.passkey.origin',
      )
    },
  }

  return {
    runtime: {
      nodeEnv,
      isProduction,
      nextPhase,
      isProductionBuildPhase: nextPhase === 'phase-production-build',
      isVercel,
      vercelEnv,
      isProductionDeployment,
    },
    auth: {
      get jwtSecret() {
        return requiredString(
          env,
          'JWT_SECRET',
          'serverConfig.auth.jwtSecret',
          {
            minLength: 32,
          },
        )
      },
      secureCookies: isProduction,
    },
    database: {
      get url() {
        return requiredString(env, 'DATABASE_URL', 'serverConfig.database.url')
      },
      useNeon: isVercel,
    },
    openai,
    twilio,
    taskRouter,
    blob,
    cron,
    email,
    voicemail,
    nutshell,
    passkey,
    app,
    vercel,
    amp,
  }
}

export function createPublicConfig(env: EnvSource): PublicConfig {
  const nodeEnv = optionalString(env, 'NODE_ENV') ?? 'development'

  return {
    runtime: {
      nodeEnv,
      isDevelopment: nodeEnv === 'development',
    },
    app: {
      get url() {
        return optionalString(env, 'NEXT_PUBLIC_APP_URL')
      },
    },
    googleMaps: {
      get apiKey() {
        return optionalString(env, 'NEXT_PUBLIC_GOOGLE_MAP_KEY')
      },
    },
  }
}
