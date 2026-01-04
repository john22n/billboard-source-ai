/**
 * Voicemail Transcription Callback
 *
 * Called by Twilio when transcription is complete.
 * Sends email with full voicemail details including transcription.
 */

const VOICEMAIL_EMAIL = process.env.VOICEMAIL_NOTIFICATION_EMAIL || 'sky@billboardsource.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function sendVoicemailEmail(
  from: string,
  recordingUrl: string,
  transcription: string,
  duration?: string
) {
  if (!RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set - skipping email notification');
    return;
  }

  const emailBody = `
    <h2>New Voicemail Received</h2>
    <p><strong>From:</strong> ${from}</p>
    ${duration ? `<p><strong>Duration:</strong> ${duration} seconds</p>` : ''}
    <p><strong>Recording:</strong> <a href="${recordingUrl}.mp3">Listen to Recording</a></p>
    <p><strong>Transcription:</strong></p>
    <blockquote style="background: #f5f5f5; padding: 12px; border-left: 4px solid #ccc; margin: 8px 0;">
      ${transcription}
    </blockquote>
    <br/>
    <p>— Billboard Source AI</p>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Billboard Source <voicemail@billboardsource.com>',
        to: [VOICEMAIL_EMAIL],
        subject: `New Voicemail from ${from}`,
        html: emailBody,
      }),
    });

    if (response.ok) {
      console.log('✅ Voicemail email sent to', VOICEMAIL_EMAIL);
    } else {
      const error = await response.text();
      console.error('❌ Failed to send email:', error);
    }
  } catch (error) {
    console.error('❌ Email send error:', error);
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const transcriptionText = formData.get('TranscriptionText') as string;
    const transcriptionStatus = formData.get('TranscriptionStatus') as string;
    const recordingUrl = formData.get('RecordingUrl') as string;
    const recordingDuration = formData.get('RecordingDuration') as string;
    const from = formData.get('From') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📝 VOICEMAIL TRANSCRIPTION CALLBACK');
    console.log('═══════════════════════════════════════════');
    console.log('From:', from);
    console.log('Status:', transcriptionStatus);
    console.log('RecordingUrl:', recordingUrl);
    console.log('Duration:', recordingDuration);
    console.log('Transcription:', transcriptionText);
    console.log('═══════════════════════════════════════════');

    // Send email with transcription (or note if transcription failed)
    await sendVoicemailEmail(
      from || 'Unknown',
      recordingUrl || '',
      transcriptionText || '(Transcription unavailable)',
      recordingDuration
    );

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('❌ Transcription callback error:', error);
    return new Response('Error', { status: 500 });
  }
}
