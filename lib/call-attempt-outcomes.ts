/**
 * Call Attempt Outcome tracking (Feature 2)
 *
 * Tracks per-Sales-Rep Call Attempt Totals (Accepted / Rejected / Missed) as
 * counters ON THE USER ROW. We deliberately avoid a per-attempt table to stay
 * within the Neon free tier: fixed storage, no unbounded row growth, and a
 * single atomic UPDATE per outcome (no pending rows, no extra SELECTs).
 *
 * Domain rules (see docs/adr/0001-store-call-attempt-outcomes-in-db.md):
 *  - Only PRODUCTION traffic is counted. Local/preview/staging/simulated
 *    traffic is never recorded in admin totals.
 *  - One outcome per Call Attempt; near-simultaneous duplicate callbacks for
 *    the in-flight attempt are deduped (see the bound below).
 *  - Accepted: the Sales Rep actually connects with the Caller.
 *  - Rejected: the Sales Rep explicitly clicks Reject in the browser.
 *  - Missed: the Call Attempt ends without acceptance or explicit rejection.
 *
 * Idempotency without a per-attempt table (and its bound):
 *  - `last_attempt_sid` stores ONLY the most recently counted Twilio
 *    ReservationSid (or `overflow:<callSid>`). Every Twilio-side increment is a
 *    conditional UPDATE guarded by `last_attempt_sid IS DISTINCT FROM <sid>`,
 *    so the multiple "missed" sources that share one ReservationSid
 *    (reservation.timeout + conference-end + simultaneous-dial-complete) — and
 *    rapid duplicate deliveries of the same callback — only count once.
 *  - Because only the single most-recent SID is remembered, this is NOT a full
 *    per-attempt dedupe: if attempt A is counted, a later attempt B for the
 *    same rep overwrites `last_attempt_sid`, and a straggler duplicate of A
 *    arriving afterward would be counted again. In practice a reservation's
 *    callbacks all fire within seconds, so a straggler interleaving with a
 *    distinct later attempt for the same rep is vanishingly rare. We accept
 *    these admin totals as approximate — that is the deliberate tradeoff for
 *    avoiding per-attempt storage on the Neon free tier.
 *  - A browser Reject sets `last_reject_at`; the immediately-following ambiguous
 *    Twilio "missed" for that same attempt is suppressed within a short window,
 *    so an explicit Reject is not also double-counted as Missed. A Sales Rep is
 *    switched to Busy on accept and handles one call at a time, so this window
 *    is safe in practice.
 */

import { db } from '@/db'
import { user } from '@/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { serverConfig } from '@/lib/config'

// Suppress a Twilio "missed" that arrives shortly after an explicit browser
// Reject for the same Call Attempt.
const REJECT_MISSED_WINDOW_SECONDS = 15
// Debounce duplicate browser Reject clicks for the same attempt.
const REJECT_DEBOUNCE_SECONDS = 3

/**
 * Only production traffic counts toward admin Call Attempt Totals.
 * Local, preview, staging and simulated traffic must never be recorded.
 */
export function shouldRecordCallAttempts(): boolean {
  return serverConfig.runtime.isProductionDeployment
}

// Business hours for counting Call Attempt outcomes: 08:00–18:00 Central Time.
const BUSINESS_HOURS_TIME_ZONE = 'America/Chicago' // DST-aware
const BUSINESS_HOURS_START = 8 // 8:00am CT (inclusive)
const BUSINESS_HOURS_END = 18 // 6:00pm CT (exclusive)

/**
 * Accepted / Rejected / Missed outcomes are only counted during business hours
 * (8:00am–6:00pm Central Time, DST-aware). Outside that window the outcome is
 * ignored. The Main-Number total is NOT gated by this — it counts all hours.
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: BUSINESS_HOURS_TIME_ZONE,
      hour12: false,
      hour: '2-digit',
    }).format(now),
  )
  // Intl can emit "24" for midnight under hour12:false; normalize to 0.
  const normalized = hour === 24 ? 0 : hour
  return normalized >= BUSINESS_HOURS_START && normalized < BUSINESS_HOURS_END
}

/**
 * Count an Accepted Call Attempt for the Sales Rep who owns `workerSid`.
 * Idempotent per ReservationSid.
 */
