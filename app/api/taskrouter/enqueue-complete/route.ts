// Twilio REST API helpers
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const twilioAuth = () =>
  'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

async function twilioGet(path: string) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/${path}`,
    { headers: { Authorization: twilioAuth() } }
  );
  return res.json();
}

async function twilioPost(path: string, body: Record<string, string>) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: twilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    }
  );
  return res.json();
}

async function taskRouterPost(path: string, body: Record<string, string>) {
  const res = await fetch(
    `https://taskrouter.twilio.com/v1/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: twilioAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(body).toString(),
    }
  );
  return res.json();
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const queueResult = formData.get('QueueResult') as string;
    const queueTime = formData.get('QueueTime') as string;
    const callSid = formData.get('CallSid') as string;
    const from = formData.get('From') as string;
    const to = formData.get('To') as string;

    const url = new URL(req.url);
    const reservationSid = url.searchParams.get('reservationSid');
    const taskSid = url.searchParams.get('taskSid');
    const workspaceSid = url.searchParams.get('workspaceSid') || WORKSPACE_SID;
    const workerSid = url.searchParams.get('workerSid');

    console.log('═══════════════════════════════════════════');
    console.log('📞 ENQUEUE COMPLETE');
    console.log('QueueResult:', queueResult);
    console.log('QueueTime:', queueTime, 'seconds');
    console.log('CallSid:', callSid);
    console.log('From:', from);
    console.log('ReservationSid:', reservationSid ?? 'none');
    console.log('TaskSid:', taskSid ?? 'none');
    console.log('WorkerSid:', workerSid ?? 'none');
    console.log('═══════════════════════════════════════════');

    // ─────────────────────────────────────────────
    // CALL SUCCESSFULLY CONNECTED
    // ─────────────────────────────────────────────
    if (queueResult === 'bridged') {
      console.log('✅ Call was bridged to worker');
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // ─────────────────────────────────────────────
    // CALLER HUNG UP
    // ─────────────────────────────────────────────
    if (queueResult === 'hangup') {
      console.log('📞 Caller hung up while waiting in queue');

      // Try to get reservation context from URL params first
      let foundReservationSid = reservationSid;
      let foundWorkerSid = workerSid;

      // Fallback: Look up active conferences by caller SID to find simring context
      if (!foundReservationSid && callSid) {
        console.log(`🔍 No reservation context in URL — looking up active conferences for caller ${callSid}`);
        try {
          const conferencesRes = await twilioGet(`Conferences.json?Limit=10`);
          const conferences = conferencesRes.conferences || [];

          // Look for conference with simring pattern and our caller in it
          for (const conf of conferences as Array<{ friendlyName: string; sid: string; status: string }>) {
            if (conf.friendlyName.startsWith('simring-') && conf.status === 'in-progress') {
              // Extract reservationSid from conference name (format: simring-{reservationSid})
              const resIdMatch = conf.friendlyName.match(/^simring-(.+)$/);
              if (resIdMatch) {
                // Check if our caller is in this conference
                try {
                  const partsRes = await twilioGet(`Conferences/${conf.sid}/Participants.json`);
                  const participants = partsRes.participants || [];
                  const callerInConf = participants.some((p: { callSid: string }) => p.callSid === callSid);

                  if (callerInConf) {
                    foundReservationSid = resIdMatch[1];
                    console.log(`✅ Found reservation context from conference: ${foundReservationSid}`);
                    break;
                  }
                } catch (err) {
                  console.warn(`⚠️ Failed to check conference participants:`, (err as Error).message);
                }
              }
            }
          }
        } catch (err) {
          console.warn(`⚠️ Failed to look up conferences:`, (err as Error).message);
        }
      }

      // If simultaneous ring context found, clean up cell leg and reservation
      if (foundReservationSid && workspaceSid) {
        console.log(`🔍 Simultaneous ring context found (reservation: ${foundReservationSid}) — cleaning up`);

        // Fetch the reservation to get worker details
        try {
          const reservationRes = await fetch(
            `https://taskrouter.twilio.com/v1/Workspaces/${workspaceSid}/Reservations/${foundReservationSid}`,
            { headers: { Authorization: twilioAuth() } }
          );
          const reservationData = await reservationRes.json();
          const reservationWorkerSid = reservationData.workerSid;

          if (!reservationWorkerSid) {
            console.warn(`⚠️ Could not get workerSid from reservation`);
          } else {
            console.log(`📋 Fetching worker ${reservationWorkerSid} details...`);

            // Fetch worker to check simultaneous ring
            const workerRes = await fetch(
              `https://taskrouter.twilio.com/v1/Workspaces/${workspaceSid}/Workers/${reservationWorkerSid}`,
              { headers: { Authorization: twilioAuth() } }
            );
            const workerData = await workerRes.json();
            const workerAttrs = JSON.parse(workerData.attributes || '{}');

            if (workerAttrs.simultaneous_ring && workerAttrs.cell_phone) {
              console.log(`📱 Worker has simultaneous ring enabled — canceling cell leg`);

              // Step 1: Cancel any active cell calls to this worker's cell phone
              try {
                const cellCalls = await twilioGet(
                  `Calls.json?To=${encodeURIComponent(workerAttrs.cell_phone)}&PageSize=10`
                );
                const activeCells = (cellCalls.calls || []).filter((c: { status: string }) =>
                  ['initiated', 'ringing', 'in-progress'].includes(c.status)
                );

                if (activeCells.length > 0) {
                  console.log(`📵 Found ${activeCells.length} active cell call(s) — canceling...`);
                  for (const call of activeCells as Array<{ sid: string; status: string }>) {
                    try {
                      const newStatus = call.status === 'in-progress' ? 'completed' : 'canceled';
                      await twilioPost(`Calls/${call.sid}.json`, { Status: newStatus });
                      console.log(`✅ Cell call ${call.sid} ${newStatus}`);
                    } catch (err) {
                      console.warn(`⚠️ Could not cancel cell call:`, (err as Error).message);
                    }
                  }
                } else {
                  console.log(`ℹ️ No active cell calls found`);
                }
              } catch (err) {
                console.warn(`⚠️ Failed to cancel cell calls:`, (err as Error).message);
              }

              // Step 2: Reject the reservation so TaskRouter doesn't reassign
              try {
                await taskRouterPost(
                  `Workspaces/${workspaceSid}/Workers/${reservationWorkerSid}/Reservations/${foundReservationSid}`,
                  { ReservationStatus: 'rejected' }
                );
                console.log(`✅ Reservation ${foundReservationSid} rejected — TaskRouter will not reassign`);
              } catch (err) {
                const msg = (err as Error).message || '';
                if (msg.includes('already') || msg.includes('completed') || msg.includes('accepted')) {
                  console.log(`ℹ️ Reservation already resolved — skipping`);
                } else {
                  console.warn(`⚠️ Failed to reject reservation:`, msg);
                }
              }
            } else {
              console.log(`ℹ️ Worker does not have simultaneous ring enabled`);
            }
          }
        } catch (err) {
          console.warn(`⚠️ Failed to fetch reservation/worker details:`, (err as Error).message);
        }
      } else {
        console.log(`ℹ️ No worker context — not a simultaneous ring call`);
      }

      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
        { status: 200, headers: { 'Content-Type': 'text/xml' } }
      );
    }

    // ─────────────────────────────────────────────
    // TIMEOUT / NO AGENTS / REJECTED → VOICEMAIL
    // ─────────────────────────────────────────────
    console.log(`📨 QueueResult="${queueResult}" → voicemail`);

    const appUrl = `${url.protocol}//${url.host}`;

    const voicemailCompleteUrl = new URL(
      `${appUrl}/api/taskrouter/voicemail-complete`
    );
    voicemailCompleteUrl.searchParams.set('from', from || '');
    voicemailCompleteUrl.searchParams.set('to', to || '');
    voicemailCompleteUrl.searchParams.set('callSid', callSid || '');
    voicemailCompleteUrl.searchParams.set('queueTime', queueTime || '');

    const transcriptionUrl = new URL(
      `${appUrl}/api/taskrouter/voicemail-transcription`
    );
    transcriptionUrl.searchParams.set('from', from || '');
    transcriptionUrl.searchParams.set('to', to || '');
    transcriptionUrl.searchParams.set('callSid', callSid || '');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">
    We're sorry, no one is available to take your call.
    Please leave a message after the beep.
  </Say>
  <Record
    maxLength="120"
    playBeep="true"
    transcribe="true"
    transcribeCallback="${transcriptionUrl}"
    action="${voicemailCompleteUrl}"
    method="POST"
  />
  <Say voice="Polly.Matthew">Goodbye.</Say>
  <Hangup/>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('❌ Enqueue complete error:', error);
    return new Response(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
      { status: 200, headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

