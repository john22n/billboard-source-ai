// app/api/twilio-inbound/route.ts
// Handles incoming Twilio calls and connects them to the browser client

export async function POST(req: Request) {
  try {
    // Parse form data from Twilio webhook
    const formData = await req.formData();
    const CallSid = formData.get('CallSid');
    const From = formData.get('From');
    const To = formData.get('To');

    console.log(`Incoming call from ${From} to ${To}, CallSid: ${CallSid}`);

    // Generate TwiML that dials the browser client
    // The client identity should match what's registered with Twilio Voice SDK
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>sales-agent</Client>
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
