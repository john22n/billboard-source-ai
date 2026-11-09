import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { leadNotifications } from '@/db/schema'

export async function listNotifications(recipientId: string) {
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
