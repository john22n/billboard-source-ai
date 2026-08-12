import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { extendSessionForCall, getSession } from '@/lib/auth'
import { serverConfig } from '@/lib/config'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { callSid } = (await request.json()) as { callSid?: unknown }
  if (typeof callSid !== 'string' || !/^CA[0-9a-f]{32}$/i.test(callSid)) {
    return NextResponse.json({ error: 'Invalid call' }, { status: 400 })
  }
  if (session.activeCallSid === callSid) {
    return NextResponse.json({ success: true })
  }

  const { accountSid, authToken } =
    serverConfig.twilio.requireAccountCredentials()
  const call = await twilio(accountSid, authToken).calls(callSid).fetch()
  const belongsToUser =
    call.status === 'in-progress' && call.to === `client:${session.email}`
  if (!belongsToUser) {
    return NextResponse.json({ error: 'Call is not active' }, { status: 403 })
  }

  const extended = await extendSessionForCall(session, callSid)
  if (!extended) {
    return NextResponse.json(
      { error: 'Failed to extend call session' },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true })
}