export async function recordAcceptedAttempt(input: {
  reservationSid: string
  workerSid: string
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return
  if (!isWithinBusinessHours()) return
  if (!input.workerSid || !input.reservationSid) return

  try {
    await db
      .update(user)
      .set({
        callsAccepted: sql`${user.callsAccepted} + 1`,
        lastAttemptSid: input.reservationSid,
      })
      .where(
        and(
          eq(user.taskRouterWorkerSid, input.workerSid),
          sql`${user.lastAttemptSid} IS DISTINCT FROM ${input.reservationSid}`,
        ),
      )
  } catch (err) {
    console.error('❌ recordAcceptedAttempt failed:', err)
  }
}

/**
 * Count a Missed Call Attempt for the Sales Rep who owns `workerSid`.
 * Idempotent per ReservationSid, and suppressed if the rep just explicitly
 * rejected this attempt in the browser.
 */
export async function recordMissedAttempt(input: {
  reservationSid: string
  workerSid: string
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return
  if (!isWithinBusinessHours()) return
  if (!input.workerSid || !input.reservationSid) return

  try {
    await db
      .update(user)
      .set({
        callsMissed: sql`${user.callsMissed} + 1`,
        lastAttemptSid: input.reservationSid,
      })
      .where(
        and(
          eq(user.taskRouterWorkerSid, input.workerSid),
          sql`${user.lastAttemptSid} IS DISTINCT FROM ${input.reservationSid}`,
          sql`(${user.lastRejectAt} IS NULL OR ${user.lastRejectAt} < now() - interval '${sql.raw(
            String(REJECT_MISSED_WINDOW_SECONDS),
          )} seconds')`,
        ),
      )
  } catch (err) {
    console.error('❌ recordMissedAttempt failed:', err)
  }
}

/**
 * Count a Rejected Call Attempt from an explicit browser Reject click. The
 * click is authoritative; we always count it (debounced against rapid
 * duplicate clicks) and stamp `last_reject_at` so the following Twilio "missed"
 * for the same attempt is suppressed.
 */
export async function recordRejectedAttempt(input: {
  userId: string
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return
  if (!isWithinBusinessHours()) return
  if (!input.userId) return

  try {
    await db
      .update(user)
      .set({
        callsRejected: sql`${user.callsRejected} + 1`,
        lastRejectAt: new Date(),
      })
      .where(
        and(
          eq(user.id, input.userId),
          sql`(${user.lastRejectAt} IS NULL OR ${user.lastRejectAt} < now() - interval '${sql.raw(
            String(REJECT_DEBOUNCE_SECONDS),
          )} seconds')`,
        ),
      )
  } catch (err) {
    console.error('❌ recordRejectedAttempt failed:', err)
  }
}

/**
 * Record the terminal Overflow attempt (as Missed — the app cannot prove the
 * external destination connected).
 *
 * - Overflow Number matches exactly one Sales Rep Number → count for that rep.
 * - Matches no user → do not count.
 * - Matches multiple users → configuration error, do not count for anyone.
 */
export async function recordOverflowAttempt(input: {
  callSid?: string | null
  taskSid?: string | null
}): Promise<void> {
  if (!shouldRecordCallAttempts()) return
  if (!isWithinBusinessHours()) return

  const overflowNumber = serverConfig.twilio.overflowNumber
  if (!overflowNumber) return

  try {
    const matches = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.twilioPhoneNumber, overflowNumber))

    if (matches.length === 0) return // external / not a Sales Rep Number
    if (matches.length > 1) {
      console.error(
        `❌ Overflow Number ${overflowNumber} matches ${matches.length} users — configuration error, not counting overflow attempt`,
      )
      return
    }

    const key = `overflow:${input.callSid ?? input.taskSid ?? ''}`
    await db
      .update(user)
      .set({
        callsMissed: sql`${user.callsMissed} + 1`,
        lastAttemptSid: key,
      })
      .where(
        and(
          eq(user.id, matches[0].id),
          sql`${user.lastAttemptSid} IS DISTINCT FROM ${key}`,
        ),
      )
  } catch (err) {
    console.error('❌ recordOverflowAttempt failed:', err)
  }
}
