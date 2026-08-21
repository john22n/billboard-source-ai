import { NextRequest, NextResponse } from 'next/server'
import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'
import { isMarketDataSyncTime, syncLatestMarketData } from '@/lib/market-data'

export const dynamic = 'force-dynamic'
export const maxDuration = 800

async function syncMarketDataWhenScheduled() {
  // Vercel cron schedules use UTC. The route runs at both possible UTC hours
  // for 11 PM Central and skips the invocation that does not match CST/CDT.
  if (!isMarketDataSyncTime()) {
    return NextResponse.json({ success: true, skipped: true })
  }

  const result = await syncLatestMarketData(
    serverConfig.marketData.requireApiKey(),
    serverConfig.openai.requireApiKey(),
  )
  console.log(
    `Synced ${result.syncedRecordCount} billboard market records from ${result.sourceRecordCount} source rows`,
  )
  return NextResponse.json({ success: true, ...result })
}

export async function GET(request: NextRequest) {
  try {
    const cronSecret = serverConfig.cron.requireSecret()
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await syncMarketDataWhenScheduled()
  } catch (error) {
    if (isMissingConfig(error)) {
      return NextResponse.json(configErrorResponseBody(error), { status: 500 })
    }
    console.error('Failed to sync billboard market data')
    return NextResponse.json(
      { error: 'Failed to sync billboard market data' },
      { status: 500 },
    )
  }
}
