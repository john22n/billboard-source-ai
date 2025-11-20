// app/api/extract-billboard-fields/route.ts
export const runtime = "edge";

import { openai } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { z } from "zod";

const billboardLeadSchema = z.object({
  leadType: z
    .enum(["tire-kicker", "panel-requestor", "availer"])
    .nullable()
    .describe("Type of lead: tire-kicker (low intent), panel-requestor (wants availability info), or availer (ready to book)."),
  name: z.string().nullable().describe("Full name business contact."),
  phone: z.string().nullable().describe("Phone number for the contact."),
  email: z.string().nullable().describe("Email address of the contact."),
  website: z.string().nullable().describe("Website URL of the advertiser or business."),
  advertiser: z.string().nullable().describe("Name of the business or brand being advertised."),
  hasMediaExperience: z.boolean().nullable().describe("True if the lead has prior media buying or advertising experience."),
  hasDoneBillboards: z.boolean().nullable().describe("True if the lead has previously run billboard campaigns."),
  businessDescription: z.string().nullable().describe("Short summary of what the business does."),
  yearsInBusiness: z.string().nullable().describe("Number of years the business has been operating."),
  billboardPurpose: z.string().nullable().describe("Purpose or goal of running billboard ads (e.g., brand awareness, event promotion)."),
  targetCity: z.string().nullable().describe("City and state where the lead wants billboards, formatted as 'City, State' (e.g., 'Austin, TX' or 'Los Angeles, California')"),
  targetArea: z.string().nullable().describe("ONLY extract county name OR highway/road name. Examples: 'Travis County', 'I-35', 'Highway 290'. DO NOT include city names here - cities go in targetCity field."),
  startMonth: z.string().nullable().describe("Preferred start month of the campaign. for example: January 2026"),
  campaignLength: z
    .enum(["1 Mo", "2 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"])
    .nullable()
    .describe("Length of the campaign in months, or TBD if undecided."),
  decisionMaker: z
    .enum(["alone", "partners", "boss", "committee"])
    .nullable()
    .describe("Who makes the advertising decision for this lead."),
  notes: z.string().nullable().describe("Any extra notes or context from the conversation."),
  confidence: z
    .object({
      overall: z.number().min(0).max(100).describe("Overall confidence score (0–100)."),
      fieldsExtracted: z.number().describe("Number of fields successfully extracted."),
      totalFields: z.number().describe("Total number of fields expected."),
    })
    .describe("Confidence metadata for this extraction."),
}).describe("Schema for a billboard advertising lead extracted from a conversation to fill an form input.");


const SYSTEM_PROMPT = `You are an AI assistant analyzing sales call transcripts for a billboard advertising company.
Extract structured information to populate a lead form.

LEAD TYPE DEFINITIONS:
- "tire-kicker": Casual inquiry, not serious, general browsing
- "panel-requestor": Wants specific locations or panels
- "availer": Requests availability or inventory details

LOCATION FORMATTING:
- Always format targetCity as "City, State" (e.g., "Austin, TX" or "Los Angeles, California")
- If only city is mentioned, include the state if you can infer it from context
- Use standard 2-letter state abbreviations when possible (TX, CA, NY, etc.)
- If multiple cities mentioned, include the primary target city

EXTRACTION RULES:
1. Extract only explicit or clearly implied data
2. Leave fields null or empty when uncertain
3. Infer leadType based on conversation intent
4. Include confidence values based on clarity and completeness
5. For targetCity, combine city and state into a single field
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

  } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Billboard field extraction error:", error);
      return Response.json(
        { error: "Field extraction failed", details: message },
        { status: 500 }
      );
  }
}