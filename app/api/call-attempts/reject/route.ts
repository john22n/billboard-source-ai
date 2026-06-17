/**
 * Browser Reject — Call Attempt Outcome
 *
 * Session-authenticated endpoint (NOT a Twilio webhook) hit by the browser
 * when a Sales Rep explicitly clicks Reject on an incoming call. The browser
 * click is authoritative for the "Rejected" Call Attempt Outcome; it increments
 * the rep's Rejected counter and stamps last_reject_at so the following Twilio
 * "missed" callback for the same attempt is suppressed.
 *
 * Only production traffic is recorded.
 */

import { getSession } from '@/lib/auth'
import { recordRejectedAttempt } from '@/lib/call-attempt-outcomes'

export async function POST() {
  const session = await getSession()
  if (!session?.userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  await recordRejectedAttempt({ userId: session.userId })

  return new Response(null, { status: 204 })
}
