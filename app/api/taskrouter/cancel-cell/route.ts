/**
 * Cancel Cell Leg API
 *
 * Called by TwilioProvider when the agent rejects or hangs up on the app,
 * to ensure the simultaneous ring cell leg is terminated immediately.
 *
 * Uses raw fetch against the Twilio REST API to avoid TypeScript SDK
 * type issues with CallListInstanceOptions overload resolution.
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

// Basic auth header for Twilio REST API
const twilioAuth = () =>
  'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

async function twilioGet(path: string) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/${path}`, {
    headers: { Authorization: twilioAuth() },
  });
  return res.json();
}

async function twilioPost(path: string, body: Record<string, string>) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: twilioAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

export async function POST(req: Request) {
  try {
    const { workerIdentity } = await req.json();

    if (!workerIdentity) {
      console.error('❌ cancel-cell: Missing workerIdentity in request body');
      return new Response('Missing workerIdentity', { status: 400 });
    }

    console.log(`🔍 cancel-cell: Looking up worker for ${workerIdentity}...`);

    // Look up worker by friendly name via Twilio TaskRouter REST API
    const workersRes = await fetch(
      `https://taskrouter.twilio.com/v1/Workspaces/${WORKSPACE_SID}/Workers?FriendlyName=${encodeURIComponent(workerIdentity)}&PageSize=1`,
      { headers: { Authorization: twilioAuth() } }
    );
    const workersData = await workersRes.json();

    if (!workersData.workers || workersData.workers.length === 0) {
      console.error(`❌ cancel-cell: No worker found for ${workerIdentity}`);
      return new Response('Worker not found', { status: 404 });
    }

    let attrs: { cell_phone?: string; simultaneous_ring?: boolean } = {};
    try {
      attrs = JSON.parse(workersData.workers[0].attributes);
    } catch {
      console.error('❌ cancel-cell: Failed to parse worker attributes');
      return new Response('Bad worker attributes', { status: 500 });
    }

    if (!attrs.simultaneous_ring || !attrs.cell_phone) {
      console.log(`ℹ️ cancel-cell: Worker ${workerIdentity} is not a simring worker — nothing to cancel`);
      return new Response('OK', { status: 200 });
    }

    const cellPhone = attrs.cell_phone;
    console.log(`📱 cancel-cell: Fetching active calls to ${cellPhone}...`);

    // Fetch calls to this cell phone number via raw REST API — avoids SDK type issues
    const callsRes = await twilioGet(
      `Calls.json?To=${encodeURIComponent(cellPhone)}&PageSize=10`
    );

    const activeCalls = (callsRes.calls || []).filter((c: { status: string }) =>
      ['initiated', 'ringing', 'in-progress'].includes(c.status)
    );

    if (activeCalls.length === 0) {
      console.log(`ℹ️ cancel-cell: No active calls found to ${cellPhone} — already ended`);
      return new Response('OK', { status: 200 });
    }

    console.log(`📵 cancel-cell: Found ${activeCalls.length} active call(s) — canceling...`);

    for (const call of activeCalls as Array<{ sid: string; status: string }>) {
      try {
        const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';
        await twilioPost(`Calls/${call.sid}.json`, { Status: newStatus });
        console.log(`✅ cancel-cell: Call ${call.sid} → ${newStatus}`);
      } catch (err) {
        console.error(`❌ cancel-cell: Failed to cancel call ${call.sid}:`, (err as Error).message);
      }
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('❌ cancel-cell error:', (err as Error).message);
    return new Response('Error', { status: 500 });
  }
}