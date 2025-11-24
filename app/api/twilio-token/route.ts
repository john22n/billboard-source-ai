// app/api/twilio-token/route.ts
// Generates Twilio access token for Voice SDK

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import twilio from "twilio";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export async function GET() {
  // ✅ SECURITY: Require authentication
  const session = await getSession();
  if (!session?.userId) {
    return NextResponse.json(
      { error: "Unauthorized - Please log in" },
      { status: 401 }
    );
  }

  // Use authenticated user's email instead of query param
  const email = session.email;

  if (!email) {
    return NextResponse.json(
      { error: "User email not found in session" },
      { status: 400 }
    );
  }

  // Validate required environment variables
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

  if (!accountSid || !apiKeySid || !apiKeySecret) {
    return NextResponse.json(
      { error: "Missing required Twilio credentials" },
      { status: 500 }
    );
  }

  // Create access token
  // Use email prefix as identity (@ symbol can cause routing issues)
  const identity = email.split('@')[0];
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
    identity: identity,
    ttl: 3600, // Token valid for 1 hour
  });

  // Create a Voice grant
  const voiceGrant = new VoiceGrant({
    incomingAllow: true, // Allow incoming calls
  });

  token.addGrant(voiceGrant);

  console.log(`🔐 Twilio token generated for authenticated user: ${identity}`);

  return NextResponse.json({
    token: token.toJwt(),
    identity: identity,
  });
}

