import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPasskeysByUserId } from '@/lib/passkey'

/**
 * GET /api/passkey/list
 *
 * Lists all passkeys for the current user.
 */
export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const passkeys = await getPasskeysByUserId(session.userId)

    // Return sanitized passkey info (no sensitive data)
    const safePasskeys = passkeys.map((p) => ({
      id: p.id,
      name: p.name,
      deviceType: p.deviceType,
      createdAt: p.createdAt,
    }))

    return NextResponse.json({ passkeys: safePasskeys })
  } catch (error) {
    console.error('Error listing passkeys:', error)
    return NextResponse.json(
      { error: 'Failed to list passkeys' },
      { status: 500 }
    )
  }
}
