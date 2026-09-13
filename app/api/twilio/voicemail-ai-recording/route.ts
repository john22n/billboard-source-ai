import twilio from 'twilio'
import { serverConfig } from '@/lib/config'
import { isValidTwilioWebhook } from '@/lib/twilio-webhook'
import { CALL_SID, RECORDING_SID } from '@/lib/voicemail-ai-logs'
import { transcribeVoicemailAIRecording } from '@/lib/voicemail-ai-transcripts'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!(await isValidTwilioWebhook(request)))
    return new Response('Forbidden', { status: 403 })

  const form = new URLSearchParams(await request.text())
  const callSid = form.get('CallSid') ?? ''
  const recordingSid = form.get('RecordingSid') ?? ''
  if (!CALL_SID.test(callSid) || !RECORDING_SID.test(recordingSid))
    return new Response('Invalid recording callback', { status: 400 })

  try {
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    if (form.get('AccountSid') !== accountSid)
      return new Response('Forbidden', { status: 403 })
    if (form.get('RecordingStatus') !== 'completed')
      return new Response(null, { status: 204 })

    const client = twilio(accountSid, authToken, { timeout: 8_000 })
    const recording = await client.recordings(recordingSid).fetch()
    if (recording.callSid !== callSid)
      return new Response('Recording does not belong to call', { status: 403 })
    // Fetch media by Recording SID, never trust a callback-supplied media URL.
    await transcribeVoicemailAIRecording(client, callSid, recordingSid)
    console.info('Voicemail AI transcription requested', {
      callSid,
      recordingSid,
    })
    return new Response(null, { status: 204 })
  } catch {
    console.error('Voicemail AI transcription request failed', {
      callSid,
      recordingSid,
    })
    return new Response('Transcription request failed', { status: 502 })
  }
}
