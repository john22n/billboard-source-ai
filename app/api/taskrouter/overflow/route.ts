/**
 * Overflow TwiML Handler (Feature 3)
 *
 * Terminal handoff after the allowed Sales Rep Call Attempts are exhausted.
 * Dials the configured Overflow Number (TWILIO_OVERFLOW_NUMBER) and hangs up.
 *
 * The Overflow Number is terminal and external to Billboard Source AI:
 *  - The app does NOT enforce a ring window here (no <Dial timeout>); the
 *    external destination owns final call handling.
 *  - The app does NOT route the caller to its voicemail flow after this.
 *
 * See docs/adr/0002-terminal-overflow-number-after-two-call-attempts.md
 */

import twilio from 'twilio'
import { recordOverflowAttempt } from '@/lib/call-attempt-outcomes'
import { serverConfig } from '@/lib/config'

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid = url.searchParams.get('workspaceSid')
    let callSid = url.searchParams.get('callSid')

    const overflowNumber = serverConfig.twilio.overflowNumber
    const callerId =
      url.searchParams.get('callerFrom') ||
      serverConfig.twilio.mainNumber ||
      '+18338547126'

    console.log('═══════════════════════════════════════════')
    console.log('📤 OVERFLOW HANDOFF')
    console.log('TaskSid:', taskSid)
    console.log('OverflowNumber:', overflowNumber?.replace(/\d(?=\d{4})/g, '*'))
    console.log('═══════════════════════════════════════════')

    // Complete the TaskRouter task (terminal) and recover the original call_sid
    // for attribution if it wasn't passed in.
    if (taskSid && workspaceSid) {
      try {
        const { accountSid, authToken } =
          serverConfig.twilio.requireAccountCredentials()
        const client = twilio(accountSid, authToken)
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch()
        if (!callSid) {
          const attrs = JSON.parse(task.attributes || '{}')
          callSid = (attrs.call_sid as string | undefined) ?? null
        }
        if (
          task.assignmentStatus === 'assigned' ||
          task.assignmentStatus === 'wrapping' ||
          task.assignmentStatus === 'reserved' ||
          task.assignmentStatus === 'pending'
        ) {
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: 'Routed to overflow number',
            })
        }
      } catch (taskErr) {
        console.error('⚠️ Overflow: failed to complete task:', taskErr)
      }
    }

    // Record the terminal overflow attempt (production-only, attributed only if
    // the Overflow Number maps to exactly one Sales Rep Number).
    await recordOverflowAttempt({ callSid, taskSid })

    if (!overflowNumber) {
      console.error('❌ TWILIO_OVERFLOW_NUMBER not configured')
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Say>We are unable to connect your call. Goodbye.</Say><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    // Terminal external dial — no timeout, no voicemail fallback.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXml(callerId)}">${escapeXml(overflowNumber)}</Dial>
  <Hangup/>
</Response>`

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error) {
    console.error('❌ Overflow handler error:', error)
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
