import { db } from '@/db'
import { getSession } from './auth'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { cache } from 'react'
import { openaiLogs, user, nutshellLeads, appMetrics } from '@/db/schema'
import {
  calculateOpenAIDurationCost,
  calculateOpenAIEmbeddingCost,
  calculateOpenAITokenCost,
  normalizeTokenUsage,
  REALTIME_TRANSCRIPTION_MODEL,
  type TokenUsageLike,
} from '@/lib/openai-pricing'

export const getCurrentUser = cache(async () => {
  const session = await getSession()
  if (!session) return null

  // skip database query during prerendering if we dont have a session
  // hack until we have PPR http://nextjs.org/docs/app/buidling-your-application/rendering/parital-prerendering
  if (
    typeof window == 'undefined' &&
    process.env.NEXT_PHASE === 'phase-production-build'
  )
    return null

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

export async function createPendingLog(
  userId: string,
  sessionId: string,
  model = REALTIME_TRANSCRIPTION_MODEL,
) {
  const [logEntry] = await db
    .insert(openaiLogs)
    .values({
      userId,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: '0.000000',
      sessionId,
      status: 'pending',
    })
    .returning()

  return logEntry
}

export async function getAllUsers() {
  return await db.select().from(user)
}

export async function deleteUsersByIds(ids: string[]) {
  return await db.delete(user).where(inArray(user.id, ids))
}

const APP_METRICS_ID = 1

// Total inbound calls to the Main Routing Number (Admin Panel header).
export async function getMainCallsTotal(): Promise<number> {
  const rows = await db
    .select({ total: appMetrics.mainCallsTotal })
    .from(appMetrics)
    .where(eq(appMetrics.id, APP_METRICS_ID))
    .limit(1)
  return rows[0]?.total ?? 0
}

// Increment the Main-Number total by one (atomic upsert on the singleton row).
export async function incrementMainCallsTotal(): Promise<void> {
  await db
    .insert(appMetrics)
    .values({ id: APP_METRICS_ID, mainCallsTotal: 1 })
    .onConflictDoUpdate({
      target: appMetrics.id,
      set: { mainCallsTotal: sql`${appMetrics.mainCallsTotal} + 1` },
    })
}

// Reset every Sales Rep's Call Attempt Totals (Missed/Rejected/Accepted) to
// 0/0/0, clear idempotency guards, and zero the Main-Number total.
export async function resetAllCallCounts(): Promise<void> {
  await db.update(user).set({
    callsAccepted: 0,
    callsRejected: 0,
    callsMissed: 0,
    lastAttemptSid: null,
    lastRejectAt: null,
  })
  await db
    .insert(appMetrics)
    .values({ id: APP_METRICS_ID, mainCallsTotal: 0 })
    .onConflictDoUpdate({
      target: appMetrics.id,
      set: { mainCallsTotal: 0 },
    })
}

export async function updateUserTwilioPhone(
  userId: string,
  twilioPhoneNumber: string | null,
) {
  const result = await db
    .update(user)
    .set({ twilioPhoneNumber })
    .where(eq(user.id, userId))
    .returning()
  return result[0] || null
}

export function getCurrentOpenAICostRange(now = new Date()) {
  return {
    startDate: new Date(now.getFullYear(), now.getMonth(), 1),
    endDate: now,
  }
}

export async function getUserCosts(
  range: { startDate: Date; endDate: Date } = getCurrentOpenAICostRange(),
) {
  return await db
    .select({
      id: user.id,
      email: user.email,
      cost: sql<number>`COALESCE(SUM(CAST(${openaiLogs.cost} AS NUMERIC)), 0)`.as(
        'cost',
      ),
    })
    .from(user)
    .leftJoin(
      openaiLogs,
      and(
        eq(user.id, openaiLogs.userId),
        gte(openaiLogs.createdAt, range.startDate),
        lt(openaiLogs.createdAt, range.endDate),
      ),
    )
    .groupBy(user.id, user.email)
    .orderBy(user.email)
}

export async function logOpenAITokenUsage({
  userId,
  model,
  usage,
  sessionId,
}: {
  userId: string
  model: string
  usage: TokenUsageLike | null | undefined
  sessionId?: string
}) {
  const tokenUsage = normalizeTokenUsage(usage)
  const cost = calculateOpenAITokenCost(model, tokenUsage)

  return await createCompletedOpenAILog({
    userId,
    model,
    ...tokenUsage,
    cost,
    sessionId,
  })
}

export async function logOpenAIEmbeddingUsage({
  userId,
  model,
  promptTokens,
  sessionId,
}: {
  userId: string
  model: string
  promptTokens: number
  sessionId?: string
}) {
  return await createCompletedOpenAILog({
    userId,
    model,
    promptTokens,
    completionTokens: 0,
    totalTokens: promptTokens,
    cost: calculateOpenAIEmbeddingCost(model, promptTokens),
    sessionId,
  })
}

export async function logOpenAIDurationUsage({
  userId,
  model,
  durationSeconds,
  sessionId,
}: {
  userId: string
  model: string
  durationSeconds: number
  sessionId?: string
}) {
  return await createCompletedOpenAILog({
    userId,
    model,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: Math.round(durationSeconds),
    cost: calculateOpenAIDurationCost(model, durationSeconds),
    sessionId,
  })
}

async function createCompletedOpenAILog({
  userId,
  model,
  promptTokens,
  completionTokens,
  totalTokens,
  cost,
  sessionId,
}: {
  userId: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cost: number
  sessionId?: string
}) {
  const [logEntry] = await db
    .insert(openaiLogs)
    .values({
      userId,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      cost: cost.toFixed(6),
      sessionId,
      status: 'completed',
    })
    .returning()

  return logEntry
}

export async function updateLogCost(
  logId: number,
  userId: string,
  durationSeconds: number,
  model = REALTIME_TRANSCRIPTION_MODEL,
) {
  const actualCost = calculateOpenAIDurationCost(model, durationSeconds)

  const result = await db
    .update(openaiLogs)
    .set({
      model,
      totalTokens: Math.round(durationSeconds),
      cost: actualCost.toFixed(6),
      status: 'completed',
    })
    .where(and(eq(openaiLogs.id, logId), eq(openaiLogs.userId, userId)))
    .returning()

  return result[0] || null
}

export async function clearMonthlyOpenAILogs() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const result = await db
    .delete(openaiLogs)
    .where(lt(openaiLogs.createdAt, startOfMonth))
    .returning()

  return result.length
}

export async function promoteToAdmin(email: string) {
  const result = await db
    .update(user)
    .set({ role: 'admin' })
    .where(eq(user.email, email))
    .returning()

  return result[0] || null
}
// ===================== Nutshell Lead Tracking =====================

export async function upsertNutshellLead(lead: {
  nutshellLeadId: number
  description?: string | null
  status?: number
  value?: string | null
  currency?: string | null
  assigneeEmail?: string | null
  createdByUserId?: string | null
  nutshellCreatedAt?: Date | null
  closedAt?: Date | null
}) {
  const [result] = await db
    .insert(nutshellLeads)
    .values({
      nutshellLeadId: lead.nutshellLeadId,
      description: lead.description ?? null,
      status: lead.status ?? 0,
      value: lead.value ?? null,
      currency: lead.currency ?? 'USD',
      assigneeEmail: lead.assigneeEmail ?? null,
      createdByUserId: lead.createdByUserId ?? null,
      nutshellCreatedAt: lead.nutshellCreatedAt ?? null,
      closedAt: lead.closedAt ?? null,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: nutshellLeads.nutshellLeadId,
      set: {
        description: lead.description ?? undefined,
        status: lead.status ?? undefined,
        value: lead.value ?? undefined,
        currency: lead.currency ?? undefined,
        assigneeEmail: lead.assigneeEmail ?? undefined,
        closedAt: lead.closedAt ?? undefined,
        syncedAt: new Date(),
      },
    })
    .returning()
  return result
}

export async function getNutshellLeadStats() {
  const leads = await db
    .select()
    .from(nutshellLeads)
    .orderBy(sql`${nutshellLeads.nutshellCreatedAt} DESC NULLS LAST`)

  const totalLeads = leads.length
  const wonLeads = leads.filter((l) => l.status === 1)
  const openLeads = leads.filter((l) => l.status === 0)
  const lostLeads = leads.filter((l) => l.status === 2)

  const totalWonValue = wonLeads.reduce((sum, l) => {
    const val = l.value ? Number(l.value) : 0
    return sum + (Number.isFinite(val) ? val : 0)
  }, 0)

  return {
    leads,
    totalLeads,
    wonCount: wonLeads.length,
    openCount: openLeads.length,
    lostCount: lostLeads.length,
    totalWonValue,
  }
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
