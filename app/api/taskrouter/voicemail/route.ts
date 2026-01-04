/**
 * Voicemail TwiML Handler
 *
 * Plays a voicemail greeting and records the caller's message.
 * Called when a task enters the Voicemail queue (no agents available/answered).
 */
import twilio from "twilio";



export async function POST(req: Request) {
  try {

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );

    const url = new URL(req.url);
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid');

    console.log('═══════════════════════════════════════════');
    console.log('📼 VOICEMAIL HANDLER');
    console.log('═══════════════════════════════════════════');
    console.log('TaskSid:', taskSid);
    console.log('WorkspaceSid:', workspaceSid);

    // Build action URL from request to ensure correct host
    const reqUrl = new URL(req.url);
    const appUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const actionUrl = `${appUrl}/api/taskrouter/voicemail-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;
    const transcribeCallbackUrl = `${appUrl}/api/taskrouter/voicemail-transcription`;
    console.log('ActionUrl:', actionUrl);
    console.log('TranscribeCallbackUrl:', transcribeCallbackUrl);

    if (taskSid && workspaceSid) {
      try {
        const task = await client.taskrouter
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch();

        if (task.assignmentStatus === "assigned") {
          const reservations = await client.taskrouter
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .reservations
            .list({ limit: 1 });

          if (reservations.length) {
            await client.taskrouter
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .reservations(reservations[0].sid)
            .update({ reservationStatus: "completed" });

            console.log("✅ Completed live call reservation before voicemail");
          }
        }
      } catch (err) {
        console.error("⚠️ Failed to complete live task:", err);
      }
    }


    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">
    Sorry, all of our representatives are currently unavailable.
    Please leave a message after the beep, and we'll get back to you as soon as possible.
    When you're finished, press pound or simply hang up.
  </Say>
  <Record
    action="${encodeURI(actionUrl)}"
    finishOnKey="#"
    playBeep="true"
    transcribe="true"
    transcribeCallback="${encodeURI(transcribeCallbackUrl)}"
    maxLength="120"
    timeout="10"
  />
  <Say voice="alice">We did not receive your message. Goodbye.</Say>
  <Hangup/>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Voicemail handler error:', error);

    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred. Please try again later.</Say>
  <Hangup/>
</Response>`;

    return new Response(errorTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
