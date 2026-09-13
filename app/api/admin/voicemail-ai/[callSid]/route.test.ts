import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ session: vi.fn(), detail: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: 'ACtest',
        authToken: 'secret',
      }),
    },
  },
}))
vi.mock('@/lib/voicemail-ai-logs', () => ({
  CALL_SID: /^CA[0-9a-fA-F]{32}$/,
  CallNotEligibleError: class extends Error {},
  getVoicemailAIDetail: mocks.detail,
}))
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())
const callSid = `CA${'a'.repeat(32)}`
const request = new Request(
  'https://app.test/api/admin/voicemail-ai/' + callSid,
)

it.each([
  [null, 401],
  [{ userId: 'rep', role: 'user' }, 403],
])('gates call details before Twilio access', async (session, status) => {
  mocks.session.mockResolvedValue(session)
  expect(
    (await GET(request, { params: Promise.resolve({ callSid }) })).status,
  ).toBe(status)
  expect(mocks.detail).not.toHaveBeenCalled()
})

it('returns private admin detail without provider credentials', async () => {
  mocks.session.mockResolvedValue({ userId: 'admin', role: 'admin' })
  const detail = {
    errors: [],
    recordings: [],
    warnings: ['Recordings unavailable'],
  }
  mocks.detail.mockResolvedValue(detail)
  const response = await GET(request, { params: Promise.resolve({ callSid }) })
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual(detail)
})
