import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth'
import { generatePasskeyRegistrationOptions } from '@/lib/passkey'

/**
 * POST /api/passkey/register-options
 *
 * Generates WebAuthn registration options for the current user.
 * User must be authenticated to register a passkey.
 */
export async function POST() {
  try {
    // Require authentication
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Generate registration options
    const options = await generatePasskeyRegistrationOptions(
      session.userId,
      session.email
    )

    // Store challenge in cookie for verification
    // This prevents replay attacks
    const cookieStore = await cookies()
    cookieStore.set({
      name: 'passkey_challenge',
      value: options.challenge,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 5, // 5 minutes
      path: '/',
      sameSite: 'strict',
    })

    return NextResponse.json(options)
  } catch (error) {
    console.error('Error generating registration options:', error)
    return NextResponse.json(
      { error: 'Failed to generate registration options' },
      { status: 500 }
    )
  }
}
