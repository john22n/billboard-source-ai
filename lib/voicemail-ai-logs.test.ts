import { describe, expect, it, vi } from 'vitest'
import {
  CallNotEligibleError,
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
  aiTranscripts?: unknown[] | Error
  sentences?: unknown[]
}) {
  const call = {
    sid: callSid,
    direction: 'inbound',
    startTime: new Date('2026-09-12T12:00:00.000Z'),
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
      list: vi.fn().mockResolvedValue([call]),
    },
  )
  const transcriptions = { list: listResult(options.transcriptions) }
  const recording = {
    fetch: vi
      .fn()
      .mockResolvedValue({ callSid: options.recordingCallSid ?? callSid }),
    transcriptions,
  }
  const transcripts = Object.assign(
    vi.fn(() => ({ sentences: { list: listResult(options.sentences) } })),
    { list: listResult(options.aiTranscripts) },
  )
  return {
    calls,
    recordings: vi.fn(() => recording),
    intelligence: { v2: { transcripts } },
  }
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

  it('queries only Central weekends and returns the whole rolling window without a cursor', async () => {
    const client = clientFor({ events: [aiEvent] })
    const result = await listVoicemailAICalls(credentials, now, client as never)
    expect(result.calls).toHaveLength(1)
    expect(result.since).toBe('2026-08-23T12:00:00.000Z')
    expect(result).not.toHaveProperty('nextCursor')
    expect(client.calls.list.mock.calls).toEqual([
      [
        {
          startTimeAfter: new Date('2026-08-23T12:00:00Z'),
          startTimeBefore: new Date('2026-08-24T05:00:00Z'),
          pageSize: 1000,
        },
      ],
      [
        {
          startTimeAfter: new Date('2026-08-29T05:00:00Z'),
          startTimeBefore: new Date('2026-08-31T05:00:00Z'),
          pageSize: 1000,
        },
      ],
      [
        {
          startTimeAfter: new Date('2026-09-05T05:00:00Z'),
          startTimeBefore: new Date('2026-09-07T05:00:00Z'),
          pageSize: 1000,
        },
      ],
      [
        {
          startTimeAfter: new Date('2026-09-12T05:00:00Z'),
          startTimeBefore: now,
          pageSize: 1000,
        },
      ],
    ])
  })

  it.each([
    ['2026-03-10T12:00:00Z', '2026-03-07T06:00:00Z', '2026-03-09T05:00:00Z'],
    ['2026-11-03T12:00:00Z', '2026-10-31T05:00:00Z', '2026-11-02T06:00:00Z'],
  ])('uses both DST boundary offsets for %s', async (date, start, end) => {
    const client = clientFor({})
    await listVoicemailAICalls(credentials, new Date(date), client as never)
    expect(client.calls.list).toHaveBeenCalledWith({
      startTimeAfter: new Date(start),
      startTimeBefore: new Date(end),
      pageSize: 1000,
    })
  })

  it('returns older AI calls after more than 50 unrelated calls, newest first', async () => {
    const client = clientFor({ events: [aiEvent] })
    const base = {
      direction: 'inbound',
      from: '+15550000001',
      to: '+15550000002',
      status: 'completed',
      duration: '17',
    }
    client.calls.list.mockResolvedValue([
      ...Array.from({ length: 60 }, (_, i) => ({
        ...base,
        sid: `unrelated-${i}`,
        startTime: new Date('2026-09-13T10:00:00Z'),
      })),
      { ...base, sid: 'older-ai', startTime: new Date('2026-09-06T12:00:00Z') },
      {
        ...base,
        sid: 'sunday-ai',
        startTime: new Date('2026-09-13T11:00:00Z'),
      },
    ])
    const context = client.calls()
    client.calls.mockImplementation((...args: unknown[]) => ({
      ...context,
      events: {
        list: vi
          .fn()
          .mockResolvedValue(String(args[0]).endsWith('-ai') ? [aiEvent] : []),
      },
    }))
    const result = await listVoicemailAICalls(credentials, now, client as never)
    expect(result.calls.map((call) => call.sid)).toEqual([
      'sunday-ai',
      'older-ai',
    ])
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
    ['2026-09-12T04:59:59Z', 'inbound', 0],
    ['2026-09-12T05:00:00Z', 'inbound', 1],
    ['2026-09-07T04:59:59Z', 'inbound', 1],
    ['2026-09-07T05:00:00Z', 'inbound', 0],
    ['2026-09-10T12:00:00Z', 'inbound', 0],
  ])(
    'enforces call range and direction: %s %s',
    async (date, direction, count) => {
      const client = clientFor({
        call: { startTime: new Date(date), direction },
        events: [aiEvent],
      })
      const page = await listVoicemailAICalls(credentials, now, client as never)
      expect(page.calls).toHaveLength(count)
      expect(client.calls).toHaveBeenCalledTimes(count)
    },
  )

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
        aiTranscripts: [{ sid: 'GT1', status: 'completed' }],
        sentences: [
          {
            startTime: '1.0',
            sentenceIndex: 0,
            mediaChannel: 1,
            transcript: 'I need a billboard.',
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
          {
            sid: 'GT1',
            text: 'Channel 1: I need a billboard.',
            status: 'completed',
          },
        ],
      },
    ])
    expect(JSON.stringify(detail)).not.toContain('secret')
  })
})
