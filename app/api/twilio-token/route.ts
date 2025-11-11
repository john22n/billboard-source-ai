// app/api/twilio-token/route.ts
// Generates Twilio access token for Voice SDK

import { NextResponse } from 'next/server';
import twilio from 'twilio';

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export async function GET() {
  // Validate required environment variables
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return NextResponse.json(
      { error: 'Missing required Twilio credentials' },
      { status: 500 }
    );
  }

  // Create access token
  const token = new AccessToken(
    accountSid,
    apiKeySid,
    apiKeySecret,
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

  return NextResponse.json({
    token: token.toJwt(),
    identity: 'sales-agent'
  });
}
