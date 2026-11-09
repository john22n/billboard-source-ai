import { expect, it, vi } from 'vitest'
import { createServerConfig } from '@/lib/config-core'
import { processLeadNotifications } from './processor'

it('does no external reads or database access when the processor is disabled', async () => {
  const fetcher = vi.fn<typeof fetch>()
  expect(
    await processLeadNotifications({
      config: createServerConfig({ NUTSHELL_NOTIFICATIONS_ENABLED: 'true' }),
      fetcher,
    }),
  ).toEqual({ enabled: false, processed: 0 })
  expect(fetcher).not.toHaveBeenCalled()
})
