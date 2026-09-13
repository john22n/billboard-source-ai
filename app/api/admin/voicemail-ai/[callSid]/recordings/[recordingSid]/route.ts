import { NextResponse } from 'next/server'
import { adminAuthorizationError } from '../../../../../../../lib/admin-api'
import { serverConfig } from '@/lib/config'
import {
  CALL_SID,
  CallNotEligibleError,
  RECORDING_SID,
  recordingMediaUrl,
  verifyRecording,
} from '@/lib/voicemail-ai-logs'

export async function GET(
  request: Request,
  context: { params: Promise<{ callSid: string; recordingSid: string }> },
) {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  const { callSid, recordingSid } = await context.params
  if (!CALL_SID.test(callSid) || !RECORDING_SID.test(recordingSid)) {
    return NextResponse.json({ error: 'Invalid SID' }, { status: 400 })
  }
  try {
    const credentials = serverConfig.twilio.requireAccountCredentials()
    await verifyRecording(credentials, callSid, recordingSid)
    const headers: HeadersInit = {
      Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`,
    }
    const range = request.headers.get('range')
    if (range) headers.Range = range
    const upstream = await fetch(
      recordingMediaUrl(credentials.accountSid, recordingSid),
      {
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: 'Recording audio unavailable' },
        { status: upstream.status === 404 ? 404 : 502 },
      )
    }
    const responseHeaders = new Headers({
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'X-Content-Type-Options': 'nosniff',
    })
    for (const name of ['accept-ranges', 'content-length', 'content-range']) {
      const value = upstream.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    if (error instanceof CallNotEligibleError)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('Failed to proxy voicemail AI recording')
    return NextResponse.json(
      { error: 'Failed to fetch recording audio' },
      { status: 502 },
    )
  }
}
