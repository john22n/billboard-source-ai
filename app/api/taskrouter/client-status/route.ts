/**
 * Client Status Callback — Simultaneous Ring
 *
 * Fired by Twilio for every status change on the <Client> noun leg inside
 * the simultaneous-dial <Dial>. When the browser client rejects or dismisses
 * the call (CallStatus = "no-answer" | "canceled" | "busy"), this handler
 * immediately cancels the outbound cell phone leg via the REST API so it
 * stops ringing instead of waiting for the full 20s timeout.
 *
 * Query parameters (set by simultaneous-dial/route.ts):
 *   cellPhone — E.164 cell number to cancel (e.g. "+19565551234")
 *   taskSid   — TaskRouter Task SID (for logging)
 */

import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN!;

export async function POST(req: Request) {
  try {
    const url      = new URL(req.url);
    const cellPhone = url.searchParams.get('cellPhone');
    const taskSid   = url.searchParams.get('taskSid');

    const formData   = await req.formData();
    const callStatus = formData.get('CallStatus') as string | null;
    const callSid    = formData.get('CallSid')    as string | null;

    console.log('═══════════════════════════════════════════');
    console.log('📱 CLIENT STATUS CALLBACK');
    console.log('CallStatus:', callStatus);
    console.log('CallSid:',    callSid);
    console.log('TaskSid:',    taskSid);
    console.log('CellPhone:',  cellPhone?.replace(/\d(?=\d{4})/g, '*'));
    console.log('═══════════════════════════════════════════');

    // Only act when the browser leg ended without answering
    const browserRejected =
      callStatus === 'no-answer' ||
      callStatus === 'canceled'  ||
      callStatus === 'busy';

    if (browserRejected && cellPhone) {
      console.log(`🚫 Browser leg "${callStatus}" — canceling cell leg to ${cellPhone.replace(/\d(?=\d{4})/g, '*')}`);

      const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

      // Find all active outbound calls to the cell number and cancel them.
      // We filter by `to` and `status=ringing` to avoid touching unrelated calls.
      const activeCalls = await client.calls.list({
        to:     cellPhone,
        status: 'ringing',
      });

      console.log(`   Found ${activeCalls.length} ringing call(s) to cell`);

      await Promise.all(
        activeCalls.map(call =>
          client.calls(call.sid)
            .update({ status: 'canceled' })
            .then(() => console.log(`   ✅ Canceled cell leg ${call.sid}`))
            .catch((err: Error) => console.error(`   ❌ Failed to cancel ${call.sid}:`, err.message))
        )
      );
    } else {
      console.log(`ℹ️ CallStatus="${callStatus}" — no action needed`);
    }

    // Always return 204 — Twilio doesn't need TwiML from a statusCallback
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Client status callback error:', error);
    return new Response(null, { status: 500 });
  }
}