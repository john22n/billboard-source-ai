/**
 * TaskRouter Wait URL
 *
 * Plays hold music while caller waits in the TaskRouter queue.
 * The "please hold" greeting is spoken once in twilio-inbound BEFORE
 * the call enters the queue, so it can never be interrupted by TaskRouter.
 * This handler just plays seamless music for the duration of the wait,
 * including any re-enqueue cycles when a worker rejects the call.
 */
export async function POST(req: Request) {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/ClockworkWaltz.mp3</Play>
</Response>`;

  return new Response(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}