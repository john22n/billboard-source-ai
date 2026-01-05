/**
 * Bridge to Worker - TwiML Endpoint
 * 
 * Generates TwiML to dial a worker's browser with the original caller's
 * phone number passed as a custom parameter.
 */

import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();

    // Validate Twilio signature
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const reqUrl = new URL(req.url);
      const webhookUrl = reqUrl.toString();

      const params: Record<string, string> = {};
      const searchParams = new URLSearchParams(bodyText);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const isValid = twilio.validateRequest(
        TWILIO_AUTH_TOKEN,
        twilioSignature,
        webhookUrl,
        params
      );

      if (!isValid) {
        console.warn('⚠️ Invalid Twilio signature on bridge-to-worker');
      }
    }

    // Get parameters from URL
    const url = new URL(req.url);
    const workerIdentity = url.searchParams.get('worker') || '';
    const originalFrom = url.searchParams.get('originalFrom') || 'Unknown';
    const taskSid = url.searchParams.get('taskSid') || '';
    const workspaceSid = url.searchParams.get('workspaceSid') || '';

    console.log('═══════════════════════════════════════════');
    console.log('🌉 BRIDGE TO WORKER');
    console.log('═══════════════════════════════════════════');
    console.log('Worker:', workerIdentity);
    console.log('Original Caller:', originalFrom);
    console.log('TaskSid:', taskSid);
    console.log('═══════════════════════════════════════════');

    // Build status callback URL
    const appUrl = `${url.protocol}//${url.host}`;
    const statusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?taskSid=${taskSid}&workspaceSid=${workspaceSid}`;

    // Generate TwiML that dials the client with custom parameters
    // The 'originalFrom' parameter will be accessible in the browser via:
    // call.customParameters.get('originalFrom')
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" callerId="${process.env.TWILIO_MAIN_NUMBER || '+18338547126'}" action="${statusCallbackUrl}">
    <Client>
      <Identity>${workerIdentity}</Identity>
      <Parameter name="originalFrom" value="${originalFrom}"/>
      <Parameter name="taskSid" value="${taskSid}"/>
    </Client>
  </Dial>
</Response>`;

    console.log('✅ Generated TwiML with originalFrom:', originalFrom);

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error('❌ Bridge to worker error:', error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, there was an error connecting your call.</Say>
  <Hangup/>
</Response>`;
    
    return new Response(errorTwiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}