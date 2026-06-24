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

export function configErrorMessage(error: unknown): string {
  return isConfigError(error) ? error.message : CONFIGURATION_ERROR
}

export function configErrorResponseBody(error: unknown): {
  error: string
  details: string
} {
  return {
    error: CONFIGURATION_ERROR,
    details: configErrorMessage(error),
  }
}

export function isMissingConfig(error: unknown): error is ConfigError {
  return isConfigError(error)
}
