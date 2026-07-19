import {
  ConfigError,
  createServerConfig,
  isConfigError,
  redactConfigValue,
} from './config-core'

export { ConfigError, createServerConfig, isConfigError, redactConfigValue }
export type {
  ConfigIssue,
  EnvSource,
  ServerConfig,
  TaskRouterActivityName,
} from './config-core'

export const serverConfig = createServerConfig(process.env)

const CONFIGURATION_ERROR = 'Configuration error'

export function configErrorResponseBody(error: unknown): {
  error: string
  details: string
} {
  return {
    error: CONFIGURATION_ERROR,
    details: isConfigError(error)
      ? 'Required service configuration is unavailable'
      : CONFIGURATION_ERROR,
  }
}

export function isMissingConfig(error: unknown): error is ConfigError {
  return isConfigError(error)
}
