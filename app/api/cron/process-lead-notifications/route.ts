import { createHash, timingSafeEqual } from 'node:crypto'
import { serverConfig } from '@/lib/config'
import { processLeadNotifications } from '@/lib/lead-notifications/processor'

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
  const digest = (value: string) => createHash('sha256').update(value).digest()
  if (
    !timingSafeEqual(
      digest(request.headers.get('authorization') ?? ''),
      digest(`Bearer ${secret}`),
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
