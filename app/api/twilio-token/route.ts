// app/api/twilio-token/route.ts
// Generates Twilio access token for Voice SDK
//
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession, TWILIO_TOKEN_SESSION_COOKIE } from '@/lib/auth'
import twilio from 'twilio'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant

export async function GET() {
  // ✅ SECURITY: Require authentication
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json(
      { error: 'Unauthorized - Please log in' },
      { status: 401 },
    )
  }

  // Use authenticated user's email instead of query param
  const email = session.email

  if (!email) {
    return NextResponse.json(
      { error: 'User email not found in session' },
      { status: 400 },
    )
  }

  const cookieStore = await cookies()
  if (
    session.sessionId &&
    cookieStore.get(TWILIO_TOKEN_SESSION_COOKIE)?.value === session.sessionId
  ) {
    return NextResponse.json(
      {
        error: 'Twilio session already started. Please log in again.',
        code: 'TWILIO_TOKEN_ALREADY_ISSUED',
      },
      { status: 409 },
    )
  }

  let credentials: ReturnType<
    typeof serverConfig.twilio.requireVoiceCredentials
  >
  try {
    credentials = serverConfig.twilio.requireVoiceCredentials()
  } catch (error) {
    if (!isMissingConfig(error)) throw error
    return NextResponse.json(configErrorResponseBody(error), { status: 500 })
  }

  // Create access token
  const token = new AccessToken(
    credentials.accountSid,
    credentials.apiKeySid,
    credentials.apiKeySecret,
    {
      identity: email, // Use authenticated user's email
      ttl: 60 * 60 * 8, // Match the app's fixed eight-hour login session
    },
  )

  // Create a Voice grant
  const voiceGrant = new VoiceGrant({
    incomingAllow: true, // Allow incoming calls
  })

  token.addGrant(voiceGrant)

  console.log(`🔐 Twilio token generated for authenticated user: ${email}`)

  const response = NextResponse.json({
    token: token.toJwt(),
    identity: email,
  })
  response.cookies.set({
    name: TWILIO_TOKEN_SESSION_COOKIE,
    value: session.sessionId,
    httpOnly: true,
    secure: serverConfig.auth.secureCookies,
    path: '/',
    sameSite: 'lax',
  })
  return response
}
