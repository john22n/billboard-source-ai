import { getCurrentUser } from '@/lib/dal'
import { serverConfig } from '@/lib/config'
import { listNotifications } from '@/lib/lead-notifications/store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' }
  const user = await getCurrentUser()
  if (!user)
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const notifications = serverConfig.nutshell.notificationsEnabled
      ? await listNotifications(user.id)
      : []
    return Response.json(
      { notifications, userId: user.id, serverTime: new Date().toISOString() },
      { headers },
    )
  } catch {
    return Response.json(
      { error: 'Notifications unavailable' },
      { status: 503, headers },
    )
  }
}
