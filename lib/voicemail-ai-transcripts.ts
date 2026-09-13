import type twilio from 'twilio'
import type { VoicemailAIDetail } from './voicemail-ai-log-types'

type TwilioClient = ReturnType<typeof twilio>
export const VOICEMAIL_AI_SERVICE = 'weekend-voicemail-ai'

// Twilio permits one Intelligence transcript per Recording SID. The lookup
// handles callback retries; the second lookup handles concurrent callbacks.
export async function transcribeVoicemailAIRecording(
  client: TwilioClient,
  callSid: string,
  recordingSid: string,
) {
  const transcripts = client.intelligence.v2.transcripts
  const existing = await transcripts.list({ sourceSid: recordingSid, limit: 1 })
  if (existing.length) return
  const service = await client.intelligence.v2
    .services(VOICEMAIL_AI_SERVICE)
    .fetch()
  try {
    await transcripts.create({
      serviceSid: service.sid,
      customerKey: callSid,
      channel: { media_properties: { source_sid: recordingSid } },
    })
  } catch (error) {
    const created = await transcripts.list({
      sourceSid: recordingSid,
      limit: 1,
    })
    if (!created.length) throw error
  }
}

export async function getVoicemailAITranscripts(
  client: TwilioClient,
  recordingSid: string,
  warnings: string[],
): Promise<VoicemailAIDetail['recordings'][number]['transcriptions']> {
  try {
    const transcripts = await client.intelligence.v2.transcripts.list({
      sourceSid: recordingSid,
      limit: 1,
    })
    return await Promise.all(
      transcripts.map(async (transcript) => {
        if (transcript.status !== 'completed') {
          return { sid: transcript.sid, status: transcript.status, text: '' }
        }
        const sentences = await client.intelligence.v2
          .transcripts(transcript.sid)
          .sentences.list({ limit: 1000 })
        if (sentences.length === 1000) {
          warnings.push(
            `Only the first 1000 transcript sentences are shown for ${recordingSid}.`,
          )
        }
        const text = sentences
          .sort(
            (a, b) =>
              Number(a.startTime) - Number(b.startTime) ||
              a.sentenceIndex - b.sentenceIndex,
          )
          .map(
            (sentence) =>
              `Channel ${sentence.mediaChannel}: ${sentence.transcript}`,
          )
          .join('\n')
        return { sid: transcript.sid, status: transcript.status, text }
      }),
    )
  } catch {
    warnings.push(
      `AI transcriptions were unavailable for recording ${recordingSid}.`,
    )
    return []
  }
}
