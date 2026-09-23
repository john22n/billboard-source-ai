import { NextResponse } from 'next/server'
import { adminAuthorizationError } from '../../../../lib/admin-api'
import { serverConfig } from '@/lib/config'
import { listVoicemailAICalls } from '@/lib/voicemail-ai-logs'

export async function GET() {
  const denied = await adminAuthorizationError()
  if (denied) return denied
  try {
    const credentials = serverConfig.twilio.requireAccountCredentials()
    return NextResponse.json(await listVoicemailAICalls(credentials), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch {
    console.error('Failed to fetch voicemail AI calls')
    return NextResponse.json(
      { error: 'Failed to fetch voicemail AI calls' },
      { status: 502 },
    )
  }
}
