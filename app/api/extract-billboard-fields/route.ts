// app/api/extract-billboard-fields/route.ts
import { openai } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { LeadSentiment } from "@/types/sales-call";

const billboardLeadSchema = z.object({
  // Lead classification - USING ENUM for better accuracy
  leadType: z.enum([LeadSentiment.AVAILER, LeadSentiment.PANEL_REQUESTER, LeadSentiment.TIRE_KICKER]).nullable()
    .describe("Lead sentiment: 'Availer' (wants availability/ready to move forward), 'Panel Requester' (wants specific panel details), 'Tire Kicker' (low intent/just browsing)"),
  
  // What do you want to advertise? (3 parts)
  typeName: z.string().nullable()
    .describe("Type - FREE TEXT field. Common values: 'Business', 'Political', 'Nonprofit', 'Personal'. Use 'Not specified' if not mentioned."),
  businessName: z.string().nullable()
    .describe("KIND field - Industry for business (e.g., 'HVAC'), office for political (e.g., 'Governor'), service area for nonprofit. Use 'Not specified' if not mentioned."),
  entityName: z.string().nullable()
    .describe("Entity Name - Legal/official name (e.g., 'Bob's HVAC Company', 'Committee to Elect John Smith'). Use 'Not specified' if not mentioned."),
  
  // Billboard experience
  billboardsBeforeYN: z.string().nullable()
    .describe("Have they used billboards before - 'Y' or 'N' only. Use 'Not specified' if not discussed."),
  billboardsBeforeDetails: z.string().nullable()
    .describe("Details about previous billboard experience. If 'N', put 'None'. If 'Y', capture details. If not discussed, use 'Not specified'."),
  
  // What do you need to accomplish?
  billboardPurpose: z.string().nullable()
    .describe("Primary goal/purpose - examples: 'Brand awareness', 'Hiring', 'Event promotion'. Use 'Not specified' if not mentioned."),
  accomplishDetails: z.string().nullable()
    .describe("Additional details about what they need to accomplish. Use 'Not specified' if not mentioned."),
  
  // Who are you trying to target?
  targetAudience: z.string().nullable()
    .describe("Target demographic - examples: 'Higher income neighborhood', 'Families with children'. Use 'Not specified' if not mentioned."),
  
  // Other fields
  hasMediaExperience: z.string().nullable()
    .describe("What other advertising they're doing - 'Facebook ads', 'Radio', 'TV'. Use 'No' if they say none, 'Not specified' if not discussed."),
  yearsInBusiness: z.string().nullable()
    .describe("How long in business - '5 years', '10+ years', 'New business'. Use 'Not specified' if not mentioned."),
  website: z.string().nullable()
    .describe("Website URL if mentioned. Use 'No' if they say no website, 'Not specified' if not discussed."),
  
  // Notes field
  notes: z.string().nullable()
    .describe("Purpose recap and additional notes - bullet point summary of conversation. Use 'Not specified' if nothing notable."),
  
  // Location fields
  targetCity: z.string().nullable()
    .describe("City name only (e.g., 'Dallas', 'Los Angeles'). Use 'Not specified' if not mentioned."),
  state: z.string().nullable()
    .describe("Two-letter state abbreviation ONLY (e.g., 'TX', 'CA'). Use 'Not specified' if not mentioned."),
  targetArea: z.string().nullable()
    .describe("Specific roads/highways/areas (e.g., 'I-35', 'Highway 183'). Use 'Not specified' if not mentioned."),
  
  // Start date
  startMonth: z.string().nullable()
    .describe("When they want to start - 'ASAP', 'January 2026'. Use 'Not specified' if not mentioned."),
  
  // Campaign length
  campaignLength: z.array(z.string()).nullable()
    .describe("Campaign duration - ARRAY: '1 Mo', '3 Mo', '6 Mo', '12 Mo', 'TBD'. Use ['Not specified'] if not mentioned."),
  
  // Billboard type
  boardType: z.string().nullable()
    .describe("Type of billboard - 'Static', 'Digital', or 'Both'. Use 'Not specified' if not mentioned."),
  
  // Contact information
  name: z.string().nullable()
    .describe("Contact person's full name. Use 'Not specified' if not mentioned."),
  position: z.string().nullable()
    .describe("Job title or position. Use 'Not specified' if not mentioned."),
  phone: z.string().nullable()
    .describe("Phone number. Use 'Not specified' if not mentioned."),
  email: z.string().nullable()
    .describe("Email address. Use 'Not specified' if not mentioned."),
  
  // Decision making
  decisionMaker: z.string().nullable()
    .describe("Who makes decision - 'alone', 'boss', 'partners', or 'committee'. Use 'Not specified' if not mentioned."),
  
  // Send over
  sendOver: z.array(z.string()).nullable()
    .describe("What materials to send - 'Avails', 'Panel Info', 'Planning Rates'. Use ['Not specified'] if not mentioned."),
  
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
}).describe("Schema for billboard advertising lead extracted from sales call transcript");

