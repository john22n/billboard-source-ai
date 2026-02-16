import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSession } from '@/lib/auth'
import { verifyPasskeyAuthentication } from '@/lib/passkey'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import type { AuthenticationResponseJSON } from '@simplewebauthn/types'

/**
 * POST /api/passkey/auth-verify
 *
 * Verifies a WebAuthn authentication response and creates a session.
 *
 * Body: { response: AuthenticationResponseJSON }
 */
export async function POST(request: NextRequest) {
  try {
    // Get the stored challenge
    const cookieStore = await cookies()
    const challenge = cookieStore.get('passkey_auth_challenge')?.value

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge expired or not found. Please try again.' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { response } = body as { response: AuthenticationResponseJSON }

    if (!response) {
      return NextResponse.json(
        { error: 'Missing authentication response' },
        { status: 400 }
      )
    }

    // Verify the authentication
    const result = await verifyPasskeyAuthentication(response, challenge)

    // Clear the challenge cookie
    cookieStore.delete('passkey_auth_challenge')

    if (!result) {
      return NextResponse.json(
        { error: 'Passkey not found' },
        { status: 400 }
      )
    }

    if (!result.verification.verified) {
      return NextResponse.json(
        { error: 'Authentication failed' },
        { status: 400 }
      )
    }

    // Get user info to create session
    const [userData] = await db
      .select({ id: user.id, email: user.email, role: user.role })
      .from(user)
      .where(eq(user.id, result.userId))
      .limit(1)

    if (!userData) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 400 }
      )
    }

    // Create session (sets the auth cookie)
    await createSession(userData.id, userData.email, userData.role ?? 'user')

    return NextResponse.json({
      verified: true,
      message: 'Authenticated successfully',
    })
  } catch (error) {
    console.error('Error verifying authentication:', error)
    return NextResponse.json(
      { error: 'Failed to verify authentication' },
      { status: 500 }
    )
  }
}
