import { db } from '@/db'
import { getSession } from './auth'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { cache } from 'react'
import { openaiLogs, user } from '@/db/schema'
import { unstable_cacheTag as cacheTag } from 'next/cache'

//current user
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

// get user by email
export const getUserByEmail = cache(async (email: string) => {
  try {
    const result = await db.select().from(user).where(eq(user.email, email))
    return result[0] || null
  } catch (error) {
    console.error('Error getting user by email', error)
    return null
  }
})


/**
 * Create a pending log entry for a new transcription session
 */
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

/**
 * Get all users from the database
 */
export async function getAllUsers() {
  return await db.select().from(user);
}

/**
 * Delete multiple users by their IDs
 */
export async function deleteUsersByIds(ids: string[]) {
  return await db.delete(user).where(inArray(user.id, ids));
}

/**
 * Get aggregated OpenAI costs for all users
 */
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
  // Calculate cost: $0.06 per minute for audio input
  const durationMinutes = durationSeconds / 60;
  const actualCost = durationMinutes * 0.06;

  const result = await db
    .update(openaiLogs)
    .set({
      totalTokens: Math.round(durationSeconds), // Store seconds for reference
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
