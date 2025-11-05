// app/api/extract-billboard-fields/route.ts
export const runtime = "edge";

import { openai } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { z } from "zod";

const billboardLeadSchema = z.object({
  leadType: z.enum(["tire-kicker", "panel-requestor", "availer"]).nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  advertiser: z.string().nullable(),
  hasMediaExperience: z.boolean().nullable(),
  hasDoneBillboards: z.boolean().nullable(),
  businessDescription: z.string().nullable(),
  yearsInBusiness: z.string().nullable(),
  billboardPurpose: z.string().nullable(),
  targetCity: z.string().nullable(),
  targetArea: z.string().nullable(),
  startMonth: z.string().nullable(),
  campaignLength: z
    .enum(["1 Mo", "2 Mo", "3 Mo", "5 Mo", "12 Mo", "TBD"])
    .nullable(),
  budgetRange: z.enum(["small", "midsize", "major"]).nullable(),
  decisionMaker: z
    .enum(["alone", "partners", "boss", "committee"])
    .nullable(),
  notes: z.string().nullable(),
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
});

const SYSTEM_PROMPT = `You are an AI assistant analyzing sales call transcripts for a billboard advertising company.
Extract structured information to populate a lead form.

LEAD TYPE DEFINITIONS:
- "tire-kicker": Casual inquiry, not serious, general browsing
- "panel-requestor": Wants specific locations or panels
- "availer": Requests availability or inventory details

BUDGET RANGE MAPPING:
- "small": $750–18k/year or small market
- "midsize": $1.5k–36k/year or mid market
- "major": $3k–72k/year or large market

EXTRACTION RULES:
1. Extract only explicit or clearly implied data
2. Leave fields null when uncertain
3. Infer leadType based on conversation intent
4. Include confidence values based on clarity and completeness
`;

export async function POST(req: Request) {
  try {
    const { transcript, previousContext = [] } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let prompt = "";
    if (previousContext.length > 0) {
      prompt += `Previous conversation context:\n${previousContext.join(
        "\n\n"
      )}\n\n`;
    }
    prompt += `Extract structured information from this transcript:\n\n${transcript}`;

    // Stream structured object extraction in real time
    const result = await streamObject({
      model: openai("gpt-4o-mini"),
      schema: billboardLeadSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.1,
    });

    return result.toTextStreamResponse()

  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Billboard field extraction error:", error);
    return Response.json(
      { error: "Field extraction failed", details: message },
      { status: 500 }
    );
  }
}

