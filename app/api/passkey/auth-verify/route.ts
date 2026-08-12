import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSession } from '@/lib/auth'
import { verifyPasskeyAuthentication } from '@/lib/passkey'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { AuthenticationResponseJSON } from '@simplewebauthn/types'
import { rateLimit, unauthenticatedRateLimitIdentities } from '@/lib/rate-limit'
import { z } from 'zod'

const requestSchema = z.object({
  response: z
    .object({
      id: z.string().min(1).max(2048),
      rawId: z.string().min(1).max(2048),
      type: z.literal('public-key'),
      response: z.object({
        clientDataJSON: z.string().min(1).max(16_384),
        authenticatorData: z.string().min(1).max(16_384),
        signature: z.string().min(1).max(16_384),
        userHandle: z.string().max(2048).optional(),
      }),
      clientExtensionResults: z.record(z.unknown()).optional(),
      authenticatorAttachment: z.string().max(64).optional(),
    })
    .passthrough(),
})

/**
 * POST /api/passkey/auth-verify
 *
 * Verifies a WebAuthn authentication response and creates a session.
 *
 * Body: { response: AuthenticationResponseJSON }
 */
export async function POST(request: NextRequest) {
  try {
    let input: unknown
    try {
      input = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const body = requestSchema.safeParse(input)
    if (!body.success) {
      return NextResponse.json(
        { error: 'Missing authentication response' },
        { status: 400 },
      )
    }

    // Get the stored challenge before consuming an attempt.
    const cookieStore = await cookies()
    const challenge = cookieStore.get('passkey_auth_challenge')?.value
    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge expired or not found. Please try again.' },
        { status: 400 },
      )
    }

    const identity = await unauthenticatedRateLimitIdentities()
    const attempt = await rateLimit(
      'passkey-verify',
      identity.source,
      10,
      10 * 60,
    )
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
        },
      )
    }

    const response = body.data.response as unknown as AuthenticationResponseJSON

    // Verify the authentication
    const result = await verifyPasskeyAuthentication(response, challenge)

    // Clear the challenge cookie
    cookieStore.delete('passkey_auth_challenge')

    if (!result) {
      return NextResponse.json({ error: 'Passkey not found' }, { status: 400 })
    }

    if (!result.verification.verified) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 400 },
      )
    }

    // Get user info to create session
    const [userData] = await db
      .select({ id: user.id, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, result.userId))
      .limit(1)

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 400 })
    }

    // Create session (sets the auth cookie)
    await createSession(userData.id, userData.email, userData.role ?? 'user')

    return NextResponse.json({
      verified: true,
      message: 'Authenticated successfully',
    })
  } catch {
    console.error('Error verifying authentication')
    return NextResponse.json(
      { error: 'Failed to verify authentication' },
      { status: 500 },
    )
  }
}
