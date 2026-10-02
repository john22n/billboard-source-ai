import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  rateLimit: vi.fn(),
  pendingLog: vi.fn(),
  transcribe: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }))
vi.mock('@/lib/dal', () => ({ createPendingLog: mocks.pendingLog }))
vi.mock('@/lib/config', () => ({
  serverConfig: { openai: { requireApiKey: () => 'test-key' } },
  isMissingConfig: () => false,
  configErrorResponseBody: () => ({}),
}))
vi.mock('openai', () => ({
  default: class {
    audio = { transcriptions: { create: mocks.transcribe } }
  },
}))

import { GET } from '@/app/api/token/route'
import { createTranscriptionSession } from '@/actions/transcribe-actions'
import { createRealtimeSession, transcribeAudio } from '@/actions/voice-actions'
import { calculateOpenAIDurationCost } from './openai-pricing'

describe('OpenAI audio migration contracts', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session.mockResolvedValue({ userId: 'test-user' })
    mocks.rateLimit.mockResolvedValue({ allowed: true })
    mocks.pendingLog.mockResolvedValue({ id: 17 })
    fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        value: 'ephemeral-test-key',
        expires_at: 1234,
        session: { id: 'sess-test' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('issues GA transcription credentials and logs the actual model', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      value: 'ephemeral-test-key',
      session_id: 'sess-test',
      logId: 17,
      model: 'gpt-live-transcribe',
      expires_at: 1234,
    })
    const [url, request] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/realtime/client_secrets')
    const session = JSON.parse(request.body).session
    expect(session.type).toBe('transcription')
    expect(session.audio.input.transcription).toMatchObject({
      model: 'gpt-live-transcribe',
      languages: ['en'],
    })
    expect(session.audio.input.transcription).not.toHaveProperty('language')
    expect(session.audio.input.turn_detection).toBeNull()
    expect(mocks.pendingLog).toHaveBeenCalledWith(
      'test-user',
      'sess-test',
      'gpt-live-transcribe',
    )
  })

  it('preserves language/context and reads the GA action response envelope', async () => {
    expect(
      await createTranscriptionSession({
        language: 'es',
        customInstructions: 'Billboards in Denver',
      }),
    ).toEqual({
      success: true,
      token: 'ephemeral-test-key',
      sessionId: 'sess-test',
      expiresAt: 1234,
    })
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).session.audio.input
        .transcription,
    ).toEqual({
      model: 'gpt-live-transcribe',
      languages: ['es'],
      prompt: 'Billboards in Denver',
    })
  })

  it('rejects unsupported speaker labeling rather than claiming to provide it', async () => {
    expect(
      await createTranscriptionSession({ speakerLabels: true }),
    ).toMatchObject({ success: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses GA voice sessions instead of the removed beta endpoint', async () => {
    expect(await createRealtimeSession()).toEqual({
      success: true,
      token: 'ephemeral-test-key',
      sessionId: 'sess-test',
    })
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.openai.com/v1/realtime/client_secrets',
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      session: {
        type: 'realtime',
        model: 'gpt-realtime-2.1',
        audio: { output: { voice: 'alloy' } },
      },
    })
  })

  it('uses file transcription without Whisper-only parameters', async () => {
    mocks.transcribe.mockResolvedValue({
      text: 'A Denver billboard for $2300.',
    })
    expect(
      await transcribeAudio(Buffer.from('test audio').toString('base64')),
    ).toEqual({
      success: true,
      text: 'A Denver billboard for $2300.',
    })
    expect(mocks.transcribe).toHaveBeenCalledWith({
      file: expect.any(File),
      model: 'gpt-transcribe',
    })
  })

  it('does not call OpenAI without authorization or after a rate limit', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(await createRealtimeSession()).toMatchObject({ success: false })
    mocks.session.mockResolvedValue({ userId: 'test-user' })
    mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 27 })
    const response = await GET()
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('27')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mocks.pendingLog).not.toHaveBeenCalled()
  })

  it('does not log a session when OpenAI rejects its creation', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: 'unavailable' }, { status: 503 }),
    )
    expect((await GET()).status).toBe(502)
    expect(mocks.pendingLog).not.toHaveBeenCalled()
  })

  it('prices new audio models without changing historical Whisper rates', () => {
    expect(calculateOpenAIDurationCost('gpt-live-transcribe', 90)).toBeCloseTo(
      0.0255,
    )
    expect(calculateOpenAIDurationCost('gpt-transcribe', 90)).toBeCloseTo(
      0.00675,
    )
    expect(calculateOpenAIDurationCost('gpt-realtime-whisper', 90)).toBeCloseTo(
      0.0255,
    )
    expect(calculateOpenAIDurationCost('whisper-1', 90)).toBeCloseTo(0.009)
  })
})
