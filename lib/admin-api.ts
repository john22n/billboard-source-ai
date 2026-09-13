import { getSession } from '@/lib/auth'

export async function adminAuthorizationError(): Promise<Response | null> {
  const session = await getSession()
  if (!session?.userId)
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin')
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  return null
}
