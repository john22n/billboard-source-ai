/**
 * Voicemail Complete Handler
 * 
 * Called after a voicemail recording is completed.
 * - Updates the TaskRouter task with recording info
 * - Sends email notification to Sky with recording link
 * - Cancels the task to clean up
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const VOICEMAIL_EMAIL = process.env.VOICEMAIL_NOTIFICATION_EMAIL || 'sky@billboardsource.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

async function sendVoicemailEmail(
  from: string,
  recordingUrl: string,
  transcription?: string,
  duration?: string
) {
  if (!RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not set - skipping email notification');
    return;
  }

  const emailBody = `
    <h2>New Voicemail Received</h2>
    <p><strong>From:</strong> ${from}</p>
    <p><strong>Duration:</strong> ${duration || 'Unknown'} seconds</p>
    <p><strong>Recording:</strong> <a href="${recordingUrl}.mp3">Listen to Recording</a></p>
    ${transcription ? `<p><strong>Transcription:</strong> ${transcription}</p>` : ''}
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
      console.log('✅ Voicemail notification email sent to', VOICEMAIL_EMAIL);
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
    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || process.env.TASKROUTER_WORKSPACE_SID;

    const formData = await req.formData();
    
    const recordingUrl = formData.get('RecordingUrl') as string;
    const recordingDuration = formData.get('RecordingDuration') as string;
    const transcriptionText = formData.get('TranscriptionText') as string;
    const from = formData.get('From') as string;
    const callSid = formData.get('CallSid') as string;

    console.log('═══════════════════════════════════════════');
    console.log('📼 VOICEMAIL COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log('TaskSid:', taskSid);
    console.log('From:', from);
    console.log('RecordingUrl:', recordingUrl);
    console.log('Duration:', recordingDuration, 'seconds');
    console.log('Transcription:', transcriptionText || '(pending)');
    console.log('═══════════════════════════════════════════');

    // Send email notification
    await sendVoicemailEmail(
      from || 'Unknown',
      recordingUrl || '',
      transcriptionText,
      recordingDuration
    );

    // Update task attributes with voicemail info and cancel it
    if (taskSid && workspaceSid) {
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        let taskAttributes = {};
        try {
          taskAttributes = JSON.parse(task.attributes);
        } catch {
          // ignore
        }

        // Add voicemail metadata
        const updatedAttributes = {
          ...taskAttributes,
          voicemail: {
            recording_url: recordingUrl,
            duration: recordingDuration,
            transcription: transcriptionText,
          },
          conversations: {
            segment_link: recordingUrl,
            abandoned: 'Follow-Up',
            abandoned_phase: 'Voicemail',
          },
        };

        // Update and cancel the task
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            attributes: JSON.stringify(updatedAttributes),
            assignmentStatus: 'canceled',
            reason: 'Voicemail left',
          });

        console.log('✅ Task updated and canceled');
      } catch (error) {
        console.error('❌ Failed to update task:', error);
      }
    }

    // Return TwiML to end the call
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for your message. Goodbye.</Say>
  <Hangup/>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Voicemail complete error:', error);
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Hangup/>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
