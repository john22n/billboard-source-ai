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

export function configErrorMessage(error: unknown): string {
  return isConfigError(error) ? error.message : 'Configuration error'
}

export function isMissingConfig(error: unknown): error is ConfigError {
  return isConfigError(error)
}
