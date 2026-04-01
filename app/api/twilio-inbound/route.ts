// app/api/twilio-inbound/route.ts
// Handles incoming Twilio calls and enqueues them into TaskRouter
import twilio from 'twilio';
import { db } from '@/db';
import { user } from '@/db/schema';
import { eq } from 'drizzle-orm';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const WORKFLOW_SID = process.env.TASKROUTER_WORKFLOW_SID;
const MAIN_ROUTING_NUMBER = '+18338547126';

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // Validate Twilio signature — skip on preview deployments
    const isProduction = process.env.VERCEL_ENV === 'production';

    if (TWILIO_AUTH_TOKEN && isProduction) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const url = new URL(req.url);
      const params: Record<string, string> = {};
      const searchParams = new URLSearchParams(bodyText);
      searchParams.forEach((value, key) => {
        params[key] = value;
      });

      const isValid = twilio.validateRequest(
        TWILIO_AUTH_TOKEN,
        twilioSignature,
        url.toString(),
        params
      );

      if (!isValid) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const CallSid = formData.get('CallSid');
    const From = formData.get('From');
    const To = formData.get('To') as string;

    if (!WORKFLOW_SID) {
      return new Response('Workflow not configured', { status: 500 });
    }

    let callType: 'main' | 'direct';
    let phoneNumber: string | null = null;
    let primaryOwner: string | null = null;

    // ─────────────────────────────────────────────
    // MAIN NUMBER → RANDOM AGENTS
    // ─────────────────────────────────────────────
    if (To === MAIN_ROUTING_NUMBER) {
      callType = 'main';
    } else {
      // ─────────────────────────────────────────────
      // DIRECT NUMBER → SINGLE AGENT
      // ─────────────────────────────────────────────
      callType = 'direct';
      phoneNumber = To;

      const matchedUser = await db
        .select()
        .from(user)
        .where(eq(user.twilioPhoneNumber, To))
        .limit(1)
        .then(rows => rows[0]);

      if (!matchedUser) {
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
        <Response>
          <Say>This number is not configured.</Say>
          <Hangup/>
        </Response>`;
        return new Response(errorTwiml, {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        });
      }

      primaryOwner = matchedUser.email;
    }

    const taskAttributes = JSON.stringify({
      call_sid: CallSid,
      from: From,
      callTo: To,
      callType,
      phoneNumber,
      primary_owner: primaryOwner,
      excluded_workers: [],
    });

    const appUrl = (
      process.env.NEXT_PUBLIC_APP_URL ?? `${new URL(req.url).protocol}//${new URL(req.url).host}`
    ).replace(/\/$/, '');

    const waitUrlObj = new URL(`${appUrl}/api/taskrouter/wait`);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      waitUrlObj.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    const enqueueActionUrlObj = new URL(`${appUrl}/api/taskrouter/enqueue-complete`);
    if (process.env.VERCEL_BYPASS_TOKEN) {
      enqueueActionUrlObj.searchParams.set('x-vercel-protection-bypass', process.env.VERCEL_BYPASS_TOKEN);
    }

    const escapedWaitUrl          = waitUrlObj.toString().replace(/&/g, '&amp;');
    const escapedEnqueueActionUrl = enqueueActionUrlObj.toString().replace(/&/g, '&amp;');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This call may be recorded for quality and training purposes.</Say>
  <Say voice="Polly.Joanna">Please hold while we connect you with the next available representative.</Say>
  <Enqueue workflowSid="${WORKFLOW_SID}"
           action="${escapedEnqueueActionUrl}"
           method="POST"
           waitUrl="${escapedWaitUrl}"
           waitUrlMethod="POST">
    <Task>${taskAttributes}</Task>
  </Enqueue>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (err) {
    console.error('Inbound error:', err);
    return new Response('Error', { status: 500 });
  }
}