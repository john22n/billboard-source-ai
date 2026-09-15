// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from '@/db/schema'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  twilio: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/actions/user-actions', () => ({
  updateCellPhone: mocks.save,
  updateTwilioPhone: mocks.twilio,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}))
vi.mock('@/components/sign-up', () => ({ SignupForm: () => null }))
vi.mock('@/hooks/useAutoLogout', () => ({ useAutoLogout: () => undefined }))
vi.mock('./voicemail-ai-tab', () => ({ default: () => null }))

import AdminClient from './admin-client'

let container: HTMLDivElement
let root: Root
let input: HTMLInputElement
const account: User = {
  id: 'rep',
  email: 'rep@example.com',
  password: null,
  role: 'user',
  twilioPhoneNumber: '+12025550128',
  cellPhoneNumber: '+13035550124',
  taskRouterWorkerSid: null,
  workerActivity: 'offline',
  callsAccepted: 0,
  callsRejected: 0,
  callsMissed: 0,
  lastAttemptSid: null,
  lastRejectAt: null,
}

beforeEach(async () => {
  vi.resetAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ issues: [], availability: {} })),
  )
  mocks.save.mockResolvedValue({ success: true })
  mocks.twilio.mockResolvedValue({ success: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <AdminClient
        initialUsers={[account]}
        initialCosts={[]}
        initialLeadStats={null}
        mainCallsTotal={0}
        sessionEmail="admin@example.com"
        sessionIssuedAt={0}
        userCostStartDate="2026-09-01"
        userCostEndDate="2026-09-15"
      />,
    ),
  )
  input = container.querySelector<HTMLInputElement>(
    '[aria-label="Cell phone for rep@example.com"]',
  )!
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function type(value: string) {
  await act(async () => {
    input.focus()
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('validates on Enter, saves a normalized number once, and ignores unchanged blur', async () => {
  await type('(303) 555-0123')
  expect(mocks.save).not.toHaveBeenCalled()
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
  })
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('rep', '+13035550123')
  expect(input.value).toBe('(303) 555-0123')
  expect(mocks.refresh).toHaveBeenCalledOnce()
  await act(async () => {
    input.focus()
    input.blur()
  })
  expect(mocks.save).toHaveBeenCalledTimes(1)
})

it('formats stored US numbers without saving on unchanged blur', async () => {
  expect(input.value).toBe('(303) 555-0124')
  await act(async () => {
    input.focus()
    input.blur()
  })
  input = container.querySelector<HTMLInputElement>(
    '[aria-label="Twilio phone number"]',
  )!
  expect(input.value).toBe('(202) 555-0128')
  await type('2025550128')
  await act(async () => input.blur())
  expect(input.value).toBe('(202) 555-0128')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.twilio).not.toHaveBeenCalled()
})

it('saves edited US Twilio numbers in E.164 format', async () => {
  input = container.querySelector<HTMLInputElement>(
    '[aria-label="Twilio phone number"]',
  )!
  await type('(415) 555-0129')
  await act(async () => input.blur())
  expect(mocks.twilio).toHaveBeenCalledExactlyOnceWith('rep', '+14155550129')
})

it('preserves international cell numbers', async () => {
  await type('+442079460018')
  await act(async () => input.blur())
  expect(input.value).toBe('+442079460018')
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('rep', '+442079460018')
})

it('rejects invalid input on blur and allows clearing the saved number', async () => {
  await type('123')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  await act(async () => input.blur())
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Enter a valid phone number',
  )
  expect(mocks.save).not.toHaveBeenCalled()
  await type('')
  await act(async () => input.blur())
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith('rep', '')
  expect(input.getAttribute('aria-invalid')).toBe('false')
})

it('disables while saving and shows server errors without refreshing, then permits retry', async () => {
  let complete!: (result: { success: boolean; message: string }) => void
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  await type('2025550128')
  await act(async () => input.blur())
  expect(input.disabled).toBe(true)
  expect(container.textContent).toContain('Saving…')
  await act(async () => complete({ success: false, message: 'Save failed' }))
  expect(input.disabled).toBe(false)
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    'Save failed',
  )
  expect(mocks.refresh).not.toHaveBeenCalled()
  await act(async () => {
    input.focus()
    input.blur()
  })
  expect(mocks.save).toHaveBeenCalledTimes(2)
  expect(mocks.refresh).toHaveBeenCalledOnce()
})
