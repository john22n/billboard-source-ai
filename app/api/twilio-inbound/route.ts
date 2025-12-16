// app/api/twilio-inbound/route.ts
// Handles incoming Twilio calls and connects them to the browser client
import twilio from 'twilio';

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

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
    const To = formData.get('To');

    console.log(`📞 Webhook received from ${From} to ${To}`);
    console.log(`✅ Verified incoming call from ${From} to ${To}, CallSid: ${CallSid}`);

    // Generate TwiML that dials the browser client
    // The client identity should match what's registered with Twilio Voice SDK
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>sky@billboardsource.com</Client>
  </Dial>
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
