import { NextRequest, NextResponse } from 'next/server'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'
import { clearMonthlyOpenAILogs } from '@/lib/dal'
import { clearExpiredRateLimits } from '@/lib/rate-limit'

export async function GET(request: NextRequest) {
  let cronSecret: string
  try {
    cronSecret = serverConfig.cron.requireSecret()
  } catch (error) {
    if (isMissingConfig(error)) {
      return NextResponse.json(configErrorResponseBody(error), { status: 500 })
    }
    throw error
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [deletedCount, deletedRateLimitBuckets] = await Promise.all([
    clearMonthlyOpenAILogs(),
    clearExpiredRateLimits(),
  ])

  return NextResponse.json({
    success: true,
    deletedCount,
    deletedRateLimitBuckets,
    clearedBefore: new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString(),
  })
}