// ✅ UPDATED: System prompt with incremental extraction, change detection, and "Not specified" handling
const SYSTEM_PROMPT = `You are an expert AI assistant analyzing sales call transcripts for a billboard advertising company.
Your job is to extract and UPDATE lead form information intelligently.

=== CRITICAL: "NOT SPECIFIED" RULE ===

For ANY field where the information is NOT mentioned or discussed in the transcript:
- Use "Not specified" as the value
- Do NOT leave fields as null or empty
- Do NOT guess or make up information

Examples:
- Phone not mentioned → phone: "Not specified"
- Email not mentioned → email: "Not specified"
- Duration not discussed → campaignLength: ["Not specified"]
- Website not discussed → website: "Not specified"

EXCEPTION: For fields with explicit negative answers:
- "We don't have a website" → website: "No"
- "No other advertising" → hasMediaExperience: "No"
- "Never used billboards" → billboardsBeforeYN: "N", billboardsBeforeDetails: "None"

=== CRITICAL: INCREMENTAL EXTRACTION MODE ===

You will receive:
1. The FULL transcript of the conversation so far
2. The NEW SEGMENT (latest part of the conversation) - if provided
3. The CURRENT FORM STATE (what has already been extracted)
4. A list of LOCKED FIELDS (fields the user has confirmed - DO NOT change these)
5. An isIncremental flag indicating if this is an update or fresh extraction

=== INCREMENTAL UPDATE RULES ===

When isIncremental is TRUE:
1. **PRESERVE existing values** - If a field already has a value in currentFormState and there's NO new information about it, keep the existing value
2. **ONLY UPDATE fields when**:
   - The new segment contains CORRECTION phrases (see below)
   - New information is mentioned for a previously empty/"Not specified" field
   - The customer explicitly provides updated/different information
3. **NEVER change LOCKED fields** - These are user-confirmed values
4. **Keep "Not specified"** for fields still not mentioned after the new segment

=== CORRECTION PHRASE DETECTION ===

Listen for these correction indicators in the NEW SEGMENT:
- "Actually..." / "Actually, it's..."
- "I meant..." / "I mean..."
- "Sorry, it's..." / "Sorry, I meant..."
- "Let me correct that..." / "Correction..."
- "No wait..." / "Wait, no..."
- "Change that to..." / "Make that..."
- "Not [X], it's [Y]..." 
- "I misspoke..." / "I said it wrong..."
- "The correct [field] is..."
- "Instead of [X]..."

When you detect a correction phrase:
1. Identify WHICH field is being corrected
2. Extract the NEW/CORRECT value
3. Update ONLY that specific field
4. Keep all other fields unchanged

=== FIELD UPDATE PRIORITY ===

For each field, follow this logic:
1. Is it in lockedFields? → Keep the locked value, DO NOT change
2. Is there a correction phrase for this field in newSegment? → Update with corrected value
3. Is there NEW information for this field in newSegment? → Update with new value
4. Does currentFormState have a real value (not "Not specified")? → Keep the existing value
5. Is the info in the full transcript? → Extract the value
6. Otherwise → Use "Not specified"

=== LEAD TYPE/CATEGORY (EXACT ENUM VALUES) ===
Must be one of these three EXACT values (or null if truly unclear):
- "${LeadSentiment.AVAILER}": Asking about availability, what's available, inventory, wants to see what's open, ready to move forward
- "${LeadSentiment.PANEL_REQUESTER}": Asking about specific panels, specific locations, wants details on particular billboards
- "${LeadSentiment.TIRE_KICKER}": Just browsing, not serious, vague interest, gathering info, low intent

=== MODULE 1: BASIC INFORMATION ===

WHAT DO YOU WANT TO ADVERTISE (3-part field):

1. TYPE NAME (FREE TEXT):
   Common values: "Business", "Political", "Nonprofit", "Personal"
   If not mentioned → "Not specified"

2. BUSINESS NAME (KIND - the subcategory):
   - Business: Industry/category → "HVAC", "Restaurant", "Law Firm"
   - Political: Office sought → "Governor", "City Council", "Mayor"
   - Nonprofit: Service area → "Food Bank", "Animal Shelter"
   If not mentioned → "Not specified"

3. ENTITY NAME (the actual name):
   - The legal/official name of the business/org
   If not mentioned → "Not specified"

BILLBOARD EXPERIENCE:
- billboardsBeforeYN: "Y", "N", or "Not specified"
- billboardsBeforeDetails: 
  - If "N" → "None"
  - If "Y" → capture details
  - If not discussed → "Not specified"

BILLBOARD PURPOSE:
- billboardPurpose: The PRIMARY purpose/goal, or "Not specified"
- accomplishDetails: Extra context, or "Not specified"

TARGET AUDIENCE:
- targetAudience: Who they want to reach, or "Not specified"

OTHER ADVERTISING:
- hasMediaExperience: 
  - If doing marketing → list what they do
  - If NOT doing marketing → "No"
  - If not discussed → "Not specified"

YEARS IN BUSINESS:
- yearsInBusiness: Duration or "Not specified"

WEBSITE:
- If they mention URL → extract it
- If they say no website → "No"
- If not discussed → "Not specified"

=== MODULE 2: PROPOSAL SECTION ===

NOTES:
- notes: Purpose recap and additional notes, or "Not specified"

LOCATION (3 SEPARATE FIELDS):
- targetCity: City name or "Not specified"
- state: 2-letter abbreviation or "Not specified"
- targetArea: Roads/highways/areas or "Not specified"

START DATE:
- startMonth: When to start or "Not specified"

CAMPAIGN LENGTH (ARRAY):
- campaignLength: Array of durations or ["Not specified"]

BILLBOARD TYPE:
- boardType: "Static", "Digital", "Both", or "Not specified"

=== MODULE 3: CONTACT INFORMATION ===

- name: Full name or "Not specified"
- position: Job title or "Not specified"
- phone: Phone number or "Not specified"
- email: Email address or "Not specified"

DECISION MAKER:
- decisionMaker: "alone", "boss", "partners", "committee", or "Not specified"

SEND OVER (ARRAY):
- sendOver: Array of items or ["Not specified"]

=== EXAMPLE INCREMENTAL SCENARIOS ===

**Scenario 1: Customer corrects city**
- Current state: { targetCity: "Dallas", state: "TX" }
- New segment: "Actually, I meant Fort Worth, not Dallas"
- Action: Update targetCity to "Fort Worth", keep state as "TX"
- Result: { targetCity: "Fort Worth", state: "TX" }

**Scenario 2: Customer adds new info (phone)**
- Current state: { name: "John Smith", phone: "Not specified" }
- New segment: "My number is 555-123-4567"
- Action: Update phone only
- Result: { name: "John Smith", phone: "555-123-4567" }

**Scenario 3: Locked field - ignore correction**
- Current state: { targetCity: "Austin" }
- Locked fields: ["targetCity"]
- New segment: "Actually make that San Antonio"
- Action: DO NOT change targetCity (it's locked)
- Result: { targetCity: "Austin" } (unchanged)

**Scenario 4: Field still not mentioned**
- Current state: { name: "John", email: "Not specified" }
- New segment: "I'll be in touch next week"
- Action: Keep email as "Not specified"
- Result: { name: "John", email: "Not specified" }

**Scenario 5: Fresh extraction with missing fields**
- Transcript: "Hi, I'm John from Dallas. I want to advertise my HVAC business."
- Result: { 
    name: "John", 
    targetCity: "Dallas", 
    typeName: "Business", 
    businessName: "HVAC",
    phone: "Not specified",
    email: "Not specified",
    state: "Not specified",
    startMonth: "Not specified",
    campaignLength: ["Not specified"],
    ... 
  }

=== EXTRACTION STRATEGY ===

1. First check if this is incremental mode (isIncremental = true)
2. If incremental:
   a. Parse the newSegment for correction phrases
   b. Identify which fields have corrections
   c. For corrected fields: extract the NEW value
   d. For locked fields: keep the current value (do not change)
   e. For other fields with existing real values: keep current value
   f. For "Not specified" fields with new info: extract the value
   g. For fields still not mentioned: keep "Not specified"
3. If NOT incremental (fresh extraction):
   a. Extract all fields from full transcript
   b. Use "Not specified" for any field not mentioned
   c. Still respect locked fields

Be precise with corrections. Only update what's actually being changed.
Use exact field names and values.
ALWAYS use "Not specified" for missing information - never leave fields empty or null.
Your goal is to maintain form accuracy while respecting user confirmations.
`;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.userId) {
      return new Response(
        JSON.stringify({ error: "Unauthorized - Please log in" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { 
      transcript, 
      newSegment = "",
      previousContext = [],
      currentFormState = {},
      lockedFields = [],
      isIncremental = false
    } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // ✅ Build the prompt with incremental context
    let prompt = "";
    
    // Add incremental extraction context
    if (isIncremental && Object.keys(currentFormState).length > 0) {
      prompt += `=== INCREMENTAL EXTRACTION MODE ===\n\n`;
      prompt += `This is an UPDATE to existing extracted data. Follow incremental rules.\n\n`;
      
      prompt += `CURRENT FORM STATE (preserve these unless corrected):\n`;
      prompt += `${JSON.stringify(currentFormState, null, 2)}\n\n`;
      
      if (lockedFields.length > 0) {
        prompt += `LOCKED FIELDS (DO NOT CHANGE THESE - user confirmed):\n`;
        prompt += `${JSON.stringify(lockedFields)}\n\n`;
      }
      
      if (newSegment && newSegment.trim().length > 0) {
        prompt += `NEW SEGMENT (check for corrections here):\n`;
        prompt += `"${newSegment.trim()}"\n\n`;
        prompt += `Look for correction phrases in the new segment. Only update fields that are:\n`;
        prompt += `1. Being corrected (customer says "actually", "I meant", etc.)\n`;
        prompt += `2. Being mentioned for the first time (currently "Not specified")\n`;
        prompt += `3. NOT in the locked fields list\n\n`;
      }
    }
    
    // Add previous context if available
    if (previousContext.length > 0) {
      prompt += `Previous conversation context:\n${previousContext.slice(-3).join("\n\n")}\n\n`;
    }
    
    prompt += `FULL TRANSCRIPT:\n${transcript}\n\n`;
    
    if (isIncremental) {
      prompt += `INSTRUCTIONS: This is an incremental update. Preserve existing values unless there's a clear correction or new information in the new segment. Respect locked fields. Use "Not specified" for fields still not mentioned.`;
    } else {
      prompt += `INSTRUCTIONS: Extract ALL relevant information from this sales call transcript. Be thorough. Use "Not specified" for any field not mentioned in the transcript.`;
    }

    const result = await streamObject({
      model: openai("gpt-4o-mini"),
      schema: billboardLeadSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0.1,
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