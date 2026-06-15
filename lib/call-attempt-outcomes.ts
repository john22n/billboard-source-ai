/**
 * Call Attempt Outcome tracking (Feature 2)
 *
 * Stores one row per Call Attempt (an offer of an inbound sales call to a
 * Sales Rep) with a final outcome of Accepted, Rejected, or Missed.
 *
 * Domain rules (see docs/adr/0001-store-call-attempt-outcomes-in-db.md):
 *  - Only PRODUCTION traffic is recorded. Local/preview/staging/simulated
 *    traffic is never recorded in admin totals.
 *  - One final outcome per Call Attempt; finalize-once and idempotent.
 *  - A browser Rejected must not be overwritten by a later ambiguous Twilio
 *    outcome. A conflicting final outcome is logged as an error and ignored.
 *  - Accepted: the Sales Rep actually connects with the Caller.
 *  - Rejected: the Sales Rep explicitly clicks Reject in the browser.
 *  - Missed: the Call Attempt ends without acceptance or explicit rejection.
 */

import { db } from '@/db'
import { callAttemptOutcomes, user } from '@/db/schema'
import { and, desc, eq, gte, inArray } from 'drizzle-orm'

export type FinalOutcome = 'accepted' | 'rejected' | 'missed'

/**
 * Only production traffic counts toward admin Call Attempt Totals.
 * Local, preview, staging and simulated traffic must never be recorded.
 */
export function shouldRecordCallAttempts(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

async function getUserIdByWorkerSid(workerSid: string): Promise<string | null> {
  if (!workerSid) return null
  const row = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.taskRouterWorkerSid, workerSid))
    .limit(1)
    .then((rows) => rows[0])
  return row?.id ?? null
}

/**
 * Create the initial offered/pending Call Attempt record. Idempotent: a
 * duplicate reservation id (e.g. assignment + reservation.created both fire)
 * does not create a second row or change an already-finalized outcome.
 */
