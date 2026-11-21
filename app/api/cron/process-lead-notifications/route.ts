import { serverConfig } from '@/lib/config'
import { processLeadNotifications } from '@/lib/lead-notifications/processor'
import { secretsMatch } from '@/lib/lead-notifications/store'

export const runtime = 'nodejs'
export const maxDuration = 30
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = serverConfig.cron.secret
  const headers = { 'Cache-Control': 'no-store' }
  if (!secret)
    return Response.json(
      { error: 'Retry unavailable' },
      { status: 503, headers },
    )
  if (
    !secretsMatch(
      request.headers.get('authorization') ?? '',
      `Bearer ${secret}`,
    )
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    return Response.json(await processLeadNotifications(), { headers })
  } catch {
    return Response.json(
      { error: 'Retry unavailable' },
      { status: 503, headers },
    )
  }
}
