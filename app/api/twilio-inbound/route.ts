// app/api/twilio-inbound/route.ts
// Handles incoming Twilio calls and enqueues them into TaskRouter
import twilio from 'twilio';
import { db } from '@/db';
import { user } from '@/db/schema';
import { eq } from 'drizzle-orm';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID;

export async function POST(req: Request) {
  try {
    // Clone request to read body twice (once for validation, once for parsing)
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // Validate Twilio request signature in production
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const url = new URL(req.url);
      // Use the full URL as Twilio sends it
      const webhookUrl = url.toString();

      // Parse body params for validation
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
        console.error('❌ Invalid Twilio signature');
        return new Response('Forbidden', { status: 403 });
      }
    } else {
      console.warn('⚠️ TWILIO_AUTH_TOKEN not set - skipping signature validation');
    }

    // Parse call data
    const CallSid = formData.get('CallSid');
    const From = formData.get('From');
    const To = formData.get('To') as string;

    console.log(`📞 Webhook received from ${From} to ${To}`);
    console.log(`✅ Verified incoming call from ${From} to ${To}, CallSid: ${CallSid}`);

    // Look up user by Twilio phone number
    // Twilio sends number as +18338547126, DB may store as 833-854-7126
    const normalizedTo = To?.replace(/\D/g, '').slice(-10); // Get last 10 digits

    const matchedUser = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.twilioPhoneNumber, To))
      .limit(1)
      .then(rows => rows[0]);

    // Fallback: try matching normalized number if exact match fails
    let clientIdentity: string | undefined = matchedUser?.email;
    if (!clientIdentity && normalizedTo) {
      const users = await db.select({ email: user.email, phone: user.twilioPhoneNumber }).from(user);
      const match = users.find(u => u.phone?.replace(/\D/g, '').slice(-10) === normalizedTo);
      clientIdentity = match?.email ?? undefined;
    }

    if (!clientIdentity) {
      console.error(`❌ No user found for phone number: ${To}`);
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Sorry, this number is not configured. Goodbye.</Say>
  <Hangup/>
</Response>`;
      return new Response(errorTwiml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    if (!WORKFLOW_SID) {
      console.error('❌ TASKROUTER_WORKFLOW_SID not set');
      return new Response('Server config error', { status: 500 });
    }

    console.log(`📲 Enqueuing call to TaskRouter for: ${clientIdentity}`);

    // Build task attributes for TaskRouter
    // call_sid is auto-added by Twilio for <Enqueue>, but we include it explicitly
    const taskAttributes = JSON.stringify({
      call_sid: CallSid,
      from: From,
      to: To,
      primary_owner: clientIdentity,
    });

    // Build voicemail fallback URL
    const reqUrl = new URL(req.url);
    const appUrl = `${reqUrl.protocol}//${reqUrl.host}`;
    const voicemailUrl = `${appUrl}/api/taskrouter/voicemail`;

    // Enqueue call into TaskRouter workflow
    // TaskRouter will route to available workers
    // If Enqueue ends without connecting (caller hangs up), fall through to voicemail
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Enqueue workflowSid="${WORKFLOW_SID}">
    <Task>${taskAttributes}</Task>
  </Enqueue>
  <Redirect method="POST">${voicemailUrl}</Redirect>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });
  } catch (error) {
    console.error('Twilio inbound error:', error);
    return new Response('Error processing call', { status: 500 });
  }
}
