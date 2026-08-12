import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

/**
 * Voicemail Complete Handler
 *
 * Called after a voicemail recording is completed.
 * Completes the TaskRouter task so the voicemail worker can accept new tasks.
 */

import twilio from 'twilio'
import { serverConfig } from '@/lib/config'

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid = url.searchParams.get('workspaceSid')
    const queueTime = url.searchParams.get('queueTime')

    const formData = await req.formData()
    const recordingSid = formData.get('RecordingSid') as string | null
    const recordingDuration = formData.get('RecordingDuration') as string | null

    const durationSeconds = parseInt(recordingDuration || '0', 10)

    console.log('═══════════════════════════════════════════')
    console.log('📼 VOICEMAIL COMPLETE')
    console.log('QueueTime:', queueTime, 'seconds')
    console.log('Duration:', durationSeconds, 'seconds')
    console.log('═══════════════════════════════════════════')

    // Complete the TaskRouter task so voicemail worker can accept new tasks
    if (taskSid && workspaceSid) {
      try {
        const { accountSid, authToken } =
          serverConfig.twilio.requireAccountCredentials()
        const client = twilio(accountSid, authToken)
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            assignmentStatus: 'completed',
            reason: 'Voicemail recorded',
          })
        console.log('✅ Task completed')
      } catch {
        console.error('⚠️ Failed to complete task (may already be completed)')
      }
    }

    // ─────────────────────────────────────────────
    // NO MESSAGE LEFT
    // ─────────────────────────────────────────────
    if (!recordingSid || durationSeconds === 0) {
      console.log('⚠️ No voicemail recorded')
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } },
      )
    }

    // ─────────────────────────────────────────────
    // SAVE / PROCESS VOICEMAIL
    // ─────────────────────────────────────────────
    // await db.insert(voicemails).values({
    //   callSid,
    //   from,
    //   to,
    //   recordingUrl,
    //   recordingSid,
    //   duration: durationSeconds,
    //   queueTime: parseInt(queueTime || '0', 10),
    //   createdAt: new Date(),
    // });

    console.log('✅ Voicemail recorded successfully')

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Thank you for your message. Goodbye.</Say>
  <Hangup/>
</Response>`

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch {
    console.error('❌ Voicemail completion failed')
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } },
    )
  }
}
