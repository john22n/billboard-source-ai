import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Overflow TwiML Handler (Feature 3)
 *
 * Terminal handoff after the allowed Sales Rep Call Attempts are exhausted.
 * Redirects to the voice agent Saturday/Sunday 9am–1pm Central (DST-aware).
 * Otherwise dials the configured Overflow Number (TWILIO_OVERFLOW_NUMBER).
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

function isVoiceAgentWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now)
  const day = parts.find((part) => part.type === 'weekday')?.value
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  return (day === 'Sat' || day === 'Sun') && hour >= 9 && hour < 13
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// Complete the terminal task and recover the original call for attribution.
// A cleanup failure must not prevent the live caller from being handed off.
async function completeOverflowTask(
  taskSid: string | null,
  workspaceSid: string | null,
  callSid: string | null,
  reason: string,
): Promise<string | null> {
  if (!taskSid || !workspaceSid) return callSid

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
      ['assigned', 'wrapping', 'reserved', 'pending'].includes(
        task.assignmentStatus,
      )
    ) {
      await client.taskrouter.v1
        .workspaces(workspaceSid)
        .tasks(taskSid)
        .update({ assignmentStatus: 'completed', reason })
    }
  } catch {
    console.error('⚠️ Overflow: failed to complete task')
  }
  return callSid
}

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid = url.searchParams.get('workspaceSid')
    let callSid = url.searchParams.get('callSid')

    const useVoiceAgent = isVoiceAgentWindow(new Date())
    const overflowNumber = serverConfig.twilio.overflowNumber
    const callerId =
      url.searchParams.get('callerFrom') ||
      serverConfig.twilio.mainNumber ||
      '+18338547126'

    console.log('═══════════════════════════════════════════')
    console.log('📤 OVERFLOW HANDOFF')
    console.log('═══════════════════════════════════════════')

    callSid = await completeOverflowTask(
      taskSid,
      workspaceSid,
      callSid,
      useVoiceAgent
        ? 'Routed to voicemail AI agent'
        : 'Routed to overflow number',
    )

    // Redirect the live call to external TwiML, not an assignment callback or
    // the media WebSocket. Task cleanup above still runs for either destination.
    if (useVoiceAgent) {
      const response = new twilio.twiml.VoiceResponse()
      response.redirect(
        { method: 'POST' },
        'https://voicemail-agent.john22n-iii.com/',
      )
      return new Response(response.toString(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
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
  } catch {
    console.error('❌ Overflow handler failed')
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
