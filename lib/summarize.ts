"use server";

import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function summarizeCall(transcript: string) {
  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
          You are a structured summarization agent.
          Summarize this sales call into an HTML form with fields:
          <CustomerName>, <Phone>, <Email>, <Website>, <Company Name>, and <Summary>.
        `,
      },
      { role: "user", content: transcript },
    ],
  });

  return result.choices[0].message.content ?? "";
}

