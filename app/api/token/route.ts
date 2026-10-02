import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createPendingLog } from '@/lib/dal'
import {
  REALTIME_TRANSCRIPTION_MODEL,
  transcriptionSession,
} from '@/lib/openai-transcription'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  try {
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json(
        { error: 'Unauthorized - Please log in' },
        { status: 401 },
      )
    }
    const attempt = await rateLimit('openai-token', session.userId, 10, 60)
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
        },
      )
    }

    const openaiApiKey = serverConfig.openai.requireApiKey()

    const response = await fetch(
      'https://api.openai.com/v1/realtime/client_secrets',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session: transcriptionSession(),
        }),
      },
    )

    if (!response.ok) {
      console.error('OpenAI token request failed with status:', response.status)
      return NextResponse.json(
        { error: 'Failed to generate token' },
        { status: 502 },
      )
    }

    const data = await response.json()
    const sessionId = data.session?.id || data.id || 'unknown'

    // Create pending log entry
    const logEntry = await createPendingLog(
      session.userId,
      sessionId,
      REALTIME_TRANSCRIPTION_MODEL,
    )

    // Return the correct structure
    return NextResponse.json({
      value: data.value,
      session_id: sessionId,
      logId: logEntry.id,
      model: REALTIME_TRANSCRIPTION_MODEL,
      expires_at: data.expires_at,
    })
  } catch (error) {
    if (isMissingConfig(error)) {
      return NextResponse.json(configErrorResponseBody(error), { status: 500 })
    }
    console.error('Token generation failed')
    return NextResponse.json(
      { error: 'Failed to generate token' },
      { status: 500 },
    )
  }
}
