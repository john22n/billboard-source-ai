// app/api/twilio-token/route.ts
// Generates Twilio access token for Voice SDK
//
export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import twilio from 'twilio'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'
import { rateLimit } from '@/lib/rate-limit'

const AccessToken = twilio.jwt.AccessToken
const VoiceGrant = AccessToken.VoiceGrant
const LOGIN_SESSION_SECONDS = 60 * 60 * 8.5

export async function GET() {
  // ✅ SECURITY: Require authentication
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json(
      { error: 'Unauthorized - Please log in' },
      { status: 401 },
    )
  }
  const attempt = await rateLimit('twilio-token', session.userId, 20, 60)
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
      },
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

  let credentials: ReturnType<
    typeof serverConfig.twilio.requireVoiceCredentials
  >
  try {
    credentials = serverConfig.twilio.requireVoiceCredentials()
  } catch (error) {
    if (!isMissingConfig(error)) throw error
    return NextResponse.json(configErrorResponseBody(error), { status: 500 })
  }

  const sessionExpiresAt = session.issuedAt + LOGIN_SESSION_SECONDS
  const tokenTtl = Math.max(1, Math.floor(sessionExpiresAt - Date.now() / 1000))

  // Create access token
  const token = new AccessToken(
    credentials.accountSid,
    credentials.apiKeySid,
    credentials.apiKeySecret,
    {
      identity: email, // Use authenticated user's email
      // Reloads may issue a replacement token, but it cannot outlive the login.
      ttl: tokenTtl,
    },
  )

  // Create a Voice grant
  const voiceGrant = new VoiceGrant({
    incomingAllow: true, // Allow incoming calls
  })

  token.addGrant(voiceGrant)

  return NextResponse.json(
    {
      token: token.toJwt(),
      identity: email,
      expiresAt: sessionExpiresAt,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, max-age=0',
      },
    },
  )
}
