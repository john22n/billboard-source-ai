import twilio from 'twilio'
import { getVoicemailAITranscripts } from './voicemail-ai-transcripts'
import type {
  VoicemailAICall,
  VoicemailAIDetail,
  VoicemailAIPage,
} from './voicemail-ai-log-types'

export const AI_HOSTNAME = 'voicemail-agent.john22n-iii.com'
export const CALL_SID = /^CA[0-9a-fA-F]{32}$/
export const RECORDING_SID = /^RE[0-9a-fA-F]{32}$/
const CHILD_LIMIT = 100
const WINDOW_MS = 21 * 24 * 60 * 60 * 1000
const AVAILABILITY_WARNING =
  'Twilio Call Events can take up to 15 minutes after a call ends to appear and are retained for only 30 days; recent or unavailable events can cause calls to be omitted.'

type Credentials = { accountSid: string; authToken: string }
type TwilioClient = ReturnType<typeof twilio>

export class CallNotEligibleError extends Error {}

function eventUrl(event: { request?: unknown }): string | null {
  if (!event.request || typeof event.request !== 'object') return null
  const request = event.request as Record<string, unknown>
  const value = request.url ?? request.request_url ?? request.requestUrl
  return typeof value === 'string' ? value : null
}

export function hasAIEvent(events: Array<{ request?: unknown }>): boolean {
  return events.some((event) => {
    const value = eventUrl(event)
    if (!value) return false
    try {
      return new URL(value).hostname === AI_HOSTNAME
    } catch {
      return false
    }
  })
}

const centralHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  hourCycle: 'h23',
})
const DAY_MS = 24 * 60 * 60 * 1000

function centralMidnight(date: Date) {
  // At 06:00 UTC Chicago is either midnight (CST) or 01:00 (CDT).
  // Resolve each boundary separately so DST weekends can be 47 or 49 hours.
  const sixUTC = new Date(date.getTime() + 6 * 60 * 60 * 1000)
  return new Date(
    sixUTC.getTime() - Number(centralHour.format(sixUTC)) * 60 * 60 * 1000,
  )
}

function weekendRanges(since: Date, until: Date) {
  const ranges: Array<{ start: Date; end: Date }> = []
  const day = new Date(since)
  day.setUTCHours(0, 0, 0, 0)
  // Include the Saturday before a range that starts partway through a weekend.
  day.setUTCDate(day.getUTCDate() - 7)
  for (; day <= until; day.setUTCDate(day.getUTCDate() + 1)) {
    if (day.getUTCDay() !== 6) continue
    const start = centralMidnight(day)
    const end = centralMidnight(new Date(day.getTime() + 2 * DAY_MS))
    if (end > since && start <= until) ranges.push({ start, end })
  }
  return ranges
}

function callDate(call: {
  startTime?: Date | null
  dateCreated?: Date | null
}) {
  return call.startTime ?? call.dateCreated ?? null
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
) {
  const output = new Array<R>(items.length)
  let index = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = index++
        output[current] = await fn(items[current])
      }
    }),
  )
  return output
}

export async function listVoicemailAICalls(
  credentials: Credentials,
  now = new Date(),
  client: TwilioClient = twilio(credentials.accountSid, credentials.authToken, {
    timeout: 8_000,
  }),
): Promise<VoicemailAIPage> {
  const since = new Date(now.getTime() - WINDOW_MS)
  const until = now
  const ranges = weekendRanges(since, until)
  const weekends = await mapConcurrent(ranges, 3, async ({ start, end }) => {
    // The SDK follows every provider page on the server. Do not cap the total
    // records: non-AI calls must never hide AI calls on a later Twilio page.
    const calls = await client.calls.list({
      startTimeAfter: new Date(Math.max(start.getTime(), since.getTime())),
      startTimeBefore: new Date(Math.min(end.getTime(), until.getTime())),
      pageSize: 1000,
    })
    return calls.filter((call) => {
      const startedAt = callDate(call)
      return (
        call.direction === 'inbound' &&
        startedAt !== null &&
        startedAt >= start &&
        startedAt < end &&
        startedAt >= since &&
        startedAt <= until
      )
    })
  })
  const warnings = [AVAILABILITY_WARNING]
  const inbound = [
    ...new Map(weekends.flat().map((call) => [call.sid, call])).values(),
  ]
  const checked = await mapConcurrent(inbound, 5, async (call) => {
    try {
      const events = await client
        .calls(call.sid)
        .events.list({ limit: CHILD_LIMIT })
      if (events.length === CHILD_LIMIT) {
        warnings.push(
          `Only the first ${CHILD_LIMIT} events were checked for ${call.sid}; AI identification may be incomplete.`,
        )
      }
      return hasAIEvent(events) ? call : null
    } catch {
      return 'unavailable' as const
    }
  })
  if (checked.some((value) => value === 'unavailable')) {
    warnings.push(
      'Events were unavailable for one or more calls; those calls were omitted.',
    )
  }
  const calls: VoicemailAICall[] = checked.flatMap((call) => {
    if (!call || call === 'unavailable') return []
    const startedAt = callDate(call)
    if (!startedAt) return []
    return [
      {
        sid: call.sid,
        from: call.from,
        to: call.to,
        startedAt: startedAt.toISOString(),
        status: call.status,
        duration: call.duration == null ? null : Number(call.duration),
      },
    ]
  })
  calls.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  return {
    calls,
    since: since.toISOString(),
    until: until.toISOString(),
    warnings,
  }
}

