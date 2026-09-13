import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  valid: vi.fn(),
  fetch: vi.fn(),
  transcribe: vi.fn(),
}))
vi.mock('@/lib/twilio-webhook', () => ({ isValidTwilioWebhook: mocks.valid }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: `AC${'a'.repeat(32)}`,
        authToken: 'secret',
      }),
    },
  },
}))
vi.mock('@/lib/voicemail-ai-transcripts', () => ({
  transcribeVoicemailAIRecording: mocks.transcribe,
}))
vi.mock(
  '@/lib/voicemail-ai-logs',
  () => import('../../../../lib/voicemail-ai-logs'),
)
vi.mock('twilio', () => ({
  default: () => ({ recordings: () => ({ fetch: mocks.fetch }) }),
}))
import { POST } from './route'

const callSid = `CA${'b'.repeat(32)}`
const recordingSid = `RE${'c'.repeat(32)}`
function request(overrides: Record<string, string> = {}) {
  return new Request('https://app.example/api/twilio/voicemail-ai-recording', {
    method: 'POST',
    body: new URLSearchParams({
      AccountSid: `AC${'a'.repeat(32)}`,
      CallSid: callSid,
      RecordingSid: recordingSid,
      RecordingStatus: 'completed',
      ...overrides,
    }),
  })
}

describe('AI recording callback', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.valid.mockResolvedValue(true)
    mocks.fetch.mockResolvedValue({ callSid })
    mocks.transcribe.mockResolvedValue(undefined)
  })
  it('requests transcription for an authenticated completed recording', async () => {
    expect(
      (await POST(request({ RecordingUrl: 'https://untrusted.test/audio' })))
        .status,
    ).toBe(204)
    expect(mocks.transcribe).toHaveBeenCalledWith(
      expect.anything(),
      callSid,
      recordingSid,
    )
  })
  it('rejects unsigned callbacks before accessing Twilio', async () => {
    mocks.valid.mockResolvedValue(false)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.transcribe).not.toHaveBeenCalled()
  })
  it.each([
    [{ CallSid: 'invalid' }, 400],
    [{ RecordingSid: 'invalid' }, 400],
    [{ AccountSid: 'another-account' }, 403],
    [{ RecordingStatus: 'absent' }, 204],
  ])(
    'does not transcribe rejected or absent recordings: %j',
    async (overrides, status) => {
      expect((await POST(request(overrides))).status).toBe(status)
      expect(mocks.transcribe).not.toHaveBeenCalled()
    },
  )
  it('rejects a recording belonging to another call', async () => {
    mocks.fetch.mockResolvedValue({ callSid: 'another-call' })
    expect((await POST(request())).status).toBe(403)
    expect(mocks.transcribe).not.toHaveBeenCalled()
  })
  it('returns a failure for retry and logs no transcript content', async () => {
    mocks.transcribe.mockRejectedValue(new Error('provider unavailable'))
    expect((await POST(request())).status).toBe(502)
  })
})
