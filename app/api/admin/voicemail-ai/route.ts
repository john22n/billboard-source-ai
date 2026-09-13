import { NextResponse } from 'next/server'
import { adminAuthorizationError } from '../../../../lib/admin-api'
import { serverConfig } from '@/lib/config'
import {
  InvalidCursorError,
  listVoicemailAICalls,
} from '@/lib/voicemail-ai-logs'

export async function GET(request: Request) {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  try {
    const credentials = serverConfig.twilio.requireAccountCredentials()
    const cursor = new URL(request.url).searchParams.get('cursor')
    return NextResponse.json(await listVoicemailAICalls(credentials, cursor), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    if (error instanceof InvalidCursorError)
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
    console.error('Failed to fetch voicemail AI calls')
    return NextResponse.json(
      { error: 'Failed to fetch voicemail AI calls' },
      { status: 502 },
    )
  }
}
