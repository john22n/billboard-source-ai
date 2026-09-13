import { describe, expect, it, vi } from 'vitest'
import {
  CallNotEligibleError,
  InvalidCursorError,
  getVoicemailAIDetail,
  hasAIEvent,
  listVoicemailAICalls,
  verifyRecording,
} from './voicemail-ai-logs'

const credentials = { accountSid: `AC${'a'.repeat(32)}`, authToken: 'secret' }
const callSid = `CA${'b'.repeat(32)}`
const recordingSid = `RE${'c'.repeat(32)}`
const now = new Date('2026-09-13T12:00:00.000Z')

function clientFor(options: {
  call?: Record<string, unknown>
  events?: unknown[]
  notifications?: unknown[] | Error
  recordings?: unknown[] | Error
  recordingCallSid?: string
  transcriptions?: unknown[] | Error
  nextPageUrl?: string
}) {
  const call = {
    sid: callSid,
    direction: 'inbound',
    startTime: new Date('2026-09-10T12:00:00.000Z'),
    dateCreated: now,
    from: '+15550000001',
    to: '+15550000002',
    status: 'completed',
    duration: '12',
    ...options.call,
  }
  const listResult = (value: unknown[] | Error | undefined) =>
    value instanceof Error
      ? vi.fn().mockRejectedValue(value)
      : vi.fn().mockResolvedValue(value ?? [])
  const context = {
    fetch: vi.fn().mockResolvedValue(call),
    events: { list: listResult(options.events) },
    notifications: { list: listResult(options.notifications) },
    recordings: { list: listResult(options.recordings) },
  }
  const calls = Object.assign(
    vi.fn(() => context),
    {
      page: vi.fn().mockResolvedValue({
        instances: [call],
        nextPageUrl: options.nextPageUrl,
      }),
    },
  )
  const transcriptions = { list: listResult(options.transcriptions) }
  const recording = {
    fetch: vi
      .fn()
      .mockResolvedValue({ callSid: options.recordingCallSid ?? callSid }),
    transcriptions,
  }
  return { calls, recordings: vi.fn(() => recording) }
}

const aiEvent = {
  request: { url: 'https://voicemail-agent.john22n-iii.com/start?x=1' },
}

describe('voicemail AI log provider', () => {
  it('requires the exact event request hostname', () => {
    expect(hasAIEvent([aiEvent])).toBe(true)
    expect(
      hasAIEvent([
        {
          request: {
            url: 'https://voicemail-agent.john22n-iii.com.evil.test/',
          },
        },
      ]),
    ).toBe(false)
    expect(hasAIEvent([{ request: { url: 'not a url' } }])).toBe(false)
  })

  it('filters direction and preserves the fixed rolling range in a signed cursor', async () => {
    const firstClient = clientFor({
      events: [aiEvent],
      nextPageUrl: '/2010-04-01/Accounts/AC/Calls.json?PageToken=token-2',
    })
    const first = await listVoicemailAICalls(
      credentials,
      null,
      now,
      firstClient as never,
    )
    expect(first.calls).toHaveLength(1)
    expect(first.since).toBe('2026-08-23T12:00:00.000Z')
    expect(first.nextCursor).toBeTruthy()

    const secondClient = clientFor({ events: [aiEvent] })
    const second = await listVoicemailAICalls(
      credentials,
      first.nextCursor,
      new Date('2027-01-01'),
      secondClient as never,
    )
    expect(second.since).toBe(first.since)
    expect(second.until).toBe(first.until)
    expect(secondClient.calls.page).toHaveBeenCalledWith(
      expect.objectContaining({ pageToken: 'token-2' }),
    )
  })

  it('rejects detail outside 21 days even when events match', async () => {
    const client = clientFor({
      call: { startTime: new Date('2026-08-20T00:00:00.000Z') },
      events: [aiEvent],
    })
    await expect(
      getVoicemailAIDetail(credentials, callSid, now, client as never),
    ).rejects.toBeInstanceOf(CallNotEligibleError)
  })

  it('distinguishes a missing resource from a successful zero-error result', async () => {
    const missing = await getVoicemailAIDetail(
      credentials,
      callSid,
      now,
      clientFor({
        events: [aiEvent],
        notifications: new Error('down'),
        recordings: [],
      }) as never,
    )
    expect(missing.errors).toEqual([])
    expect(missing.warnings).toContain(
      'Twilio notifications were unavailable; errors may be incomplete.',
    )

    const empty = await getVoicemailAIDetail(
      credentials,
      callSid,
      now,
      clientFor({
        events: [aiEvent],
        notifications: [],
        recordings: [],
      }) as never,
    )
    expect(empty.errors).toEqual([])
    expect(empty.warnings.join(' ')).not.toContain(
      'notifications were unavailable',
    )
  })

  it('verifies recording ownership', async () => {
    await expect(
      verifyRecording(
        credentials,
        callSid,
        recordingSid,
        now,
        clientFor({
          events: [aiEvent],
          recordingCallSid: `CA${'d'.repeat(32)}`,
        }) as never,
      ),
    ).rejects.toBeInstanceOf(CallNotEligibleError)
  })

  it.each([
    ['2026-08-23T11:59:59Z', 'inbound', 0],
    ['2026-08-23T12:00:00Z', 'inbound', 1],
    ['2026-09-13T12:00:01Z', 'inbound', 0],
    ['2026-09-12T12:00:00Z', 'outbound-api', 0],
  ])(
    'enforces call range and direction: %s %s',
    async (date, direction, count) => {
      const client = clientFor({
        call: { startTime: new Date(date), direction },
        events: [aiEvent],
      })
      const page = await listVoicemailAICalls(
        credentials,
        null,
        now,
        client as never,
      )
      expect(page.calls).toHaveLength(count)
      expect(client.calls).toHaveBeenCalledTimes(count)
    },
  )

  it('rejects tampered cursors before contacting Twilio', async () => {
    const client = clientFor({})
    await expect(
      listVoicemailAICalls(
        credentials,
        'arbitrary.invalid',
        now,
        client as never,
      ),
    ).rejects.toBeInstanceOf(InvalidCursorError)
    expect(client.calls.page).not.toHaveBeenCalled()
  })

  it('returns error details and existing Twilio transcripts without request credentials', async () => {
    const detail = await getVoicemailAIDetail(
      credentials,
      callSid,
      now,
      clientFor({
        events: [aiEvent],
        notifications: [
          {
            sid: 'NO1',
            errorCode: '31901',
            messageText: 'WebSocket closed',
            dateCreated: now,
            requestUrl: 'https://hidden/?token=secret',
          },
        ],
        recordings: [
          { sid: recordingSid, duration: '17', status: 'completed' },
        ],
        transcriptions: [
          {
            sid: 'TR1',
            transcriptionText: 'Please call back.',
            status: 'completed',
          },
        ],
      }) as never,
    )
    expect(detail.errors).toEqual([
      {
        sid: 'NO1',
        code: '31901',
        message: 'WebSocket closed',
        createdAt: now.toISOString(),
      },
    ])
    expect(detail.recordings).toEqual([
      {
        sid: recordingSid,
        duration: 17,
        status: 'completed',
        transcriptions: [
          { sid: 'TR1', text: 'Please call back.', status: 'completed' },
        ],
      },
    ])
    expect(JSON.stringify(detail)).not.toContain('secret')
  })
})
