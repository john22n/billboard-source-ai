/**
 * Cancel Cell Leg API
 *
 * Called by TwilioProvider when the agent rejects or hangs up on the app,
 * to ensure the simultaneous ring cell leg is terminated immediately.
 *
 * This is necessary because:
 * - rejectCall: conference never forms, so conference-end never fires
 * - hangupCall: conference-end fires but this acts as an immediate safety net
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const { cellCallSid } = await req.json();

    if (!cellCallSid) {
      console.error('❌ cancel-cell: Missing cellCallSid in request body');
      return new Response('Missing cellCallSid', { status: 400 });
    }

    console.log(`🔍 cancel-cell: Fetching status for cell call ${cellCallSid}...`);

    const call = await client.calls(cellCallSid).fetch();
    console.log(`📞 cancel-cell: Cell call status is "${call.status}"`);

    // Use 'completed' for in-progress calls, 'canceled' for calls still ringing/initiated
    const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';

    await client.calls(cellCallSid).update({ status: newStatus });
    console.log(`✅ cancel-cell: Cell leg ${cellCallSid} → ${newStatus}`);

    return new Response('OK', { status: 200 });
  } catch (err) {
    const msg = (err as Error).message || '';

    // If the call is already ended, that's fine — not a real error
    if (msg.includes('completed') || msg.includes('canceled') || msg.includes('no-answer')) {
      console.log(`ℹ️ cancel-cell: Cell leg already ended — ${msg}`);
      return new Response('OK', { status: 200 });
    }

    console.error('❌ cancel-cell error:', msg);
    return new Response('Error', { status: 500 });
  }
}