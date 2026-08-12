import { isValidTwilioWebhook } from '@/lib/twilio-webhook'

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character]!,
  )
}

/**
 * Voicemail Transcription Callback
 *
 * Called by Twilio when transcription is complete.
 * Sends email with full voicemail details including transcription.
 */

import {
  configErrorResponseBody,
  isMissingConfig,
  serverConfig,
} from '@/lib/config'

async function sendVoicemailEmail(
  from: string,
  recordingUrl: string,
  transcription: string,
  duration?: string,
  transcriptionStatus?: string,
  config?: { resendApiKey: string; notificationEmail: string },
) {
  const resendApiKey =
    config?.resendApiKey ?? serverConfig.email.requireResendApiKey()
  const notificationEmail =
    config?.notificationEmail ??
    serverConfig.voicemail.requireNotificationEmail()
  const safeFrom = escapeHtml(from)
  const safeRecordingUrl = escapeHtml(recordingUrl)
  const safeTranscription = escapeHtml(transcription)
  const safeDuration = duration ? escapeHtml(duration) : undefined
  const safeTranscriptionStatus = transcriptionStatus
    ? escapeHtml(transcriptionStatus)
    : undefined

  const transcriptionNote =
    transcriptionStatus !== 'completed'
      ? `<p><strong>Transcription Status:</strong> ${safeTranscriptionStatus || 'Unknown'} (may be incomplete)</p>`
      : ''

  const emailBody = `
    <h2>New Voicemail Received</h2>
    <p><strong>From:</strong> ${safeFrom}</p>
    ${safeDuration ? `<p><strong>Duration:</strong> ${safeDuration} seconds</p>` : ''}
    <p><strong>Recording:</strong> <a href="${safeRecordingUrl}.mp3">Listen to Recording</a></p>
    ${transcriptionNote}
    <p><strong>Transcription:</strong></p>
    <blockquote style="background: #f5f5f5; padding: 12px; border-left: 4px solid #ccc; margin: 8px 0;">
      ${safeTranscription || '(Transcription unavailable)'}
    </blockquote>
    <br/>
    <p>— Billboard Source AI</p>
  `

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: 'Billboard Source <tech@billboardsource.com>',
        to: [notificationEmail],
        subject: `New Voicemail from ${from}`,
        html: emailBody,
      }),
    })

    if (response.ok) {
      console.log('✅ Voicemail email sent')
    } else {
      console.error('❌ Failed to send voicemail email:', response.status)
    }
  } catch {
    console.error('❌ Email send failed')
  }
}

export async function POST(req: Request) {
  if (!(await isValidTwilioWebhook(req)))
    return new Response('Forbidden', { status: 403 })

  try {
    const formData = await req.formData()

    const transcriptionText = formData.get('TranscriptionText') as string
    const transcriptionStatus = formData.get('TranscriptionStatus') as string
    const recordingUrl = formData.get('RecordingUrl') as string
    const recordingDuration = formData.get('RecordingDuration') as string
    const from = formData.get('From') as string

    console.log('═══════════════════════════════════════════')
    console.log('📝 VOICEMAIL TRANSCRIPTION CALLBACK')
    console.log('Status:', transcriptionStatus)
    console.log('Duration:', recordingDuration)
    console.log('═══════════════════════════════════════════')

    const resendApiKey = serverConfig.email.requireResendApiKey()
    const notificationEmail = serverConfig.voicemail.requireNotificationEmail()

    await sendVoicemailEmail(
      from || 'Unknown',
      recordingUrl || '',
      transcriptionText || '',
      recordingDuration,
      transcriptionStatus,
      { resendApiKey, notificationEmail },
    )

    return new Response('OK', { status: 200 })
  } catch (error) {
    if (isMissingConfig(error)) {
      const responseBody = configErrorResponseBody(error)
      console.error(
        '❌ Voicemail transcription configuration error:',
        responseBody.details,
      )
      return Response.json(responseBody, { status: 500 })
    }
    console.error('❌ Transcription callback failed')
    return new Response('Error', { status: 500 })
  }
}
