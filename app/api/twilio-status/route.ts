/**
 * Twilio Call Status Callback
 *
 * Handles general call status updates.
 * With the dequeue approach for simultaneous ring, most cleanup
 * is handled automatically by TaskRouter. This file handles
 * standard call status logging only.
 */
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone();
    const bodyText = await clonedReq.text();
    const formData = await req.formData();

    // Signature validation
    if (TWILIO_AUTH_TOKEN) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || '';
      const webhookUrl = new URL(req.url).toString();
      const params: Record<string, string> = {};
      new URLSearchParams(bodyText).forEach(
        (value, key) => (params[key] = value)
      );
      if (
        !twilio.validateRequest(
          TWILIO_AUTH_TOKEN,
          twilioSignature,
          webhookUrl,
          params
        )
      ) {
        console.error('❌ Invalid Twilio signature');
        return new Response('Forbidden', { status: 403 });
      }
    }

    const CallSid = formData.get('CallSid') as string;
    const CallStatus = formData.get('CallStatus') as string;
    const CallDuration = formData.get('CallDuration') as string;
    const From = formData.get('From') as string;
    const To = formData.get('To') as string;
    const Timestamp = formData.get('Timestamp') as string;

    const url = new URL(req.url);
    const callType = url.searchParams.get('type');

    console.log(`📊 Call status update: ${CallStatus}`, {
      CallSid,
      CallStatus,
      CallDuration: CallDuration ? `${CallDuration}s` : undefined,
      From,
      To,
      Timestamp,
      callType: callType || 'standard',
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('❌ Twilio status callback error:', error);
    return new Response('Error processing status', { status: 500 });
  }
}