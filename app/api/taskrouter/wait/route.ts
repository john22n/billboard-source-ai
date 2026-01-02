/**
 * TaskRouter Wait URL
 * 
 * Plays hold music while caller waits in the TaskRouter queue.
 * Called periodically by Twilio while the call is enqueued.
 */

export async function POST() {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold while we connect you with the next available representative.</Say>
  <Play loop="0">http://com.twilio.sounds.music.s3.amazonaws.com/oldDog_-_endless_summer.mp3</Play>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
