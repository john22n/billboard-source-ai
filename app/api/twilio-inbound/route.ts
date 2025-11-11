// pages/api/twilio-inbound.js
// Handles incoming Twilio calls and connects them to the browser client

export default function handler(req, res) {
  const { CallSid, From, To } = req.body;

  console.log(`Incoming call from ${From} to ${To}, CallSid: ${CallSid}`);

  // Generate TwiML that dials the browser client
  // The client identity should match what's registered with Twilio Voice SDK
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>sales-agent</Client>
  </Dial>
</Response>`;

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml);
}
