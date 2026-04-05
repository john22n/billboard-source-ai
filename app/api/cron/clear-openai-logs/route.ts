import { NextRequest, NextResponse } from 'next/server'
import { clearMonthlyOpenAILogs } from '@/lib/dal'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deletedCount = await clearMonthlyOpenAILogs()

  return NextResponse.json({
    success: true,
    deletedCount,
    clearedBefore: new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString(),
  })
}
