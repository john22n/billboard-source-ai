import { NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'

export async function POST() {
  try {
    await deleteSession()
    return NextResponse.json({ success: true })
  } catch {
    console.error('Logout failed')
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 })
  }
}
