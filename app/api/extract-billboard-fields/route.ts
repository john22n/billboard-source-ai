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
    .describe("Type - FREE TEXT field, not enum. Common values: 'Business', 'Political', 'Nonprofit', 'Personal' but accept any input"),
  businessName: z.string().nullable()
    .describe("KIND field - Industry for business (e.g., 'HVAC'), office for political (e.g., 'Governor'), service area for nonprofit"),
  entityName: z.string().nullable()
    .describe("Entity Name - Legal/official name (e.g., 'Bob's HVAC Company', 'Committee to Elect John Smith')"),
  
  // Billboard experience
  billboardsBeforeYN: z.string().nullable()
    .describe("Have they used billboards before - 'Y' or 'N' only, no other values"),
  billboardsBeforeDetails: z.string().nullable()
    .describe("Details about previous billboard experience. If they answer 'N' (no), put 'None'. If 'Y' (yes), capture details like '10 years ago', 'Person hasn't but company has'. Never leave null if billboardsBeforeYN is filled."),
  
  // What do you need to accomplish? (form uses billboardPurpose, not accomplishGoal)
  billboardPurpose: z.string().nullable()
    .describe("Primary goal/purpose - examples: 'Brand awareness', 'Hiring', 'Event promotion', 'Grand opening', 'Drive traffic', 'Generate leads'"),
  accomplishDetails: z.string().nullable()
    .describe("Additional details about what they need to accomplish beyond the main goal"),
  
  // Who are you trying to target?
  targetAudience: z.string().nullable()
    .describe("Target demographic - examples: 'Higher income neighborhood', 'Families with children', 'Commuters on I-35', 'Local residents'"),
  
  // Other fields from form (form uses hasMediaExperience as string, not boolean)
  hasMediaExperience: z.string().nullable()
    .describe("What other advertising they're doing - 'Facebook ads', 'Radio', 'TV', 'Social media'. Use 'No' or 'None' if not doing other advertising - NEVER leave null if they say they're not advertising"),
  yearsInBusiness: z.string().nullable()
    .describe("How long in business - '5 years', '10+ years', 'New business', etc."),
  website: z.string().nullable()
    .describe("Website URL if mentioned. If they explicitly say they don't have a website or no website is mentioned, use 'No'."),
  
  // Notes field (form uses 'notes', not 'proposalNotes')
  notes: z.string().nullable()
    .describe("Purpose recap and additional notes - bullet point summary, can include condensed info from above, important conversation details"),
  
  // Location fields - ACTIVE MARKET DATA
  targetCity: z.string().nullable()
    .describe("City name only (e.g., 'Dallas', 'Los Angeles', 'Frisco') - do NOT include state"),
  state: z.string().nullable()
    .describe("Two-letter state abbreviation ONLY (e.g., 'TX', 'CA', 'NY')"),
  targetArea: z.string().nullable()
    .describe("Specific roads/highways/areas (e.g., 'I-35', 'Highway 183', 'Downtown area') - NOT cities"),
  
  // Start date
  startMonth: z.string().nullable()
    .describe("When they want to start - 'ASAP', 'As soon as possible', 'January 2026', 'Jan 2026'"),
  
  // Campaign length - CHANGED TO ARRAY for multiple selections
  campaignLength: z.array(z.string()).nullable()
    .describe("Campaign duration - ARRAY that can contain multiple values: '1 Mo', '3 Mo', '6 Mo', '12 Mo', 'TBD'. If they mention comparing multiple durations or a range, include ALL mentioned options. Examples: ['3 Mo', '6 Mo'] for '3 to 6 months', ['1 Mo'] for single duration."),
  
  // Billboard type
  boardType: z.string().nullable()
    .describe("Type of billboard - 'Static', 'Digital', or 'Both'"),
  
  // Contact information
  name: z.string().nullable()
    .describe("Contact person's full name - get both first and last name if possible"),
  position: z.string().nullable()
    .describe("Job title or position at the company"),
  phone: z.string().nullable()
    .describe("Phone number"),
  email: z.string().nullable()
    .describe("Email address"),
  
  // Decision making (matches your button values)
  decisionMaker: z.string().nullable()
    .describe("Who makes decision - 'alone', 'boss', 'partners', or 'committee'"),
  
  // Send over (array of strings)
  sendOver: z.array(z.string()).nullable()
    .describe("What materials the rep will send - array can contain: 'Avails', 'Panel Info', 'Planning Rates'. Can be multiple items."),
  
  confidence: z.object({
    overall: z.number().min(0).max(100),
    fieldsExtracted: z.number(),
    totalFields: z.number(),
  }),
}).describe("Schema for billboard advertising lead extracted from sales call transcript");