async function eligibleCall(client: TwilioClient, callSid: string, now: Date) {
  const call = await client.calls(callSid).fetch()
  const startedAt = callDate(call)
  if (
    call.direction !== 'inbound' ||
    !startedAt ||
    startedAt > now ||
    startedAt < new Date(now.getTime() - WINDOW_MS)
  )
    throw new CallNotEligibleError('Call is outside the voicemail AI log')
  const events = await client.calls(callSid).events.list({ limit: CHILD_LIMIT })
  if (!hasAIEvent(events))
    throw new CallNotEligibleError('Call is outside the voicemail AI log')
  return call
}

export async function getVoicemailAIDetail(
  credentials: Credentials,
  callSid: string,
  now = new Date(),
  client: TwilioClient = twilio(credentials.accountSid, credentials.authToken, {
    timeout: 8_000,
  }),
): Promise<VoicemailAIDetail> {
  await eligibleCall(client, callSid, now)
  const warnings = [AVAILABILITY_WARNING]
  const [notificationResult, recordingResult] = await Promise.allSettled([
    client.calls(callSid).notifications.list({ limit: CHILD_LIMIT }),
    client.calls(callSid).recordings.list({ limit: CHILD_LIMIT }),
  ])
  const notifications =
    notificationResult.status === 'fulfilled' ? notificationResult.value : []
  const recordings =
    recordingResult.status === 'fulfilled' ? recordingResult.value : []
  if (
    notifications.length === CHILD_LIMIT ||
    recordings.length === CHILD_LIMIT
  ) {
    warnings.push(
      `Only the first ${CHILD_LIMIT} notifications and recordings are shown; this call may have additional records in Twilio.`,
    )
  }
  if (notificationResult.status === 'rejected')
    warnings.push(
      'Twilio notifications were unavailable; errors may be incomplete.',
    )
  if (recordingResult.status === 'rejected')
    warnings.push('Twilio recordings were unavailable.')
  const recordingDetails = await mapConcurrent(
    recordings,
    5,
    async (recording) => {
      let transcriptions: VoicemailAIDetail['recordings'][number]['transcriptions'] =
        []
      try {
        const rows = await client
          .recordings(recording.sid)
          .transcriptions.list({ limit: CHILD_LIMIT })
        if (rows.length === CHILD_LIMIT) {
          warnings.push(
            `Only the first ${CHILD_LIMIT} transcripts are shown for ${recording.sid}.`,
          )
        }
        transcriptions = rows.map((row) => ({
          sid: row.sid,
          text: row.transcriptionText,
          status: row.status,
        }))
      } catch {
        warnings.push(
          `Transcriptions were unavailable for recording ${recording.sid}.`,
        )
      }
      transcriptions.push(
        ...(await getVoicemailAITranscripts(client, recording.sid, warnings)),
      )
      return {
        sid: recording.sid,
        duration:
          recording.duration == null ? null : Number(recording.duration),
        status: recording.status,
        transcriptions,
      }
    },
  )
  return {
    errors: notifications.map((item) => ({
      sid: item.sid,
      code: String(item.errorCode),
      message: item.messageText,
      createdAt: item.dateCreated.toISOString(),
    })),
    recordings: recordingDetails,
    warnings,
  }
}

export async function verifyRecording(
  credentials: Credentials,
  callSid: string,
  recordingSid: string,
  now = new Date(),
  client: TwilioClient = twilio(credentials.accountSid, credentials.authToken, {
    timeout: 8_000,
  }),
) {
  await eligibleCall(client, callSid, now)
  const recording = await client.recordings(recordingSid).fetch()
  if (recording.callSid !== callSid)
    throw new CallNotEligibleError('Recording does not belong to call')
}

export function recordingMediaUrl(accountSid: string, recordingSid: string) {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`
}
