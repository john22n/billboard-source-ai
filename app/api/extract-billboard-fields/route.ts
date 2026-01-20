// app/api/extract-billboard-fields/route.ts
import { openai } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { LeadSentiment, LeadType, BillboardPurpose } from "@/types/sales-call";

// ============================================================
// SCHEMA DEFINITION - Descriptions here are the SINGLE source of truth
// ============================================================

const billboardLeadSchema = z.object({
  // === LEAD CLASSIFICATION ===
  leadType: z.enum([LeadSentiment.AVAILER, LeadSentiment.PANEL_REQUESTER, LeadSentiment.TIRE_KICKER]).nullable()
    .describe("Caller intent: 'Availer'=wants availability/ready to buy, 'Panel Requester'=asking about specific panels, 'Tire Kicker'=low intent/browsing"),

  // === BUSINESS IDENTIFICATION ===
  typeName: z.enum([
    LeadType.ESTABLISHED_B2B,
    LeadType.ESTABLISHED_B2C,
    LeadType.NEW_B2B,
    LeadType.NEW_B2C,
    LeadType.NON_PROFIT,
    LeadType.POLITICAL,
    LeadType.PERSONAL,
  ]).nullable()
    .describe("Business classification: Established(2+yrs)/New + B2B(sells to businesses)/B2C(sells to consumers), or Non-Profit/Political/Personal"),
  
  businessName: z.string().nullable()
    .describe("Industry/category: 'HVAC', 'Restaurant', 'Law Firm' for business; 'Governor', 'Mayor' for political; 'Food Bank' for nonprofit"),
  
  entityName: z.string().nullable()
    .describe("Official business/organization name: 'Bob's HVAC', 'Committee to Elect Jane Doe'"),

  // === BILLBOARD EXPERIENCE ===
  billboardsBeforeYN: z.enum(["Y", "N"]).nullable()
    .describe("Has caller used billboards before? Y or N only"),
  
  billboardsBeforeDetails: z.string().nullable()
    .describe("If Y: describe experience ('10 years ago', 'in another city'). If N: must be 'None'"),

  // === CAMPAIGN GOALS ===
  billboardPurpose: z.enum([
    BillboardPurpose.DIRECTIONAL,
    BillboardPurpose.ENROLLMENT,
    BillboardPurpose.EVENT,
    BillboardPurpose.GENERAL_BRAND_AWARENESS,
    BillboardPurpose.HIRING,
    BillboardPurpose.NEW_LOCATION,
    BillboardPurpose.NEW_PRODUCT_SERVICE,
    BillboardPurpose.POLITICAL,
  ]).nullable()
    .describe("Primary goal: Directional(guide to location), Enrollment(signups), Event(specific event), General Brand Awareness(visibility), Hiring(recruitment), New Location(grand opening), New Product/Service(launch), Political(campaign)"),
  
  accomplishDetails: z.string().nullable()
    .describe("Additional context about goals not captured by billboardPurpose"),
  
  targetAudience: z.string().nullable()
    .describe("Who they want to reach: 'Homeowners', 'Commuters on I-35', 'Families'"),

  // === BUSINESS DETAILS ===
  hasMediaExperience: z.string().nullable()
    .describe("Other advertising they do. If yes: 'Facebook ads', 'Radio', 'TV'. If no/none mentioned: 'None'"),
  
  yearsInBusiness: z.string().nullable()
    .describe("How long in business: '5 years', 'New business', '10+ years'"),
  
  website: z.string().nullable()
    .describe("Website URL if mentioned, otherwise 'None'"),

  // === CAMPAIGN DETAILS ===
  targetCity: z.string().nullable()
    .describe("City name only without state: 'Dallas', 'Austin', 'Los Angeles'"),
  
  state: z.string().nullable()
    .describe("Two-letter state code only: 'TX', 'CA', 'NY'"),
  
  targetArea: z.string().nullable()
    .describe("Specific roads/highways/areas: 'I-35', 'Highway 183', 'Downtown'"),
  
  startMonth: z.string().nullable()
    .describe("When to start: 'ASAP', 'January 2026', 'March'"),
  
  campaignLength: z.array(z.enum(["1 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"])).nullable()
    .describe("Duration(s) discussed - include ALL mentioned: ['3 Mo'] or ['3 Mo', '6 Mo'] if comparing"),
  
  boardType: z.enum(["Static", "Digital", "Both"]).nullable()
    .describe("Billboard type preference"),

  // === CONTACT INFO ===
  name: z.string().nullable()
    .describe("Caller's full name"),
  
  position: z.string().nullable()
    .describe("Job title: 'Owner', 'Marketing Director', 'Manager'"),
  
  phone: z.string().nullable()
    .describe("Phone number in (XXX) XXX-XXXX format - only extract if caller explicitly states their number"),
  
  email: z.string().nullable()
    .describe("Email with @ symbol: 'john@company.com'. Null if not mentioned"),

  // === DECISION & FOLLOW-UP ===
  decisionMaker: z.enum(["alone", "boss", "partners", "committee"]).nullable()
    .describe("Who decides: alone, boss, partners, or committee"),
  
  sendOver: z.array(z.enum(["Avails", "Panel Info", "Planning Rates"])).nullable()
    .describe("Materials rep will send - include ALL mentioned"),
  
  notes: z.string().nullable()
    .describe("Key conversation summary and any details not captured elsewhere"),

  // === METADATA ===
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
});