const SYSTEM_PROMPT = `You are an expert AI assistant analyzing sales call transcripts for a billboard advertising company.
Your job is to extract EVERY piece of relevant information and populate the lead form as completely as possible.

CRITICAL EXTRACTION PRINCIPLES:
1. Extract EVERYTHING - don't leave fields empty if the information exists in the transcript
2. Make reasonable inferences from context when information is implied but not explicit
3. Listen carefully for duration/timeline mentions - people often discuss campaign lengths
4. Capture ALL goals and purposes mentioned - this is critical business information
5. Be aggressive about extraction - it's better to capture something than miss it
6. Pay special attention to field names and exact values that match the form
7. Use "No" or "None" for negative responses instead of leaving fields null
8. For multi-select fields (campaignLength, sendOver), include ALL relevant options mentioned

=== LEAD TYPE/CATEGORY (EXACT ENUM VALUES) ===
Must be one of these three EXACT values:
- "${LeadSentiment.AVAILER}": Asking about availability, what's available, inventory, wants to see what's open, ready to move forward
- "${LeadSentiment.PANEL_REQUESTER}": Asking about specific panels, specific locations, wants details on particular billboards
- "${LeadSentiment.TIRE_KICKER}": Just browsing, not serious, vague interest, gathering info, low intent

Listen for context clues:
- "What do you have available?", "Show me what's open" → "${LeadSentiment.AVAILER}"
- "Can you tell me about that board on Highway 35?", "I'm interested in panel #123" → "${LeadSentiment.PANEL_REQUESTER}"
- "Just looking around", "Just curious", "Maybe someday" → "${LeadSentiment.TIRE_KICKER}"

IMPORTANT: Return the EXACT string value from the enum, not variations.

=== MODULE 1: BASIC INFORMATION ===

WHAT DO YOU WANT TO ADVERTISE (3-part field):

1. TYPE NAME (FREE TEXT - not restricted to enum):
   Common values but accept ANY: "Business", "Political", "Nonprofit", "Personal"
   
   Context clues:
   - "my company", "our business", "we sell" → "Business"
   - "running for", "campaign", "elect" → "Political"
   - "nonprofit", "charity", "501c3", "foundation" → "Nonprofit"
   - "I'm selling my", "personal" → "Personal"
   
   IMPORTANT: This is a text input field, not a dropdown. Extract whatever makes sense.

2. BUSINESS NAME (KIND - the subcategory):
   - Business: Industry/category → "HVAC", "Restaurant", "Law Firm", "Plumbing", "Retail Store"
   - Political: Office sought → "Governor", "City Council", "Mayor", "Senate"
   - Nonprofit: Service area → "Food Bank", "Animal Shelter", "Tax Services"
   
   Listen for: "I run a/an [KIND]", "we're a [KIND] company", "[KIND] business"

3. ENTITY NAME (the actual name):
   - The legal/official name of the business/org
   - Often comes after KIND: "I run an HVAC business called Bob's HVAC"
   - Examples: "Bob's HVAC Company", "Committee to Elect Jane Doe", "Austin Food Bank"

BILLBOARD EXPERIENCE (CRITICAL - NEVER LEAVE DETAILS NULL):
- billboardsBeforeYN: Simple text field - use "Y" or "N" only
- billboardsBeforeDetails: **CRITICAL RULE**
  * If billboardsBeforeYN is "N" (they have NOT used billboards before) → billboardsBeforeDetails MUST be "None"
  * If billboardsBeforeYN is "Y" (they HAVE used billboards before) → Capture specific details:
    - "10 years ago"
    - "Yes but it's been a long time"
    - "I haven't but the company has"
    - "We did it in another city"
    - "Used them for a previous campaign"
  * NEVER leave billboardsBeforeDetails null/empty if billboardsBeforeYN is filled
  
  Examples:
  - User says "No, never used billboards" → billboardsBeforeYN: "N", billboardsBeforeDetails: "None"
  - User says "Yes, about 10 years ago" → billboardsBeforeYN: "Y", billboardsBeforeDetails: "10 years ago"
  - User says "No" → billboardsBeforeYN: "N", billboardsBeforeDetails: "None"

BILLBOARD PURPOSE (CRITICAL - This is the goal field):
- billboardPurpose: The PRIMARY purpose/goal - this is what the form calls it
  
  Common goals to extract:
  * "Brand awareness" / "Get our name out there"
  * "Hiring" / "Recruitment" / "Need employees"
  * "Event promotion" / "Promote event"
  * "Grand opening" / "New location"
  * "Drive traffic" / "Get people in the door"
  * "Generate leads"
  * "Increase sales"
  
  Listen for phrases:
  - "We want to...", "We need to...", "Looking to...", "Trying to..."
  - "The goal is...", "We're hoping to..."
  
- accomplishDetails: Extra context about their goals

WHO ARE YOU TRYING TO TARGET:
- targetAudience: Listen for ANY mention of who they want to reach
  Examples:
  * "Homeowners in the area"
  * "Higher income families"
  * "Commuters on the highway"
  * "Local residents"
  * "Young professionals"

OTHER ADVERTISING (CRITICAL - Never leave null if discussed):
- hasMediaExperience: This is a TEXT field showing what other advertising they do
  * If doing other marketing: "Facebook ads", "Radio", "TV", "Social media", "Direct mail", "Flyers"
  * If NOT doing other marketing: "No" or "None" - NEVER leave this null if they say they're not advertising
  * Listen for: "We also do...", "We're running...", "We advertise on..."
  * If they say "This is our first time" or "We don't do any other advertising" → "No"

YEARS IN BUSINESS:
- Can be exact ("5 years") or approximate ("over 10 years", "new business", "just started")

WEBSITE (CRITICAL - Use "No" when no website):
- website: 
  * If they mention a URL → extract the URL
  * If they say "No", "We don't have a website", "No website" → use "No"
  * If website is never mentioned in conversation → use "No"
  * NEVER leave this null - always either extract URL or put "No"
  
  Examples:
  - "Our website is example.com" → "example.com"
  - "No, we don't have a website" → "No"
  - [No mention of website at all] → "No"

=== MODULE 2: PROPOSAL SECTION ===

NOTES (Not proposalNotes - just 'notes'):
- notes: This is "Purpose Recap & Additional Notes" on the form
- Bullet point summary of conversation
- Can include condensed info from above
- Any important conversation details
- CRITICAL: Extract this - it's a key field for sales reps

LOCATION (3 SEPARATE FIELDS):
- targetCity: JUST the city name
  * "Dallas", "Los Angeles", "Frisco", "Austin"
  * Do NOT combine with state
  
- state: ONLY 2-letter abbreviation
  * "TX", "CA", "NY", "FL", "AZ"
  * Never spell out full state name
  
- targetArea: Roads, highways, or specific areas (can be multi-line text area)
  * "I-35", "Highway 183", "I-10 corridor"
  * "Downtown", "North side"
  * "Travis County", "Harris County"
  * Can include multiple areas/roads mentioned

START DATE:
- startMonth: When they want to begin
  * "ASAP", "As soon as possible"
  * "January 2026", "Jan 2026"
  * Use month abbreviations when possible

CAMPAIGN LENGTH (CRITICAL - NOW AN ARRAY, CAN BE MULTIPLE):
- campaignLength: Extract as ARRAY of string values
  * Available values: "1 Mo", "3 Mo", "6 Mo", "12 Mo", "TBD"
  * **IMPORTANT**: This field supports MULTIPLE selections
  * If they mention a RANGE, include BOTH endpoints: "3 to 6 months" → ["3 Mo", "6 Mo"]
  * If they want to COMPARE options, include ALL mentioned: "looking at 1, 3, or 6 months" → ["1 Mo", "3 Mo", "6 Mo"]
  * If they mention a single duration: ["3 Mo"]
  * If uncertain: ["TBD"]
  
  Examples:
  * "We want to try 3 months" → ["3 Mo"]
  * "Looking at 3 to 6 months" → ["3 Mo", "6 Mo"]
  * "Show me pricing for 1 month, 3 months, and 6 months" → ["1 Mo", "3 Mo", "6 Mo"]
  * "At least a year" → ["12 Mo"]
  * "Between 3 and 6 months" → ["3 Mo", "6 Mo"]
  * "quarterly campaign" → ["3 Mo"]
  * "Not sure, maybe 3 or 6 months" → ["3 Mo", "6 Mo"]
  * "Just not sure yet" → ["TBD"]
  
  **Key principle**: When in doubt, include more options rather than fewer. The user can deselect if needed.

BILLBOARD TYPE:
- boardType: Exact values to use: "Static", "Digital", or "Both"

=== MODULE 3: CONTACT INFORMATION ===

NAME:
- Full name if possible (first + last)
- If only first name early on, try to catch last name later in conversation

POSITION:
- Job title: "Owner", "Marketing Director", "Manager", "CEO", "President"

PHONE:
- Any phone number mentioned

EMAIL:
- Email address if provided

DECISION MAKER (EXACT VALUES):
- decisionMaker: Must be one of these exact strings:
  * "alone" - They make decision solo
  * "boss" - Need approval from boss/supervisor  
  * "partners" - Multiple partners/co-owners decide together
  * "committee" - Committee or board makes decision

SEND OVER (CRITICAL - ARRAY, CAN BE MULTIPLE):
- sendOver: Array containing one or more of these EXACT strings:
  * "Avails" - Availability list, inventory, what's available
  * "Panel Info" - Specific billboard location details, panel specs
  * "Planning Rates" - Pricing, rate cards, cost estimates
  
  **IMPORTANT**: This field supports MULTIPLE selections - include ALL items the rep mentions
  
  Listen for what the REP says they'll send:
  - "I'll send you availability" → ["Avails"]
  - "Let me get you pricing" → ["Planning Rates"]
  - "I'll send you what's available and our rates" → ["Avails", "Planning Rates"]
  - "Let me send details on that panel" → ["Panel Info"]
  - "I'll send availability, panel details, and pricing" → ["Avails", "Panel Info", "Planning Rates"]
  - "Let me send you our avails and rate card" → ["Avails", "Planning Rates"]
  
  **Key principle**: Include ALL materials mentioned, even if it's all three options.

=== EXTRACTION STRATEGY ===

1. READ THE ENTIRE TRANSCRIPT FIRST
2. Extract obvious explicit information
3. Go back and infer implied information from context
4. Pay special attention to:
   - leadType (MUST be exact enum value: "${LeadSentiment.AVAILER}", "${LeadSentiment.PANEL_REQUESTER}", or "${LeadSentiment.TIRE_KICKER}")
   - Duration mentions (ARRAY - can be multiple: ["3 Mo", "6 Mo"])
   - sendOver items (ARRAY - can be multiple: ["Avails", "Planning Rates"])
   - billboardPurpose (what they want to accomplish - this is critical)
   - notes field (purpose recap and additional notes)
   - hasMediaExperience (never leave null if discussed - use "No" if not advertising)
   - website (use "No" if not mentioned or they don't have one)
   - billboardsBeforeDetails (MUST be "None" if they answer "N" to billboardsBeforeYN)
5. Use exact string values for enums (leadType, decisionMaker, boardType)
6. For multi-select fields (campaignLength, sendOver), include ALL relevant options
7. Don't leave fields null if you can reasonably infer the answer or use "No"/"None"

=== COMMON PATTERNS TO LISTEN FOR ===

Lead Type patterns (MUST use exact enum values):
- "What do you have available?", "Show me what's available" → "${LeadSentiment.AVAILER}"
- "Tell me about the board on Main Street", "I saw panel #123" → "${LeadSentiment.PANEL_REQUESTER}"
- "Just looking", "Just curious", "Maybe later" → "${LeadSentiment.TIRE_KICKER}"

Duration mentions (extract as ARRAY - can be multiple):
- "for a few months" → ["3 Mo"]
- "3 to 6 month range" → ["3 Mo", "6 Mo"] (BOTH)
- "want to do a year" → ["12 Mo"]
- "maybe start with a month or try 3 months" → ["1 Mo", "3 Mo"] (BOTH)
- "quarterly" → ["3 Mo"]
- "looking at 1, 3, or 6 months" → ["1 Mo", "3 Mo", "6 Mo"] (ALL THREE)

Purpose/goal patterns (goes in billboardPurpose field):
- "we're trying to..." → extract the goal
- "need to get..." → extract the goal
- "looking to attract..." → might be targetAudience or billboardPurpose
- "want people to..." → extract the goal

Other advertising patterns (goes in hasMediaExperience as TEXT):
- "We also run Facebook ads" → "Facebook ads"
- "We don't do any other advertising" → "No"
- "This is our first time marketing" → "No"
- "We have radio spots too" → "Radio"

Website patterns:
- "Our site is..." → extract URL
- "No website" → "No"
- "We don't have a website yet" → "No"
- [No mention at all] → "No"

Billboard experience patterns:
- "No, never used them" → billboardsBeforeYN: "N", billboardsBeforeDetails: "None"
- "Yes, 5 years ago" → billboardsBeforeYN: "Y", billboardsBeforeDetails: "5 years ago"
- "No" → billboardsBeforeYN: "N", billboardsBeforeDetails: "None"
- "Yes" → billboardsBeforeYN: "Y", billboardsBeforeDetails: (try to find more context, or "Yes" if no details)

Send over patterns (ARRAY - include ALL mentioned):
- "I'll send availability and pricing" → ["Avails", "Planning Rates"]
- "Let me get you avails" → ["Avails"]
- "I'll send everything - availability, panel info, and rates" → ["Avails", "Panel Info", "Planning Rates"]

Be thorough. Extract everything. Use exact field names and values.
Fill in "No" or "None" for negative responses instead of leaving null.
For multi-select fields, include ALL relevant options mentioned.
For leadType, use the EXACT enum value: "${LeadSentiment.AVAILER}", "${LeadSentiment.PANEL_REQUESTER}", or "${LeadSentiment.TIRE_KICKER}".
Your goal is to fill out this form as completely as possible with data that matches the form's structure exactly.
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

    const { transcript, previousContext = [] } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let prompt = "";
    if (previousContext.length > 0) {
      prompt += `Previous conversation context:\n${previousContext.join("\n\n")}\n\n`;
    }
    prompt += `Extract structured information from this sales call transcript. Be thorough and extract ALL relevant information:\n\n${transcript}`;

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