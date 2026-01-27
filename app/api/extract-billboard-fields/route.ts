// app/api/extract-billboard-fields/route.ts
import { openai } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { LeadSentiment, LeadType, BillboardPurpose } from "@/types/sales-call";

// ============================================================================
// SCHEMA - Descriptions are the primary source of truth for the AI
// ============================================================================

const billboardLeadSchema = z.object({
  // === LEAD CLASSIFICATION ===
  leadType: z.enum([LeadSentiment.AVAILER, LeadSentiment.PANEL_REQUESTER, LeadSentiment.TIRE_KICKER]).nullable()
    .describe(`Caller intent classification:
- "${LeadSentiment.AVAILER}": Asking about availability, what's open, ready to buy ("What do you have?", "Show me options")
- "${LeadSentiment.PANEL_REQUESTER}": Asking about specific panels/locations ("Tell me about that board on I-35")
- "${LeadSentiment.TIRE_KICKER}": Low intent, just browsing ("Just curious", "Maybe someday")`),

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
    .describe(`Business classification (pick ONE):
- "${LeadType.ESTABLISHED_B2B}": Existing company (2+ yrs) selling to businesses
- "${LeadType.ESTABLISHED_B2C}": Existing company selling to consumers (restaurants, retail, residential services)
- "${LeadType.NEW_B2B}": New/startup (<2 yrs) selling to businesses  
- "${LeadType.NEW_B2C}": New/startup selling to consumers (grand openings, new stores)
- "${LeadType.NON_PROFIT}": 501c3, charity, church, foundation
- "${LeadType.POLITICAL}": Campaign, PAC, election-related
- "${LeadType.PERSONAL}": Individual (not a business)`),

  businessName: z.string().nullable()
    .describe("Industry/category: 'HVAC', 'Restaurant', 'Law Firm' for business; 'Governor', 'Mayor' for political; 'Food Bank' for nonprofit"),

  entityName: z.string().nullable()
    .describe("Official business/organization name: 'Bob's HVAC', 'Committee to Elect Jane Doe', 'Austin Food Bank'"),

  // === BILLBOARD EXPERIENCE ===
  billboardsBeforeYN: z.enum(["Y", "N"]).nullable()
    .describe("Has caller used billboards before? 'Y' or 'N' only"),

  billboardsBeforeDetails: z.string().nullable()
    .describe("If billboardsBeforeYN is 'Y': describe experience. If 'N': use 'None'. If not discussed: null"),

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
    .describe(`Primary advertising goal (pick ONE):
- "${BillboardPurpose.DIRECTIONAL}": Guide people to location (wayfinding, exits)
- "${BillboardPurpose.ENROLLMENT}": School/program signups
- "${BillboardPurpose.EVENT}": Promote specific event (concert, festival, sale)
- "${BillboardPurpose.GENERAL_BRAND_AWARENESS}": Get name out, visibility, recognition
- "${BillboardPurpose.HIRING}": Recruiting employees
- "${BillboardPurpose.NEW_LOCATION}": Grand opening, new store/office
- "${BillboardPurpose.NEW_PRODUCT_SERVICE}": Launch new offering
- "${BillboardPurpose.POLITICAL}": Campaign messaging, vote for X`),

  accomplishDetails: z.string().nullable()
    .describe("Additional context about goals not captured by billboardPurpose (secondary goals, specifics)"),

  targetAudience: z.string().nullable()
    .describe("Who they want to reach: 'Homeowners', 'Commuters on I-35', 'Families', 'Young professionals'"),

  // === BUSINESS DETAILS ===
  hasMediaExperience: z.string().nullable()
    .describe("Other advertising they do: 'Facebook ads', 'Radio', 'TV'. Use 'No' if they explicitly say none. Null if not discussed."),

  yearsInBusiness: z.string().nullable()
    .describe("How long in business: '5 years', 'New business', '10+ years'"),

  website: z.string().nullable()
    .describe("Website URL if mentioned. Use 'No' if they explicitly say they don't have one. Null if not discussed."),

  // === LOCATION ===
  targetCity: z.string().nullable()
    .describe("City name ONLY (no state): 'Dallas', 'Austin', 'Los Angeles'"),

  state: z.string().nullable()
    .describe("Two-letter state code ONLY: 'TX', 'CA', 'NY'"),

  targetArea: z.string().nullable()
    .describe("Specific roads/highways/areas: 'I-35', 'Highway 183', 'Downtown', 'North side'"),

  // === TIMELINE ===
  startMonth: z.string().nullable()
    .describe("When to start: 'ASAP', 'January 2026', 'Next month'"),

  campaignLength: z.array(z.enum(["1 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"])).nullable()
    .describe("Duration(s) - include ALL mentioned: ['3 Mo'] for single, ['3 Mo', '6 Mo'] for '3 to 6 months' range"),

  boardType: z.enum(["Static", "Digital", "Both"]).nullable()
    .describe("Billboard type preference"),

  // === CONTACT INFO ===
  name: z.string().nullable()
    .describe("Caller's full name (first and last if possible)"),

  position: z.string().nullable()
    .describe("Job title: 'Owner', 'Marketing Director', 'Manager'"),

  phone: z.string().nullable()
    .describe("Phone from CALLER only (not rep). Format: (XXX) XXX-XXXX. Listen for spelled-out digits."),

  email: z.string().nullable()
    .describe("Email with @ symbol. Convert 'john at company dot com' to 'john@company.com'. Null if not mentioned."),

  // === DECISION & FOLLOW-UP ===
  decisionMaker: z.enum(["alone", "boss", "partners", "committee"]).nullable()
    .describe("Who decides: alone (solo), boss (supervisor), partners (co-owners), committee (board)"),

  sendOver: z.array(z.enum(["Avails", "Panel Info", "Planning Rates"])).nullable()
    .describe("Materials REP will send - include ALL mentioned in conversation"),

  // === NOTES - INCREMENTAL ===
  notes: z.string().nullable()
    .describe("KEY DETAILS from this conversation: important points, specific requests, concerns, timeline details, follow-up items. Focus on actionable info for the sales rep."),

  // === METADATA ===
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
});

// ============================================================================
// SYSTEM PROMPT - Concise, focused on behavior not field definitions
// ============================================================================

// ============================================================================
// SYSTEM PROMPT - Concise, focused on behavior not field definitions
// ============================================================================

const SYSTEM_PROMPT = `You are extracting lead information from a billboard advertising sales call transcript.

CRITICAL RULE: Only extract what is EXPLICITLY stated or clearly implied in the transcript.
- If a field was NOT discussed → return null
- If a field WAS discussed → extract the value
- NEVER guess or infer information that wasn't mentioned
- NEVER fill in default values for undiscussed topics

EXTRACTION RULES:
1. Use exact enum values specified in the schema
2. For array fields (campaignLength, sendOver), include ALL options mentioned
3. Phone numbers: Only extract from CALLER, format as (XXX) XXX-XXXX
4. If caller explicitly says "no" to something (e.g., "no website"), use "No" - this is different from not mentioning it at all (null)

NOTES FIELD GUIDANCE:
Capture key conversation details useful for the sales rep:
- Specific concerns or objections raised
- Budget hints or constraints
- Timeline urgency or flexibility
- Special requests or requirements
- Follow-up items discussed

Keep notes concise but informative. Focus on actionable insights.`;

// ============================================================================
// API ROUTE
// ============================================================================

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

    const prompt = `Extract lead information from this sales call transcript:

${transcript}

Extract all fields according to the schema. Be thorough but accurate.`;

    const result = await streamObject({
      model: openai("gpt-4o-mini"),
      schema: billboardLeadSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
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