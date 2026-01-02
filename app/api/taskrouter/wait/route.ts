/**
 * TaskRouter Wait URL
 * 
 * Plays hold message while caller waits in the TaskRouter queue.
 * Called periodically by Twilio while the call is enqueued.
 * 
 * IMPORTANT: Must use <Play> with loop or <Redirect> to keep the call alive.
 * Using <Pause> alone can cause issues with TaskRouter routing.
 */

export async function POST(req: Request) {
  // Get the base URL for the redirect
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  
  // Use redirect pattern to keep the call alive and allow TaskRouter to route
  // This plays a brief message then redirects back to itself, keeping the queue active
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while we connect you with the next available representative.</Say>
  <Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/ClockworkWaltz.mp3</Play>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
