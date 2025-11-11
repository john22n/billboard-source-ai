// pages/api/twilio-token.js
// Generates Twilio access token for Voice SDK

const twilio = require('twilio');

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export default function handler(req, res) {
  // Create access token
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY_SID,
    process.env.TWILIO_API_KEY_SECRET,
    {
      identity: 'sales-agent', // Must match the <Client> identity in TwiML
      ttl: 3600 // Token valid for 1 hour
    }
  );

  // Create a Voice grant
  const voiceGrant = new VoiceGrant({
    incomingAllow: true, // Allow incoming calls
  });

  token.addGrant(voiceGrant);

  res.status(200).json({
    token: token.toJwt(),
    identity: 'sales-agent'
  });
}
