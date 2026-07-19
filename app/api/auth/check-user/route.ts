import { NextResponse } from 'next/server'

// Account-existence preflights enable user enumeration. Authentication flows
// now proceed without revealing whether an email or passkey is registered.
export async function POST() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
