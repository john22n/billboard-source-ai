import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function connectionErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown connection error'
  return error.cause instanceof Error ? error.cause.message : error.message
}

// Preview deployment protection controls access. Never expose a production
// probe or return database names, credentials, or application data.
export async function GET() {
  if (
    process.env.VERCEL_ENV !== 'preview' ||
    !process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME?.trim()
  ) {
    return new NextResponse(null, { status: 404 })
  }

  try {
    const { db } = await import('@/db')
    await db.execute(sql`SELECT 1`)
    return NextResponse.json(
      { connected: true },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // Log only the message, not SDK request objects containing auth headers.
    console.error(
      'Cloud SQL Preview probe failed:',
      connectionErrorMessage(error),
    )
    return NextResponse.json(
      { connected: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
