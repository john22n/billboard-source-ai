/**
 * TaskRouter Wait URL
 *
 * Plays hold message while caller waits in the TaskRouter queue.
 * Redirects back to itself to keep the call alive and allow TaskRouter to attempt worker assignment.
 */

export async function POST(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while we connect you with the next available representative.</Say>
  <Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/ClockworkWaltz.mp3</Play>
  <!-- Redirect back to this wait URL to keep the caller in the queue -->
  <Redirect>${baseUrl}/api/taskrouter/wait</Redirect>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

