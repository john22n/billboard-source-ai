import { NextResponse } from 'next/server'

// Retired endpoint: also block older open tabs from attaching to existing leads.
export function GET() {
  return NextResponse.json(
    {
      error:
        'Mockups can only be sent when creating a new Nutshell lead through the Lead Form.',
    },
    { status: 410 },
  )
}

export const POST = GET
