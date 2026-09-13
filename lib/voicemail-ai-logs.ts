import { createHmac, timingSafeEqual } from 'node:crypto'
import twilio from 'twilio'
import { z } from 'zod'
import { getVoicemailAITranscripts } from './voicemail-ai-transcripts'
import type {
  VoicemailAICall,
  VoicemailAIDetail,
  VoicemailAIPage,
} from './voicemail-ai-log-types'

export const AI_HOSTNAME = 'voicemail-agent.john22n-iii.com'
export const CALL_SID = /^CA[0-9a-fA-F]{32}$/
export const RECORDING_SID = /^RE[0-9a-fA-F]{32}$/
const PAGE_SIZE = 50
const CHILD_LIMIT = 100
const WINDOW_MS = 21 * 24 * 60 * 60 * 1000
const AVAILABILITY_WARNING =
  'Twilio Call Events can take up to 15 minutes after a call ends to appear and are retained for only 30 days; recent or unavailable events can cause calls to be omitted.'

type Credentials = { accountSid: string; authToken: string }
type TwilioClient = ReturnType<typeof twilio>

export class InvalidCursorError extends Error {}
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

function cursorSignature(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function encodeCursor(
  data: { pageToken: string; since: string; until: string },
  secret: string,
) {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  return `${payload}.${cursorSignature(payload, secret)}`
}

const cursorSchema = z.object({
  pageToken: z.string().min(1),
  since: z.string().datetime(),
  until: z.string().datetime(),
})

function decodeCursor(cursor: string, secret: string) {
  try {
    const [payload, signature, extra] = cursor.split('.')
    const expected = cursorSignature(payload, secret)
    if (
      extra ||
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new Error('bad signature')
    }
    return cursorSchema.parse(
      JSON.parse(Buffer.from(payload, 'base64url').toString()),
    )
  } catch {
    throw new InvalidCursorError('Invalid cursor')
  }
}

function pageToken(nextPageUrl?: string) {
  if (!nextPageUrl) return null
  try {
    const url = new URL(nextPageUrl, 'https://api.twilio.com')
    if (url.hostname !== 'api.twilio.com') return null
    return url.searchParams.get('PageToken')
  } catch {
    return null
  }
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
  cursor: string | null,
  now = new Date(),
  client: TwilioClient = twilio(credentials.accountSid, credentials.authToken, {
    timeout: 8_000,
  }),
): Promise<VoicemailAIPage> {
  const range = cursor
    ? decodeCursor(cursor, credentials.authToken)
    : {
        pageToken: undefined,
        since: new Date(now.getTime() - WINDOW_MS).toISOString(),
        until: now.toISOString(),
      }
  const page = await client.calls.page({
    startTimeAfter: new Date(range.since),
    startTimeBefore: new Date(range.until),
    pageSize: PAGE_SIZE,
    pageToken: range.pageToken,
  })
  // Defensively enforce the exact rolling timestamps before making the more
  // expensive Events requests, even if provider filtering changes.
  const since = new Date(range.since)
  const until = new Date(range.until)
  const warnings = [AVAILABILITY_WARNING]
  const inbound = page.instances.filter((call) => {
    const startedAt = callDate(call)
    return (
      call.direction === 'inbound' &&
      startedAt !== null &&
      startedAt >= since &&
      startedAt <= until
    )
  })
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
  const token = pageToken(page.nextPageUrl)
  return {
    calls,
    nextCursor: token
      ? encodeCursor(
          { pageToken: token, since: range.since, until: range.until },
          credentials.authToken,
        )
      : null,
    since: range.since,
    until: range.until,
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
