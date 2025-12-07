import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { deletePasskey, getPasskeysByUserId } from '@/lib/passkey'

/**
 * POST /api/passkey/delete
 *
 * Deletes a passkey for the current user.
 * Body: { passkeyId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { passkeyId } = body as { passkeyId: string }

    if (!passkeyId) {
      return NextResponse.json(
        { error: 'Missing passkeyId' },
        { status: 400 }
      )
    }

    // Verify the passkey belongs to this user
    const userPasskeys = await getPasskeysByUserId(session.userId)
    const passkeyToDelete = userPasskeys.find((p) => p.id === passkeyId)

    if (!passkeyToDelete) {
      return NextResponse.json(
        { error: 'Passkey not found' },
        { status: 404 }
      )
    }

    await deletePasskey(passkeyId)

    return NextResponse.json({
      success: true,
      message: 'Passkey deleted successfully',
    })
  } catch (error) {
    console.error('Error deleting passkey:', error)
    return NextResponse.json(
      { error: 'Failed to delete passkey' },
      { status: 500 }
    )
  }
}
