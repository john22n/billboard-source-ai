"use server";

import OpenAI from "openai";

export async function getSessionToken() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const session = await openai.beta.realtime.sessions.create({
    model: "gpt-4o-realtime-preview",
  });

  return session.client_secret.value;
}
