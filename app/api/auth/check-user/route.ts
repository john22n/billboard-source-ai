import { NextRequest, NextResponse } from 'next/server'
import { getUserByEmail, getPasskeysByUserId } from '@/lib/passkey'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email) {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      )
    }

    const user = await getUserByEmail(email)

    if (!user) {
      return NextResponse.json(
        { exists: false, hasPasskeys: false },
        { status: 200 }
      )
    }

    const passkeys = await getPasskeysByUserId(user.id)

    return NextResponse.json({
      exists: true,
      hasPasskeys: passkeys.length > 0,
    })
  } catch (error) {
    console.error('Error checking user:', error)
    return NextResponse.json(
      { error: 'Failed to check user' },
      { status: 500 }
    )
  }
}
