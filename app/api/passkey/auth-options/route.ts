import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { serverConfig } from '@/lib/config'
import { generatePasskeyAuthenticationOptions } from '@/lib/passkey'
import { rateLimit, unauthenticatedRateLimitIdentities } from '@/lib/rate-limit'
import { z } from 'zod'

const requestSchema = z.object({}).strict()

class AuthOptionsError extends Error {
  constructor(readonly response: NextResponse) {
    super('Authentication options request rejected')
  }
}

function invalidRequest(): never {
  throw new AuthOptionsError(
    NextResponse.json({ error: 'Invalid request' }, { status: 400 }),
  )
}

async function validateRequestBody(request: NextRequest) {
  const rawBody = await request.text()
  let input: unknown = {}
  if (rawBody.trim()) {
    try {
      input = JSON.parse(rawBody)
    } catch {
      invalidRequest()
    }
  }
  if (!requestSchema.safeParse(input).success) invalidRequest()
}

async function enforceSourceLimit() {
  const { source } = await unauthenticatedRateLimitIdentities()
  const attempt = await rateLimit('passkey-source', source, 30, 10 * 60)
  if (!attempt.allowed) {
    throw new AuthOptionsError(
      NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
        },
      ),
    )
  }
}

/**
 * POST /api/passkey/auth-options
 *
 * Generates usernameless WebAuthn authentication options. Not accepting an
 * email here prevents the options response from becoming an account oracle.
 *
 * Body: {}
 */
export async function POST(request: NextRequest) {
  try {
    // An empty body is valid for discoverable-credential authentication.
    await validateRequestBody(request)
    await enforceSourceLimit()
    // Generate authentication options
    const options = await generatePasskeyAuthenticationOptions()

    // Store challenge in cookie for verification
    const cookieStore = await cookies()
    cookieStore.set({
      name: 'passkey_auth_challenge',
      value: options.challenge,
      httpOnly: true,
      secure: serverConfig.auth.secureCookies,
      maxAge: 60 * 5, // 5 minutes
      path: '/',
      sameSite: 'strict',
    })

    return NextResponse.json(options)
  } catch (error) {
    if (error instanceof AuthOptionsError) return error.response
    console.error('Error generating authentication options')
    return NextResponse.json(
      { error: 'Failed to generate authentication options' },
      { status: 500 },
    )
  }
}