// ============================================================
// SYSTEM PROMPT - Concise and focused
// ============================================================

const SYSTEM_PROMPT = `You are extracting lead information from billboard advertising sales calls.

CRITICAL RULES:
1. Only extract information EXPLICITLY stated or clearly implied in the transcript
2. Do NOT infer or guess - if information isn't there, use null
3. Do NOT change existing accurate data - only fill gaps
4. Use exact enum values as specified in the schema
5. For negative responses, use "None" not null (hasMediaExperience, website, billboardsBeforeDetails)

ENUM VALUE RULES:

leadType (caller's intent):
- "${LeadSentiment.AVAILER}" = Asking what's available, ready to move forward
- "${LeadSentiment.PANEL_REQUESTER}" = Asking about specific billboard/panel
- "${LeadSentiment.TIRE_KICKER}" = Just browsing, vague interest, low commitment

typeName (business type) - Two-step classification:
1. First: Is it Political, Non-Profit, or Personal? Use that.
2. Otherwise: Is business New (<2 years) or Established (2+ years)?
3. Then: Does it sell to Businesses (B2B) or Consumers (B2C)?
- "${LeadType.ESTABLISHED_B2B}" = Existing company selling to other businesses
- "${LeadType.ESTABLISHED_B2C}" = Existing company selling to consumers  
- "${LeadType.NEW_B2B}" = New/startup selling to businesses
- "${LeadType.NEW_B2C}" = New/startup selling to consumers
- "${LeadType.NON_PROFIT}" = 501c3, charity, church
- "${LeadType.POLITICAL}" = Campaign, PAC, political
- "${LeadType.PERSONAL}" = Individual, not a business

billboardPurpose (primary goal):
- "${BillboardPurpose.DIRECTIONAL}" = Help people find location
- "${BillboardPurpose.ENROLLMENT}" = School/program signups
- "${BillboardPurpose.EVENT}" = Promote specific event
- "${BillboardPurpose.GENERAL_BRAND_AWARENESS}" = Get name out, visibility
- "${BillboardPurpose.HIRING}" = Recruiting employees
- "${BillboardPurpose.NEW_LOCATION}" = Grand opening, new store
- "${BillboardPurpose.NEW_PRODUCT_SERVICE}" = Launching new offering
- "${BillboardPurpose.POLITICAL}" = Campaign messaging

ARRAY FIELDS (campaignLength, sendOver):
- Include ALL options mentioned, not just one
- "3 to 6 months" → ["3 Mo", "6 Mo"]
- "I'll send avails and pricing" → ["Avails", "Planning Rates"]

CONTACT EXTRACTION:
- phone: Only extract if caller explicitly states their number. Format: (XXX) XXX-XXXX
- email: Must contain @ symbol. If spelled out ("john at company dot com"), convert properly

NEGATIVE RESPONSES:
- billboardsBeforeDetails: If billboardsBeforeYN is "N", this MUST be "None"
- hasMediaExperience: If not advertising, use "None" (not null)
- website: If no website mentioned or they don't have one, use "None"

Be conservative - only extract what's clearly stated.`;

// ============================================================
// API ROUTE
// ============================================================

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - Please log in" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { transcript } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // More directive prompt
    const prompt = `Analyze this sales call transcript and extract lead information. Only extract what is explicitly stated or clearly implied. Use null for missing information.

TRANSCRIPT:
${transcript}

Extract all relevant fields according to the schema.`;

    const result = await streamObject({
      model: openai("gpt-4o-min"), // Upgraded from mini for better accuracy
      schema: billboardLeadSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0, // Deterministic for extraction tasks
    });

    return result.toTextStreamResponse();

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Billboard field extraction error:", error);
    return Response.json(
      { error: "Field extraction failed", details: message },
      { status: 500 }
    );
  }
}