import { NextResponse } from 'next/server'
import { adminAuthorizationError } from '../../../../../lib/admin-api'
import { serverConfig } from '@/lib/config'
import {
  CALL_SID,
  CallNotEligibleError,
  getVoicemailAIDetail,
} from '@/lib/voicemail-ai-logs'

export async function GET(
  _request: Request,
  context: { params: Promise<{ callSid: string }> },
) {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  const { callSid } = await context.params
  if (!CALL_SID.test(callSid))
    return NextResponse.json({ error: 'Invalid call SID' }, { status: 400 })
  try {
    const credentials = serverConfig.twilio.requireAccountCredentials()
    return NextResponse.json(await getVoicemailAIDetail(credentials, callSid), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    if (error instanceof CallNotEligibleError)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    console.error('Failed to fetch voicemail AI call detail')
    return NextResponse.json(
      { error: 'Failed to fetch voicemail AI call detail' },
      { status: 502 },
    )
  }
}
