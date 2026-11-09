import { getCurrentUser } from '@/lib/dal'
import { serverConfig } from '@/lib/config'
import { clearNotification } from '@/lib/lead-notifications/store'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const headers = { 'Cache-Control': 'private, no-store' }
  const user = await getCurrentUser()
  if (!user)
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  const { id } = await context.params
  if (
    !serverConfig.nutshell.notificationsEnabled ||
    !/^[1-9]\d{0,19}-leads$/.test(id)
  )
    return Response.json({ error: 'Not found' }, { status: 404, headers })
  try {
    if (!(await clearNotification(id, user.id)))
      return Response.json({ error: 'Not found' }, { status: 404, headers })
    return Response.json({ success: true }, { headers })
  } catch {
    return Response.json(
      { error: 'Notifications unavailable' },
      { status: 503, headers },
    )
  }
}
