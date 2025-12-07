import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth'
import { verifyPasskeyRegistration } from '@/lib/passkey'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'

/**
 * POST /api/passkey/register-verify
 *
 * Verifies a WebAuthn registration response and saves the passkey.
 * User must be authenticated.
 *
 * Body: { response: RegistrationResponseJSON, name?: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get the stored challenge
    const cookieStore = await cookies()
    const challenge = cookieStore.get('passkey_challenge')?.value

    if (!challenge) {
      return NextResponse.json(
        { error: 'Challenge expired or not found. Please try again.' },
        { status: 400 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { response, name } = body as {
      response: RegistrationResponseJSON
      name?: string
    }

    if (!response) {
      return NextResponse.json(
        { error: 'Missing registration response' },
        { status: 400 }
      )
    }

    // Verify the registration
    const verification = await verifyPasskeyRegistration(
      session.userId,
      response,
      challenge,
      name
    )

    // Clear the challenge cookie
    cookieStore.delete('passkey_challenge')

    if (verification.verified) {
      return NextResponse.json({
        verified: true,
        message: 'Passkey registered successfully',
      })
    } else {
      return NextResponse.json(
        { error: 'Verification failed' },
        { status: 400 }
      )
    }
  } catch (error) {
    console.error('Error verifying registration:', error)
    return NextResponse.json(
      { error: 'Failed to verify registration' },
      { status: 500 }
    )
  }
}
