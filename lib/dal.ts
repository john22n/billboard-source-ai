import { db } from '@/db'
import { getSession } from './auth'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { cache } from 'react'
import { openaiLogs, user } from '@/db/schema'


export const getCurrentUser = cache(async () => {
  const session = await getSession()
  if (!session) return null

  // skip database query during prerendering if we dont have a session
  // hack until we have PPR http://nextjs.org/docs/app/buidling-your-application/rendering/parital-prerendering
  if (typeof window == 'undefined' && process.env.NEXT_PHASE === 'phase-production-build') return null

  try {
    const result = await db
      .select()
      .from(user)
      .where(eq(user.id, session.userId))
    return result[0] || null
  } catch (error) {
    console.error('Error getting user by ID:', error)
    return null
  }
})

export const getUserByEmail = cache(async (email: string) => {
  try {
    const result = await db.select().from(user).where(eq(user.email, email))
    return result[0] || null
  } catch (error) {
    console.error('Error getting user by email', error)
    return null
  }
})


export async function createPendingLog(userId: string, sessionId: string) {
  const [logEntry] = await db
    .insert(openaiLogs)
    .values({
      userId,
      model: 'gpt-4o-transcribe',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: "0.000000",
      sessionId,
      status: "pending"
    })
    .returning();
  
  return logEntry;
}

export async function getAllUsers() {
  return await db.select().from(user);
}

export async function deleteUsersByIds(ids: string[]) {
  return await db.delete(user).where(inArray(user.id, ids));
}

export async function updateUserTwilioPhone(userId: string, twilioPhoneNumber: string | null) {
  const result = await db
    .update(user)
    .set({ twilioPhoneNumber })
    .where(eq(user.id, userId))
    .returning();
  return result[0] || null;
}

export async function getUserCosts() {
  return await db
    .select({
      id: user.id,
      email: user.email,
      cost: sql<number>`COALESCE(SUM(CAST(${openaiLogs.cost} AS NUMERIC)), 0)`.as('cost')
    })
    .from(user)
    .leftJoin(openaiLogs, eq(user.id, openaiLogs.userId))
    .groupBy(user.id, user.email)
    .orderBy(user.email);
}

export async function updateLogCost(
  logId: number,
  userId: string,
  durationSeconds: number
) {
 
  const durationMinutes = durationSeconds / 60;
  const actualCost = durationMinutes * 0.06;

  const result = await db
    .update(openaiLogs)
    .set({
      totalTokens: Math.round(durationSeconds), 
      cost: actualCost.toFixed(6),
      status: "completed"
    })
    .where(
      and(
        eq(openaiLogs.id, logId),
        eq(openaiLogs.userId, userId)
      )
    )
    .returning();

  return result[0] || null;
}

export async function promoteToAdmin(email: string) {
  const result = await db
    .update(user)
    .set({ role: 'admin' })
    .where(eq(user.email, email))
    .returning()
  
  return result[0] || null
}
/*
// Fetcher functions for React Query
export async function getIssue(id: number) {
  try {
    await mockDelay(700)
    const result = await db.query.issues.findFirst({
      where: eq(issues.id, id),
      with: {
        user: true,
      },
    })
    return result
  } catch (error) {
    console.error(`Error fetching issue ${id}:`, error)
    throw new Error('Failed to fetch issue')
  }
}

export async function getIssues() {
  'use cache'
  cacheTag('issues')
  try {
    await mockDelay(700)
    const result = await db.query.issues.findMany({
      with: {
        user: true,
      },
      orderBy: (issues, { desc }) => [desc(issues.createdAt)],
    })
    return result
  } catch (error) {
    console.error('Error fetching issues:', error)
    throw new Error('Failed to fetch issues')
  }
} */
