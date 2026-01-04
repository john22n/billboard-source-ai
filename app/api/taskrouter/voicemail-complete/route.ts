/**
 * Voicemail Complete Handler
 *
 * Called after a voicemail recording is completed.
 * - Updates the TaskRouter task with recording info
 * - Cancels the task to clean up
 *
 * Note: Email is sent from /api/taskrouter/voicemail-transcription
 * when Twilio's async transcription completes.
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

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

    console.log('═══════════════════════════════════════════');
    console.log('📼 VOICEMAIL COMPLETE');
    console.log('═══════════════════════════════════════════');
    console.log('TaskSid:', taskSid);
    console.log('From:', from);
    console.log('RecordingUrl:', recordingUrl);
    console.log('Duration:', recordingDuration, 'seconds');
    console.log('Transcription:', transcriptionText || '(pending)');
    console.log('═══════════════════════════════════════════');

    // Update task attributes with voicemail info and complete/cancel it
    // Note: Reservation was already completed by the redirect instruction
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

        // Update attributes and mark task as completed
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            attributes: JSON.stringify(updatedAttributes),
            assignmentStatus: 'completed',
            reason: 'Voicemail recorded',
          });

        console.log('✅ Task updated and completed');
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
