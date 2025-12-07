import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generatePasskeyAuthenticationOptions } from '@/lib/passkey'

/**
 * POST /api/passkey/auth-options
 *
 * Generates WebAuthn authentication options.
 * Can optionally filter to a specific user's passkeys if email is provided.
 *
 * Body: { email?: string }
 */
export async function POST(request: NextRequest) {
  try {
    // Parse optional email from body
    let email: string | undefined
    try {
      const body = await request.json()
      email = body.email
    } catch {
      // No body or invalid JSON, that's fine for usernameless auth
    }

    // Generate authentication options
    const options = await generatePasskeyAuthenticationOptions(email)

    // Store challenge in cookie for verification
    const cookieStore = await cookies()
    cookieStore.set({
      name: 'passkey_auth_challenge',
      value: options.challenge,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 5, // 5 minutes
      path: '/',
      sameSite: 'strict',
    })

    return NextResponse.json(options)
  } catch (error) {
    console.error('Error generating authentication options:', error)
    return NextResponse.json(
      { error: 'Failed to generate authentication options' },
      { status: 500 }
    )
  }
}
