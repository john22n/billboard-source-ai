import { createHash, timingSafeEqual } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/db'
import { leadNotifications, user } from '@/db/schema'
import { serverConfig } from '@/lib/config'

export const leadIdPattern = /^[1-9]\d{0,19}-leads$/

export function isLeadId(value: string) {
  return leadIdPattern.test(value)
}

export function secretsMatch(provided: string, expected: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(provided), digest(expected))
}

export type StreamSession = {
  token: string
  accountId: string
  localOptIn: boolean
}

export async function canStreamSession(session: StreamSession) {
  const { verifyJWT } = await import('@/lib/auth')
  const identity = await verifyJWT(session.token)
  if (identity?.userId !== session.accountId) return false
  const db = await getDb()
  const [account] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, session.accountId))
  return Boolean(
    account &&
    serverConfig.leadNotifications.canStream(account.email, session.localOptIn),
  )
}

export async function listNotifications(recipientId: string) {
  const db = await getDb()
  return db
    .select({
      id: leadNotifications.id,
      companyName: leadNotifications.companyName,
      leadUrl: leadNotifications.leadUrl,
      leadCreatedAt: leadNotifications.leadCreatedAt,
      createdAt: leadNotifications.createdAt,
    })
    .from(leadNotifications)
    .where(
      and(
        eq(leadNotifications.recipientId, recipientId),
        isNull(leadNotifications.clearedAt),
      ),
    )
    .orderBy(asc(leadNotifications.leadCreatedAt), asc(leadNotifications.id))
}

export async function clearNotification(id: string, recipientId: string) {
  if (!isLeadId(id)) return false
  const db = await getDb()
  const rows = await db
    .update(leadNotifications)
    .set({ clearedAt: sql`coalesce(${leadNotifications.clearedAt}, now())` })
    .where(
      and(
        eq(leadNotifications.id, id),
        eq(leadNotifications.recipientId, recipientId),
      ),
    )
    .returning()
  return rows.length === 1
}
