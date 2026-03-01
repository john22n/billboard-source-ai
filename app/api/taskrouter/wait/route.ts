/**
 * TaskRouter Wait URL
 *
 * Plays hold music while caller waits in the TaskRouter queue.
 * Uses loop="0" for infinite playback — no redirect needed.
 * The Say verb is intentionally omitted so the caller hears
 * seamless music without a repeated hold announcement on every
 * re-enqueue (e.g. when a worker rejects and the call is rotated
 * to the next available agent).
 */
export async function POST(req: Request) {
  const url   = new URL(req.url);
  const retry = url.searchParams.get('retry') === 'true';

  // Only announce on the first time the caller enters the queue.
  // On re-enqueue (worker rejected/dismissed), skip the Say so the
  // caller hears seamless hold music without a repeated announcement.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${!retry ? '<Say voice="Polly.Joanna">Please hold while we connect you with the next available representative.</Say>' : ''}
  <Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/ClockworkWaltz.mp3</Play>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}