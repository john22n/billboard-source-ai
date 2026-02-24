/**
 * Cancel Cell Leg API
 *
 * Called by TwilioProvider when the agent rejects or hangs up on the app,
 * to ensure the simultaneous ring cell leg is terminated immediately.
 *
 * Accepts the worker's identity (email), looks up their cell_phone from
 * TaskRouter worker attributes, then cancels any active calls to that number.
 */
import twilio from 'twilio';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;
const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function POST(req: Request) {
  try {
    const { workerIdentity } = await req.json();

    if (!workerIdentity) {
      console.error('❌ cancel-cell: Missing workerIdentity in request body');
      return new Response('Missing workerIdentity', { status: 400 });
    }

    console.log(`🔍 cancel-cell: Looking up worker attributes for ${workerIdentity}...`);

    const workers = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.list({ friendlyName: workerIdentity, limit: 1 });

    if (workers.length === 0) {
      console.error(`❌ cancel-cell: No worker found for identity ${workerIdentity}`);
      return new Response('Worker not found', { status: 404 });
    }

    let attrs: { cell_phone?: string; simultaneous_ring?: boolean } = {};
    try {
      attrs = JSON.parse(workers[0].attributes);
    } catch {
      console.error('❌ cancel-cell: Failed to parse worker attributes');
      return new Response('Bad worker attributes', { status: 500 });
    }

    if (!attrs.simultaneous_ring || !attrs.cell_phone) {
      console.log(`ℹ️ cancel-cell: Worker ${workerIdentity} is not a simring worker — nothing to cancel`);
      return new Response('OK', { status: 200 });
    }

    const cellPhone = attrs.cell_phone;
    console.log(`📱 cancel-cell: Checking active calls to cell ${cellPhone}...`);

    // Fetch recent calls to this number and filter for active ones in JS
    // to avoid Twilio SDK CallStatus type issues
    const recentCalls = await client.calls.list({ to: cellPhone, limit: 10 });
    const activeCalls = recentCalls.filter((c) =>
      ['initiated', 'ringing', 'in-progress'].includes(c.status)
    );

    if (activeCalls.length === 0) {
      console.log(`ℹ️ cancel-cell: No active calls found to ${cellPhone} — already ended`);
      return new Response('OK', { status: 200 });
    }

    console.log(`📵 cancel-cell: Found ${activeCalls.length} active call(s) to ${cellPhone} — canceling...`);

    for (const call of activeCalls) {
      try {
        const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';
        await client.calls(call.sid).update({ status: newStatus });
        console.log(`✅ cancel-cell: Call ${call.sid} → ${newStatus}`);
      } catch (err) {
        const msg = (err as Error).message || '';
        if (msg.includes('completed') || msg.includes('canceled') || msg.includes('no-answer')) {
          console.log(`ℹ️ cancel-cell: Call ${call.sid} already ended — ${msg}`);
        } else {
          console.error(`❌ cancel-cell: Failed to cancel call ${call.sid}:`, msg);
        }
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('❌ cancel-cell error:', (err as Error).message);
    return new Response('Error', { status: 500 });
  }
}