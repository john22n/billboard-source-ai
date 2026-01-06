// app/api/extract-billboard-fields/route.ts
import { openai } from "@ai-sdk/openai";
import { streamObject } from "ai";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { LeadSentiment, LeadType, BillboardPurpose } from "@/types/sales-call";

// LeadType enum values for schema
const LEAD_TYPE_VALUES = [
  LeadType.ESTABLISHED_B2B,
  LeadType.ESTABLISHED_B2C,
  LeadType.NEW_B2B,
  LeadType.NEW_B2C,
  LeadType.NON_PROFIT,
  LeadType.POLITICAL,
  LeadType.PERSONAL,
] as const;

// BillboardPurpose enum values for schema
const BILLBOARD_PURPOSE_VALUES = [
  BillboardPurpose.DIRECTIONAL,
  BillboardPurpose.ENROLLMENT,
  BillboardPurpose.EVENT,
  BillboardPurpose.GENERAL_BRAND_AWARENESS,
  BillboardPurpose.HIRING,
  BillboardPurpose.NEW_LOCATION,
  BillboardPurpose.NEW_PRODUCT_SERVICE,
  BillboardPurpose.POLITICAL,
] as const;

const billboardLeadSchema = z.object({
  // Lead classification - USING ENUM for better accuracy
  leadType: z.enum([LeadSentiment.AVAILER, LeadSentiment.PANEL_REQUESTER, LeadSentiment.TIRE_KICKER]).nullable()
    .describe("Lead sentiment: 'Availer' (wants availability/ready to move forward), 'Panel Requester' (wants specific panel details), 'Tire Kicker' (low intent/just browsing)"),
  
  // What do you want to advertise? (3 parts) - typeName uses LeadType enum
  typeName: z.enum(LEAD_TYPE_VALUES).nullable()
    .describe("Business type classification based on conversation context. Must be one of: 'Established B2B' (existing business selling to other businesses), 'Established B2C' (existing business selling to consumers), 'New B2B' (new/startup business selling to other businesses), 'New B2C' (new/startup business selling to consumers), 'Non-Profit' (charitable/501c3 organizations), 'Political' (campaigns, PACs, political ads), 'Personal' (individual selling personal items/services)"),
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
  billboardPurpose: z.enum(BILLBOARD_PURPOSE_VALUES).nullable()
    .describe("Primary billboard goal/purpose. Must be one of: 'Directional' (guide people to a location), 'Enrollment' (school/program signups), 'Event' (promote specific event), 'General Brand Awareness' (increase visibility/recognition), 'Hiring' (recruitment/job openings), 'New Location' (announce new store/office opening), 'New Product/Service' (launch new offering), 'Political' (campaign/political messaging)"),
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
  .describe("Phone number - Extract ANY phone number mentioned by the CALLER (not the sales rep). Format as (XXX) XXX-XXXX for US numbers. Listen for: 'my number is...', 'you can reach me at...', 'call me at...', the caller spelling out digits, or any 10-digit number the caller provides. Example: (555) 123-4567. If caller says 'five five five, one two three, four five six seven' → (555) 123-4567"),
  email: z.string().nullable()
    .describe("Email address - MUST include @ symbol and domain (e.g., 'john@company.com'). If caller spells it out like 'john at company dot com', convert to proper format 'john@company.com'. Return null if no email mentioned."),
  
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

WHAT DO YOU WANT TO ADVERTISE - TYPE NAME (BUSINESS CLASSIFICATION ENUM):

This field classifies the advertiser into one of 7 business categories. You MUST select exactly one of these values:

1. "${LeadType.ESTABLISHED_B2B}" - Established Business-to-Business
   - An EXISTING company (been around for a while, not new/startup) that sells to OTHER BUSINESSES
   - Examples: Commercial HVAC company, wholesale distributor, industrial supplier, business software company, logistics/freight company, commercial contractor
   - Listen for: "We've been in business for X years", "We service commercial clients", "Our customers are businesses", "B2B", "wholesale", "commercial accounts"
   - Key indicators: Sells products/services to other companies, not consumers

2. "${LeadType.ESTABLISHED_B2C}" - Established Business-to-Consumer
   - An EXISTING company that sells directly to INDIVIDUAL CONSUMERS/the general public
   - Examples: Restaurant chain, retail store, car dealership, law firm serving individuals, medical practice, home services (residential HVAC, plumbing), real estate agent
   - Listen for: "We've been serving customers for years", "Our customers are homeowners", "retail", "consumer", "residential"
   - Key indicators: Sells to individuals/families, not businesses

3. "${LeadType.NEW_B2B}" - New Business-to-Business
   - A NEW/STARTUP company (< 2 years, just launched, new venture) that sells to OTHER BUSINESSES
   - Examples: New SaaS startup, new consulting firm, new commercial cleaning company, new B2B service provider
   - Listen for: "We're a new company", "Just started", "Launching our business", "Startup", combined with mentions of business clients
   - Key indicators: New + sells to businesses

4. "${LeadType.NEW_B2C}" - New Business-to-Consumer
   - A NEW/STARTUP company that sells directly to CONSUMERS
   - Examples: New restaurant opening, new retail store, new salon, new consumer app, new residential service company
   - Listen for: "Grand opening", "New location", "Just opened", "New business", combined with consumer/retail focus
   - Key indicators: New + sells to consumers

5. "${LeadType.NON_PROFIT}" - Non-Profit Organization
   - Charitable organizations, 501(c)(3), foundations, churches, community organizations
   - Examples: Food bank, animal shelter, hospital foundation, church, community center, advocacy group
   - Listen for: "Non-profit", "Nonprofit", "501c3", "Charity", "Foundation", "We're a church", "Community organization", "Donations"
   - Key indicators: Not selling products/services for profit, mission-driven

6. "${LeadType.POLITICAL}" - Political
   - Political campaigns, PACs, political advocacy, government agencies
   - Examples: "Committee to Elect John Smith", political action committee, ballot measure campaign, political party
   - Listen for: "Running for", "Campaign", "Elect", "Vote for", "PAC", "Political", office names like "Governor", "Mayor", "Senator", "City Council"
   - Key indicators: Seeking votes/political support, election-related

7. "${LeadType.PERSONAL}" - Personal
   - Individual selling personal items or promoting themselves (not a business)
   - Examples: Selling a house, selling a car, personal brand, individual artist, personal announcement
   - Listen for: "I'm selling my...", "Personal", "My own...", not representing a business entity
   - Key indicators: Individual person, not a company or organization

CLASSIFICATION DECISION TREE:
1. Is this political (campaign, election, PAC)? → "${LeadType.POLITICAL}"
2. Is this a non-profit/charity/501c3? → "${LeadType.NON_PROFIT}"
3. Is this a personal individual (not a business)? → "${LeadType.PERSONAL}"
4. Is this a business? Continue...
   a. Is it NEW (< 2 years, startup, just opened, grand opening)? 
      - Sells to businesses? → "${LeadType.NEW_B2B}"
      - Sells to consumers? → "${LeadType.NEW_B2C}"
   b. Is it ESTABLISHED (been around, existing company)?
      - Sells to businesses? → "${LeadType.ESTABLISHED_B2B}"
      - Sells to consumers? → "${LeadType.ESTABLISHED_B2C}"

B2B vs B2C DETERMINATION:
- B2B (Business-to-Business): Customers are other businesses, commercial, wholesale, industrial, professional services to companies
- B2C (Business-to-Consumer): Customers are individuals, retail, residential, consumer services, general public

Common industry classifications:
- HVAC: "Residential HVAC" → B2C, "Commercial HVAC" → B2B
- Restaurant/Retail: Almost always B2C
- Law Firm: Depends - "Personal injury" → B2C, "Corporate law" → B2B
- Medical Practice: Usually B2C (serves patients/individuals)
- Wholesale/Distribution: Usually B2B
- Software: "Enterprise software" → B2B, "Consumer app" → B2C

IMPORTANT: Return the EXACT enum value string. Listen carefully to determine:
1. Whether they sell to businesses (B2B) or consumers (B2C)
2. Whether they're new/startup or established
3. Or if they're non-profit, political, or personal

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

BILLBOARD PURPOSE (CRITICAL - This is the goal field - ENUM VALUES):

The billboardPurpose field classifies WHY the advertiser wants a billboard. You MUST select exactly one of these values:

1. "${BillboardPurpose.DIRECTIONAL}" - Directional/Wayfinding
   - Guide people to a physical location (exit here, turn left, X miles ahead)
   - Examples: "We need to direct people off the highway to our store", "People can't find us", "We want to show people where to exit"
   - Listen for: "directional", "wayfinding", "guide people", "show them where", "exit", "turn", "find us", "located at"

2. "${BillboardPurpose.ENROLLMENT}" - Enrollment/Registration
   - Drive signups for schools, programs, courses, memberships
   - Examples: "Increase enrollment at our school", "Get students to register", "Promote our certification program"
   - Listen for: "enrollment", "enroll", "register", "sign up", "students", "admissions", "school", "university", "program", "classes", "courses"

3. "${BillboardPurpose.EVENT}" - Event Promotion
   - Promote a specific event (concert, festival, sale, conference, fundraiser)
   - Examples: "Promote our annual festival", "Advertise the concert", "Get people to our grand opening event"
   - Listen for: "event", "concert", "festival", "show", "conference", "fair", "sale event", "fundraiser", "gala", "celebration", specific dates

4. "${BillboardPurpose.GENERAL_BRAND_AWARENESS}" - General Brand Awareness
   - Increase overall visibility and recognition (no specific call-to-action)
   - Examples: "Get our name out there", "People should know who we are", "Build brand recognition"
   - Listen for: "brand awareness", "get our name out", "visibility", "recognition", "top of mind", "people should know us", "general awareness", "branding"

5. "${BillboardPurpose.HIRING}" - Hiring/Recruitment
   - Recruit employees, attract job applicants
   - Examples: "We need to hire more drivers", "Looking for employees", "Recruiting nurses"
   - Listen for: "hiring", "recruiting", "employees", "workers", "staff", "job openings", "now hiring", "help wanted", "careers", "positions available"

6. "${BillboardPurpose.NEW_LOCATION}" - New Location/Grand Opening
   - Announce a new store, office, restaurant, or facility opening
   - Examples: "We're opening a new location", "Grand opening next month", "New store in the area"
   - Listen for: "new location", "grand opening", "now open", "coming soon", "opening", "new store", "new office", "new restaurant", "expanding to"

7. "${BillboardPurpose.NEW_PRODUCT_SERVICE}" - New Product/Service Launch
   - Promote a new product, service, or offering
   - Examples: "Launching our new product line", "Introducing our new service", "New menu items"
   - Listen for: "new product", "new service", "launching", "introducing", "new offering", "just released", "new line", "new menu"

8. "${BillboardPurpose.POLITICAL}" - Political/Campaign
   - Political campaigns, ballot measures, political advocacy
   - Examples: "Vote for John Smith", "Support Proposition 5", "Campaign messaging"
   - Listen for: "vote", "elect", "campaign", "political", "candidate", "proposition", "ballot", "PAC"

CLASSIFICATION DECISION TREE FOR BILLBOARD PURPOSE:
1. Are they running for office or promoting a political cause? → "${BillboardPurpose.POLITICAL}"
2. Are they hiring/recruiting employees? → "${BillboardPurpose.HIRING}"
3. Are they opening a new location/store? → "${BillboardPurpose.NEW_LOCATION}"
4. Are they launching a new product/service? → "${BillboardPurpose.NEW_PRODUCT_SERVICE}"
5. Are they promoting a specific event with a date? → "${BillboardPurpose.EVENT}"
6. Are they trying to get enrollments/registrations? → "${BillboardPurpose.ENROLLMENT}"
7. Are they helping people find their location (directions)? → "${BillboardPurpose.DIRECTIONAL}"
8. Do they just want general visibility/branding? → "${BillboardPurpose.GENERAL_BRAND_AWARENESS}"

IMPORTANT: If multiple purposes apply, choose the PRIMARY one. If someone says "We're opening a new location and want to hire staff", the primary purpose is likely "${BillboardPurpose.NEW_LOCATION}" - put hiring details in accomplishDetails.

- accomplishDetails: Extra context about their goals that doesn't fit the primary purpose (e.g., secondary goals, specific details, timeline)

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
- This also helps determine if they're ESTABLISHED vs NEW for the typeName field

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

PHONE NUMBER EXTRACTION (CRITICAL):
- Listen carefully for ANY phone number the CALLER mentions
- The caller may give their number in various ways:
  * "My number is 555-123-4567"
  * "You can reach me at five five five, one two three, four five six seven"
  * "Call me at 555.123.4567"
  * "The best number is area code 555, 123-4567"
- Always format as (XXX) XXX-XXXX
- The caller's phone number is IMPORTANT for verification against the inbound call
- If the caller gives a phone number that sounds like the same one calling in, capture it!

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
   - typeName (MUST be exact enum value - classify the business type correctly)
   - billboardPurpose (MUST be exact enum value - classify the primary goal correctly)
   - Duration mentions (ARRAY - can be multiple: ["3 Mo", "6 Mo"])
   - sendOver items (ARRAY - can be multiple: ["Avails", "Planning Rates"])
   - notes field (purpose recap and additional notes)
   - hasMediaExperience (never leave null if discussed - use "No" if not advertising)
   - website (use "No" if not mentioned or they don't have one)
   - billboardsBeforeDetails (MUST be "None" if they answer "N" to billboardsBeforeYN)
   - yearsInBusiness (helps determine Established vs New for typeName)
5. Use exact string values for enums (leadType, typeName, billboardPurpose, decisionMaker, boardType)
6. For multi-select fields (campaignLength, sendOver), include ALL relevant options
7. Don't leave fields null if you can reasonably infer the answer or use "No"/"None"

=== COMMON PATTERNS TO LISTEN FOR ===

Lead Type patterns (MUST use exact enum values):
- "What do you have available?", "Show me what's available" → "${LeadSentiment.AVAILER}"
- "Tell me about the board on Main Street", "I saw panel #123" → "${LeadSentiment.PANEL_REQUESTER}"
- "Just looking", "Just curious", "Maybe later" → "${LeadSentiment.TIRE_KICKER}"

Business Type (typeName) patterns:
- "We've been in business 20 years doing commercial HVAC" → "${LeadType.ESTABLISHED_B2B}"
- "I own a restaurant that's been here 10 years" → "${LeadType.ESTABLISHED_B2C}"
- "We're a new startup selling to businesses" → "${LeadType.NEW_B2B}"
- "Grand opening of our new store next month" → "${LeadType.NEW_B2C}"
- "We're a 501c3 food bank" → "${LeadType.NON_PROFIT}"
- "I'm running for city council" → "${LeadType.POLITICAL}"
- "I want to sell my house" → "${LeadType.PERSONAL}"

Billboard Purpose (billboardPurpose) patterns:
- "Help people find us off the highway" → "${BillboardPurpose.DIRECTIONAL}"
- "Increase enrollment at our school" → "${BillboardPurpose.ENROLLMENT}"
- "Promote our annual festival" → "${BillboardPurpose.EVENT}"
- "Get our name out there", "Brand recognition" → "${BillboardPurpose.GENERAL_BRAND_AWARENESS}"
- "We need to hire more drivers" → "${BillboardPurpose.HIRING}"
- "Grand opening next month" → "${BillboardPurpose.NEW_LOCATION}"
- "Launching our new product line" → "${BillboardPurpose.NEW_PRODUCT_SERVICE}"
- "Vote for John Smith" → "${BillboardPurpose.POLITICAL}"

Duration mentions (extract as ARRAY - can be multiple):
- "for a few months" → ["3 Mo"]
- "3 to 6 month range" → ["3 Mo", "6 Mo"] (BOTH)
- "want to do a year" → ["12 Mo"]
- "maybe start with a month or try 3 months" → ["1 Mo", "3 Mo"] (BOTH)
- "quarterly" → ["3 Mo"]
- "looking at 1, 3, or 6 months" → ["1 Mo", "3 Mo", "6 Mo"] (ALL THREE)

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
For typeName, use the EXACT enum value from LeadType - classify based on B2B/B2C and Established/New status.
For billboardPurpose, use the EXACT enum value from BillboardPurpose - classify based on their primary advertising goal.
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

    const { transcript } = await req.json();

    if (!transcript || transcript.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "No transcript provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = `Extract structured information from this sales call transcript. Be thorough and extract ALL relevant information:\n\n${transcript}`;

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
