import { db } from '@/db'
import { getSession } from './auth'
import { eq } from 'drizzle-orm'
import { cache } from 'react'
import { user } from '@/db/schema'
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
