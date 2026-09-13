import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  verify: vi.fn(),
  fetch: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/config', () => ({
  serverConfig: {
    twilio: {
      requireAccountCredentials: () => ({
        accountSid: `AC${'a'.repeat(32)}`,
        authToken: 'token',
      }),
    },
  },
}))
vi.mock('@/lib/voicemail-ai-logs', () => ({
  CALL_SID: /^CA[0-9a-fA-F]{32}$/,
  RECORDING_SID: /^RE[0-9a-fA-F]{32}$/,
  CallNotEligibleError: class extends Error {},
  recordingMediaUrl: (accountSid: string, sid: string) =>
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${sid}.mp3`,
  verifyRecording: mocks.verify,
}))
vi.stubGlobal('fetch', mocks.fetch)

import { GET } from './route'

const callSid = `CA${'b'.repeat(32)}`
const recordingSid = `RE${'c'.repeat(32)}`
const context = { params: Promise.resolve({ callSid, recordingSid }) }

describe('GET voicemail AI recording', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ userId: 'u', role: 'admin' })
    mocks.fetch.mockResolvedValue(
      new Response('audio', {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      }),
    )
  })

  it('does not access Twilio before admin authentication', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect(
      (await GET(new Request('https://app.test/audio'), context)).status,
    ).toBe(401)
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('constructs the fixed Twilio media URL and forwards Range', async () => {
    const response = await GET(
      new Request('https://evil.test/arbitrary.mp3', {
        headers: { Range: 'bytes=0-99' },
      }),
      context,
    )
    expect(response.status).toBe(200)
    expect(mocks.fetch).toHaveBeenCalledWith(
      `https://api.twilio.com/2010-04-01/Accounts/AC${'a'.repeat(32)}/Recordings/${recordingSid}.mp3`,
      expect.objectContaining({
        headers: expect.objectContaining({ Range: 'bytes=0-99' }),
      }),
    )
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('rejects malformed SIDs without fetching arbitrary URLs', async () => {
    const response = await GET(new Request('https://app.test/audio'), {
      params: Promise.resolve({
        callSid,
        recordingSid: 'https://evil.test/file',
      }),
    })
    expect(response.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
