import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createPendingLog } from '@/lib/dal'
import { REALTIME_TRANSCRIPTION_MODEL } from '@/lib/openai-pricing'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'
import { rateLimit } from '@/lib/rate-limit'

export async function GET() {
  const instructions = `
You are transcribing a live sales call in real time.
Your tasks:
- Accurately transcribe everything said by both speakers.
- Identify and label speakers clearly (e.g., "Sales Rep:", "Customer:").
- Update form fields dynamically as the conversation progresses, based on what is being discussed.
- Use JSON updates to represent progress (e.g., {"field": "customer_needs", "value": "They are interested in premium support"}).
- Do NOT summarize — keep context incremental.
- Use Spanish ("es") for transcription text if the call is in Spanish.
`.trim()

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
          session: {
            type: 'transcription',
            audio: {
              input: {
                transcription: {
                  language: 'en',
                  model: 'gpt-4o-transcribe',
                  prompt: instructions,
                },
                noise_reduction: {
                  type: 'near_field',
                },
              },
            },
          },
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
