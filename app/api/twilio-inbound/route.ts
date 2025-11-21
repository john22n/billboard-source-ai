// app/api/twilio-inbound/route.ts
// Handles incoming Twilio calls and connects them to the browser client

import twilio from 'twilio';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    // Parse call data
    const CallSid = formData.get('CallSid');
    const From = formData.get('From');
    const To = formData.get('To');

    // ✅ SECURITY: Validate Twilio webhook signature
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioSignature = req.headers.get('x-twilio-signature');

    // Get the full URL - check for forwarded protocol and host
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const pathname = new URL(req.url).pathname;
    const fullUrl = `${protocol}://${host}${pathname}`;

    console.log(`📞 Webhook received from ${From} to ${To}`);
    console.log(`🔗 Validating URL: ${fullUrl}`);

    // Skip validation in development if auth token not set
    if (!authToken) {
      console.warn('⚠️ TWILIO_AUTH_TOKEN not configured - skipping signature validation (DEVELOPMENT ONLY)');
      if (process.env.NODE_ENV === 'production') {
        return new Response('Server configuration error', { status: 500 });
      }
    } else if (!twilioSignature) {
      console.error('❌ Missing Twilio signature header');
      return new Response('Unauthorized', { status: 401 });
    } else {
      // Convert FormData to plain object for validation
      const params: Record<string, string> = {};
      formData.forEach((value, key) => {
        params[key] = value.toString();
      });

      // Validate the request came from Twilio
      const isValid = twilio.validateRequest(
        authToken,
        twilioSignature,
        fullUrl,
        params
      );

      if (!isValid) {
        console.error('❌ Invalid Twilio signature');
        console.error('Expected URL:', fullUrl);
        console.error('Signature:', twilioSignature);
        console.error('Params:', Object.keys(params));
        return new Response('Unauthorized', { status: 401 });
      }

      console.log('✅ Twilio signature validated');
    }

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