export async function ensurePendingCallAttempt(input: {
  reservationSid: string
  taskSid?: string | null
  callSid?: string | null
  workerSid: string
  workerCallSid?: string | null
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return
  if (!input.reservationSid || !input.workerSid) return

  try {
    const userId = await getUserIdByWorkerSid(input.workerSid)
    // No matching Sales Rep (e.g. voicemail@system / overflow worker) → skip.
    if (!userId) return

    await db
      .insert(callAttemptOutcomes)
      .values({
        id: input.reservationSid,
        userId,
        reservationSid: input.reservationSid,
        taskSid: input.taskSid ?? null,
        callSid: input.callSid ?? null,
        workerSid: input.workerSid,
        workerCallSid: input.workerCallSid ?? null,
        attemptType: 'taskrouter',
        outcome: 'pending',
      })
      .onConflictDoNothing({ target: callAttemptOutcomes.id })
  } catch (err) {
    console.error('❌ ensurePendingCallAttempt failed:', err)
  }
}

/**
 * Finalize a Call Attempt's outcome exactly once.
 *
 * - pending  → set the new final outcome.
 * - same final outcome already set → no-op.
 * - different final outcome already set → log an error and DO NOT change it
 *   (protects browser Rejected from later ambiguous Twilio outcomes).
 *
 * If no row exists yet (e.g. an offer we never recorded a pending row for),
 * one is created directly in the final state.
 */
export async function finalizeCallAttempt(input: {
  reservationSid: string
  outcome: FinalOutcome
  source: string
  workerSid?: string | null
  taskSid?: string | null
  callSid?: string | null
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return
  if (!input.reservationSid) return

  try {
    const existing = await db
      .select()
      .from(callAttemptOutcomes)
      .where(eq(callAttemptOutcomes.id, input.reservationSid))
      .limit(1)
      .then((rows) => rows[0])

    if (!existing) {
      // No pending row — finalize directly if we can attribute a Sales Rep.
      const userId = input.workerSid
        ? await getUserIdByWorkerSid(input.workerSid)
        : null
      if (!userId) {
        console.warn(
          `⚠️ finalizeCallAttempt(${input.source}): no pending row and no user for reservation ${input.reservationSid} — skipping`,
        )
        return
      }
      await db
        .insert(callAttemptOutcomes)
        .values({
          id: input.reservationSid,
          userId,
          reservationSid: input.reservationSid,
          taskSid: input.taskSid ?? null,
          callSid: input.callSid ?? null,
          workerSid: input.workerSid ?? null,
          attemptType: 'taskrouter',
          outcome: input.outcome,
          finalSource: input.source,
          finalizedAt: new Date(),
        })
        .onConflictDoNothing({ target: callAttemptOutcomes.id })
      return
    }

    if (existing.outcome === 'pending') {
      await db
        .update(callAttemptOutcomes)
        .set({
          outcome: input.outcome,
          finalSource: input.source,
          finalizedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(callAttemptOutcomes.id, input.reservationSid),
            eq(callAttemptOutcomes.outcome, 'pending'),
          ),
        )
      return
    }

    if (existing.outcome === input.outcome) {
      // Duplicate callback — idempotent no-op.
      return
    }

    console.error(
      `❌ Conflicting Call Attempt outcome for reservation ${input.reservationSid}: ` +
        `already "${existing.outcome}" (source: ${existing.finalSource}), ` +
        `ignoring new "${input.outcome}" (source: ${input.source})`,
    )
  } catch (err) {
    console.error('❌ finalizeCallAttempt failed:', err)
  }
}

/**
 * Finalize a Rejected outcome from an explicit browser Reject click.
 *
 * The browser click is authoritative for Rejected. It matches the attempt by
 * the worker call leg SID when available, otherwise the user's most recent
 * attempt in the last few minutes. Because a TaskRouter reject can also surface
 * as an ambiguous "missed" callback that may race ahead of this click, a
 * Rejected click is allowed to override an existing "missed" (but never an
 * "accepted").
 */
export async function finalizeBrowserRejectedAttempt(input: {
  userId: string
  workerCallSid?: string | null
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return

  try {
    const overridable: FinalOutcome[] | string[] = ['pending', 'missed']
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)

    let target = input.workerCallSid
      ? await db
          .select()
          .from(callAttemptOutcomes)
          .where(
            and(
              eq(callAttemptOutcomes.workerCallSid, input.workerCallSid),
              inArray(callAttemptOutcomes.outcome, overridable as string[]),
            ),
          )
          .orderBy(desc(callAttemptOutcomes.offeredAt))
          .limit(1)
          .then((rows) => rows[0])
      : undefined

    if (!target) {
      target = await db
        .select()
        .from(callAttemptOutcomes)
        .where(
          and(
            eq(callAttemptOutcomes.userId, input.userId),
            inArray(callAttemptOutcomes.outcome, overridable as string[]),
            gte(callAttemptOutcomes.offeredAt, twoMinutesAgo),
          ),
        )
        .orderBy(desc(callAttemptOutcomes.offeredAt))
        .limit(1)
        .then((rows) => rows[0])
    }

    if (!target) {
      console.warn(
        `⚠️ Browser reject: no pending/missed Call Attempt found for user ${input.userId}`,
      )
      return
    }

    if (target.outcome === 'missed') {
      console.warn(
        `↩️ Browser reject overriding ambiguous "missed" for reservation ${target.id}`,
      )
    }

    await db
      .update(callAttemptOutcomes)
      .set({
        outcome: 'rejected',
        finalSource: 'browser.reject',
        finalizedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(callAttemptOutcomes.id, target.id),
          inArray(callAttemptOutcomes.outcome, overridable as string[]),
        ),
      )
  } catch (err) {
    console.error('❌ finalizeBrowserRejectedAttempt failed:', err)
  }
}

/**
 * Record the terminal Overflow attempt.
 *
 * - If the Overflow Number matches exactly one user's Sales Rep Number, count
 *   the terminal overflow attempt for that Sales Rep (as Missed — the app
 *   cannot prove the external destination connected).
 * - If it matches no user, do not count.
 * - If it matches multiple users, treat it as a configuration error and do not
 *   count for anyone.
 */
export async function recordOverflowAttempt(input: {
  callSid?: string | null
  taskSid?: string | null
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return

  const overflowNumber = process.env.TWILIO_OVERFLOW_NUMBER
  if (!overflowNumber) return

  try {
    const matches = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.twilioPhoneNumber, overflowNumber))

    if (matches.length === 0) {
      // Overflow Number is external / not a Sales Rep Number — do not count.
      return
    }

    if (matches.length > 1) {
      console.error(
        `❌ Overflow Number ${overflowNumber} matches ${matches.length} users — configuration error, not counting overflow attempt`,
      )
      return
    }

    const userId = matches[0].id
    const key = `overflow:${input.callSid ?? input.taskSid ?? Date.now()}`

    await db
      .insert(callAttemptOutcomes)
      .values({
        id: key,
        userId,
        taskSid: input.taskSid ?? null,
        callSid: input.callSid ?? null,
        attemptType: 'overflow',
        outcome: 'missed',
        finalSource: 'overflow',
        finalizedAt: new Date(),
      })
      .onConflictDoNothing({ target: callAttemptOutcomes.id })
  } catch (err) {
    console.error('❌ recordOverflowAttempt failed:', err)
  }
}
