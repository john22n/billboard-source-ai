import { expect, it } from 'vitest'
import { createServerConfig } from './config-core'

it('keeps notification processing off without explicit enablement and an absolute cutoff', () => {
  expect(createServerConfig({}).leadNotifications.enabled).toBe(false)
  expect(
    createServerConfig({ NUTSHELL_NOTIFICATIONS_ENABLED: 'true' })
      .leadNotifications.enabled,
  ).toBe(false)
  expect(
    createServerConfig({ NUTSHELL_NOTIFICATIONS_ENABLED: 'true' }).nutshell
      .notificationsEnabled,
  ).toBe(true)
  const config = createServerConfig({
    NUTSHELL_NOTIFICATIONS_ENABLED: 'true',
    LEAD_NOTIFICATIONS_LAUNCH_CUTOFF: '2026-11-09T00:00:00Z',
    NUTSHELL_API_KEY: 'test',
    LEAD_NOTIFICATIONS_RECIPIENT_ALLOWLIST: ' Rep@Example.test ',
  }).leadNotifications
  expect(config.enabled).toBe(true)
  expect(config.integrationEmail).toBe('sky@billboardsource.com')
  expect(config.recipientAllowlist).toEqual(['rep@example.test'])
})
