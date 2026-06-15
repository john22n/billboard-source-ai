/**
 * Browser Reject — Call Attempt Outcome
 *
 * Session-authenticated endpoint (NOT a Twilio webhook) hit by the browser
 * when a Sales Rep explicitly clicks Reject on an incoming call. The browser
 * click is authoritative for the "Rejected" Call Attempt Outcome and must not
 * be overwritten by later ambiguous Twilio outcomes.
 *
 * Only production traffic is recorded.
 */

import { getSession } from '@/lib/auth'
import { finalizeBrowserRejectedAttempt } from '@/lib/call-attempt-outcomes'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session?.userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  let workerCallSid: string | null = null
  try {
    const body = await req.json()
    workerCallSid =
      typeof body?.workerCallSid === 'string' ? body.workerCallSid : null
  } catch {
    // No/invalid body — fall back to most-recent-pending matching.
  }

  await finalizeBrowserRejectedAttempt({
    userId: session.userId,
    workerCallSid,
  })

  return new Response(null, { status: 204 })
}
