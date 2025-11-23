# Billboard Source AI - Comprehensive Codebase Analysis
## Differences from Current CLAUDE.md Documentation

### SUMMARY OF FINDINGS

The current CLAUDE.md is **significantly outdated**. The codebase has evolved substantially with new features, databases, integrations, and API routes not documented. Below is a detailed analysis of what needs updating.

---

## 1. DATABASE SCHEMA - MAJOR CHANGES

### Current Documentation Says:
- "Single `User` table with id (nanoid), email, and password fields"
- "Schema is minimal; extend as needed for storing transcripts or analysis results"

### Actual Current State:
The schema now includes **3 tables**:

#### 1. `user` table (unchanged):
- `id` (varchar, 21 chars) - Primary key
- `email` (varchar, 64 chars) - Unique
- `password` (varchar, 64 chars) - Optional
- `role` (varchar, 20 chars) - New field! Default 'user', can be 'admin'

#### 2. `openaiLogs` table (NEW):
Purpose: Track OpenAI API usage and costs for billing/monitoring
Fields:
- `id` (serial) - Primary key
- `userId` (text) - Foreign key to User.id, cascade delete
- `model` (text) - Model used (e.g., 'gpt-4o-transcribe')
- `promptTokens`, `completionTokens`, `totalTokens` (integer)
- `cost` (numeric, 10 digits, 6 decimals) - Cost in USD
- `sessionId` (text) - Session ID for tracking
- `status` (text) - 'pending', 'completed'
- `createdAt` (timestamp)

#### 3. `billboardLocations` table (NEW):
Purpose: Semantic search and market intelligence for billboard locations
Fields:
- Location data: `city`, `state`, `county` (all text, required)
- Market intelligence: `marketIntelligence` (text)
- Availability flags: `hasStaticBulletin`, `hasStaticPoster`, `hasDigital` (boolean)
- Vendor breakdown: `lamarPercentage`, `outfrontPercentage`, `clearChannelPercentage`, `otherVendorPercentage` (integer)
- Pricing data (4 sections for bulletin, poster, digital):
  - 12-week, 24-week, 52-week pricing (integer)
  - Weekly impressions (integer)
- Vector embedding: `embedding` (vector, 1536 dimensions for text-embedding-3-small)
- Metadata: `createdAt`, `updatedAt` (timestamp)

### Database Commands:
Need to add environment-specific variants:
- `npm run db:push:dev` - Uses .env.dev
- `npm run db:push:prod` - Uses .env.prod
- `npm run db:studio:dev` - Uses .env.dev
- `npm run db:studio:prod` - Uses .env.prod
- `npm run db:generate` - Generate migrations

---

## 2. DEPENDENCIES - MAJOR ADDITIONS

### New/Notable Dependencies Added:
(Not in original CLAUDE.md)

**Voice/Communications:**
- `@twilio/voice-sdk` (^2.16.0) - Phone call handling
- `twilio` (^5.10.4) - Twilio server SDK
- `@openai/agents` (^0.0.13) - OpenAI agents
- `@openai/agents-realtime` (^0.1.8) - Realtime agent API

**Data Handling:**
- `csv-parse` (^6.1.0) - CSV parsing for billboard data
- `pgvector` (^0.2.1) - Vector search support in PostgreSQL
- `@vercel/blob` (^2.0.0) - File uploads to Vercel Blob storage

**UI/UX Enhancements:**
- `framer-motion` (^12.23.12) - Advanced animations
- `@dnd-kit/*` - Drag-and-drop components (core, modifiers, sortable, utilities)
- `@tanstack/react-table` (^8.21.3) - Data table management
- `recharts` (^2.15.4) - Charts for data visualization
- `sonner` (^2.0.6) - Toast notifications (alternative to react-hot-toast)
- `react-dropzone` (^14.3.8) - File drop zones

**Background Jobs:**
- `inngest` (^3.46.0) - Background job processing (NEW pattern not in CLAUDE.md)

**Other:**
- `jose` (^6.0.12) - JWT handling (alongside bcrypt)
- `dotenv-cli` (^11.0.0) - CLI for .env file handling

---

## 3. API ROUTES - COMPLETE LIST (Many New)

### Current Documentation Lists:
- `app/api/analyze-transcript/route.ts`
- `app/api/token/route.ts`
- `app/api/transcribe-file/route.ts`

### Actual Complete List:
1. **`/api/analyze-transcript`** - Incremental and full AI analysis (DOCUMENTED)
2. **`/api/token`** - OpenAI realtime token generation
3. **`/api/transcribe-file`** - File upload transcription with analysis (DOCUMENTED)
4. **`/api/extract-billboard-fields`** (NEW) - Streaming form field extraction using `streamObject()`
5. **`/api/billboard-pricing`** (NOT DOCUMENTED) - Billboard market intelligence lookup
6. **`/api/billboard-data/upload-blob`** (NEW) - File upload to Vercel Blob
7. **`/api/billboard-data/process`** (NEW) - Trigger Inngest background job for CSV processing
8. **`/api/transcribe`** (NEW) - Alternative transcription endpoint
9. **`/api/twilio-token`** (NEW) - Generates Twilio Voice SDK tokens
10. **`/api/twilio-inbound`** (NEW) - Webhook for incoming Twilio calls
11. **`/api/openai/update-cost`** (NEW) - Update call duration and cost
12. **`/api/inngest`** (NEW) - Inngest webhook for background jobs

---

## 4. SERVER ACTIONS - COMPLETE LIST

### Current Documentation Lists:
- `auth.ts` - Authentication actions
- `transcribe-actions.ts` - OpenAI transcription
- `voice-actions.ts` - Voice/audio processing

### Actual Current State:
1. **`actions/auth.ts`**
   - `signIn()` - Login with email/password validation
   - `signUp()` - Signup with company email validation (@billboardsource.com)
   - Zod schemas: `SignInSchema`, `SignUpSchema`
   - Type exports: `SignInData`, `SignUpData`, `ActionResponse`
   - Note: Enforces @billboardsource.com domain

2. **`actions/user-actions.ts`** (NEW)
   - `deleteUsers()` - Delete multiple users by ID
   - Invalidates admin page cache
   - New pattern for admin operations

3. **`actions/voice-actions.ts`**
   - `createRealtimeSession()` - Creates OpenAI Realtime session
   - `generateTextResponse()` - Generates text using Vercel AI SDK
   - `streamTextResponse()` - Streams text response
   - Uses Vercel AI SDK patterns

4. **`actions/transcribe-actions.ts`**
   - Unclear from current codebase state (needs deeper check)
   - Legacy pattern mentioned but appears minimal

---

## 5. HOOKS - UPDATES

### Current Documentation States:
- `useBillboardFormExtraction` hook mentioned

### Actual Current State:
1. **`hooks/useBillboardFormExtraction.ts`** (DOCUMENTED but implementation differs)
   - Uses `experimental_useObject` from `@ai-sdk/react`
   - Streaming field extraction with debounce (500ms)
   - Retry logic (max 3 retries)
   - Abort controller for request cancellation
   - Transcript context tracking (keeps last 10 chunks)
   - Confidence scoring for extraction quality
   - Error handling and cleanup on unmount
   - Returns: `formData`, `isExtracting`, `extractFields`, `error`, `overallConfidence`, `clearError`, `reset`, `cleanup`, `canRetry`

2. **`hooks/use-mobile.ts`** (NEW)
   - Mobile responsiveness detection hook

---

## 6. COMPONENTS - KEY COMPONENTS

### Main Component (MAJOR - 1166 lines):

**`components/SalesCallTranscriber.tsx`** - This is the centerpiece, much larger than documented
Key functionality:
- Real-time audio transcription via OpenAI Realtime API
- Twilio Voice SDK integration for phone calls
- WebRTC peer connection setup
- Data channel for real-time updates
- Billboard form field auto-extraction
- Billboard pricing context fetching from `/api/billboard-pricing`
- Manual form field editing (overrides AI suggestions)
- File upload support for transcripts
- Session tracking and cost calculation
- Multiple tabs for different views
- Scroll management for transcript display
- Error handling and recovery mechanisms

State managed includes:
- Transcripts array with transcript items (id, text, isFinal, timestamp)
- Interim transcripts for real-time display
- Twilio device and call state
- Billboard context and form data
- Manual edits overlay on AI suggestions

### Other Feature Components:
1. **`components/BillboardDataUploader.tsx`** - CSV file upload for billboard data
2. **`components/chart-area-interactive.tsx`** - Interactive charts (using recharts)
3. **`components/data-table.tsx`** - Data table for displaying user/cost data
4. **UI Components** (shadcn/Radix UI):
   - button, card, input, label, textarea, tabs
   - sidebar components (app-sidebar, nav-main, nav-user, etc.)
5. **Page Components**:
   - login-form, sign-up
   - AboutSection, ContactSection, ProductSection, WelcomeSection
   - Footer, header-nav, site-header
   - section-cards

---

## 7. AUTHENTICATION - NEW FEATURES

### Current Documentation:
- JWT-based, cookies, 2-day expiration, 24-hour refresh threshold

### New Features Found:
1. **Role-based access control (RBAC)**
   - `user.role` field in database (default: 'user', can be 'admin')
   - Admin page at `/admin` for user management
   - Functions: `promoteToAdmin()` in `lib/dal.ts`
   - Make-admin script: `scripts/make-admin.ts`
   - CLI commands: `npm run make-admin`, `npm run make-admin:dev`, `npm run make-admin:prod`

2. **Company email enforcement**
   - Validation in auth actions: must end with `@billboardsource.com`
   - Applies to both signin and signup

---

## 8. NEW SYSTEMS NOT DOCUMENTED

### A. Inngest Background Job Processing
**Purpose:** Process large CSV files asynchronously without blocking requests

**Files:**
- `lib/inngest/client.ts` - Inngest client initialization
- `lib/inngest/functions.ts` - Background job definition (`processBillboardData`)
- `app/api/inngest/route.ts` - Inngest webhook handler

**Functionality:**
- Parses CSV files with billboard location data
- Creates text embeddings using OpenAI's text-embedding-3-small model
- Inserts processed records into `billboardLocations` table
- Handles batch operations for large datasets

**CSV Expected Columns:**
- CITY, STATE, COUNTY
- MARKET INTELLIGENCE
- Billboard availability (Y/N for STATIC BULLETIN, STATIC POSTER, DIGITAL)
- Vendor percentages (LAMAR, OUTFRONT, CLEAR CHANNEL, OTHER)
- Pricing for each billboard type at 12/24/52 week periods
- Weekly impressions for each type

### B. Vector Embeddings & Semantic Search
**Purpose:** Enable semantic search over billboard locations and market intelligence

**Implementation:**
- pgvector extension in PostgreSQL
- `embedding` field stores 1536-dimensional vectors (text-embedding-3-small)
- Used in Inngest functions to embed CSV data
- Not yet connected to retrieval (RAG) in UI, but infrastructure is ready

### C. Vercel Blob Storage
**Purpose:** Store uploaded files (CSV, audio, documents)

**Implementation:**
- `/api/billboard-data/upload-blob` - Handles file uploads
- Validates file types: CSV, Excel, text
- Returns blob URL for further processing
- Triggers Inngest job via `/api/billboard-data/process`

### D. Billboard Market Intelligence System
**Purpose:** Provide context about billboard availability and pricing during sales calls

**Components:**
- `/api/billboard-pricing` - Takes transcript, returns relevant market data (RAG pattern)
- Used in SalesCallTranscriber to enrich sales rep knowledge
- Implemented as RAG lookup from database

### E. Cost Tracking System
**Purpose:** Monitor OpenAI API usage and calculate costs per user

**Implementation:**
- `openaiLogs` table stores all API calls
- `lib/dal.ts` functions for cost calculation:
  - `createPendingLog()` - Creates log entry at session start
  - `updateLogCost()` - Calculates cost based on duration
  - `getUserCosts()` - Aggregates costs per user
- Cost calculation: `durationMinutes * 0.06` for realtime transcription
- Admin dashboard shows cost tracking

---

## 9. ENVIRONMENT VARIABLES - UPDATED LIST

### Current Documentation Lists:
```
DATABASE_URL=
JWT_SECRET=
OPENAI_API_KEY=
NODE_ENV=
```

### Complete List (Inferred from Code):
```
# Core
DATABASE_URL=           # PostgreSQL connection string
JWT_SECRET=             # Min 32 chars for JWT signing
NODE_ENV=               # production or development
VERCEL=                 # Set in production (used for driver selection)

# OpenAI
OPENAI_API_KEY=         # OpenAI API key

# Twilio (NEW)
TWILIO_ACCOUNT_SID=     # Twilio account SID
TWILIO_API_KEY_SID=     # Twilio API key ID
TWILIO_API_KEY_SECRET=  # Twilio API key secret
TWILIO_AUTH_TOKEN=      # For webhook signature validation

# Vercel Blob (NEW)
BLOB_READ_WRITE_TOKEN=  # Vercel Blob storage token

# Inngest (NEW)
INNGEST_EVENT_KEY=      # Inngest event key (if needed)
INNGEST_SIGNING_KEY=    # Inngest signing key (if needed)
```

### Environment File Strategy:
- `.env.dev` - Development environment variables
- `.env.prod` - Production environment variables
- Uses `dotenv-cli` for `npm run db:*` commands to load specific env files

---

## 10. PROJECT STRUCTURE - UPDATED

### New Directories:
```
scripts/
  make-admin.ts         # CLI script to promote user to admin
lib/
  inngest/
    client.ts           # Inngest client
    functions.ts        # Background job functions
  schemas.ts            # Zod schemas for form validation
  dal.ts                # Data access layer (NEW pattern)
  openai-pricing.ts     # Cost calculation utility (NEW)
  openai.ts             # OpenAI utilities
  summarize.ts          # Summarization utilities
drizzle/                # Migration files
public/
  images/               # Product images
  videos/               # Demo videos
  mockup/               # Mockup images
```

---

## 11. KEY DIFFERENCES IN IMPLEMENTATION

### A. AI Integration Patterns
Current CLAUDE.md correctly documents Vercel AI SDK patterns BUT:
- **NEW**: `streamObject()` is used in `/api/extract-billboard-fields` for real-time streaming extraction
- **NEW**: `experimental_useObject` from `@ai-sdk/react` used in hooks for client-side extraction
- Legacy OpenAI SDK still used for Twilio and Realtime sessions

### B. Form Extraction
- Uses STREAMING extraction with `streamObject()` instead of batch processing
- Real-time field extraction as user speaks
- Debounced updates to prevent excessive API calls
- Confidence scoring based on extraction quality
- Manual override capability for AI suggestions

### C. Authentication
- Domain validation: @billboardsource.com emails only
- Role-based access control (user vs admin)
- Sessions still JWT-based in cookies, but with RBAC

### D. Error Handling
- Retry logic with max retry limits
- Abort controller for canceling in-flight requests
- Graceful degradation when APIs are unavailable
- Admin can disable users, not just create them

---

## 12. NEW PATTERNS & CONVENTIONS

### A. DAL Pattern (Data Access Layer)
`lib/dal.ts` centralizes database operations:
- `getCurrentUser()` - Get authenticated user
- `getUserByEmail()` - Query by email
- `createPendingLog()` - Create cost tracking entry
- `updateLogCost()` - Update call cost
- `getAllUsers()` - Admin function
- `deleteUsersByIds()` - Admin function
- `getUserCosts()` - Aggregate costs per user
- `promoteToAdmin()` - Promote user to admin

### B. Streaming Responses
- Use `streamObject()` for real-time structured extraction
- Use `toTextStreamResponse()` to return Server-Sent Events
- Example: `/api/extract-billboard-fields` streams form field updates

### C. Background Jobs (Inngest)
- Trigger: `/api/billboard-data/process` → sends event to Inngest
- Handler: Inngest function processes CSV and inserts to DB
- No timeout limits with Inngest

### D. Cost Tracking
- Log entry created at session start (pending)
- Cost updated at session end with duration
- Per-minute pricing: $0.06/minute for realtime transcription

### E. Webhook Security
- Twilio webhook validation using `twilio.validateRequest()`
- Check `x-twilio-signature` header
- Falls back safely in development if token not set

---

## 13. IMPORTANT FILES NOT DOCUMENTED IN CLAUDE.MD

1. **`scripts/make-admin.ts`** - Promote users to admin role
2. **`lib/dal.ts`** - Data access layer (critical)
3. **`lib/inngest/functions.ts`** - Background job processing
4. **`lib/schemas.ts`** - Shared Zod schemas
5. **`lib/openai-pricing.ts`** - Cost calculation
6. **`app/(auth)/admin/page.tsx`** - Admin dashboard
7. **`app/(auth)/admin/admin-client.tsx`** - Admin UI (not shown in review)
8. **`drizzle.config.ts`** - Drizzle ORM configuration

---

## 14. MISSING FROM CURRENT CLAUDE.MD

1. Role-based access control (RBAC)
2. Twilio Voice SDK integration
3. Background job processing (Inngest)
4. Vector embeddings & semantic search
5. File upload to Vercel Blob
6. Cost tracking and billing system
7. Billboard market intelligence API
8. Real-time streaming extraction
9. Form field confidence scoring
10. Webhook security patterns
11. Development vs production env file strategy
12. DAL pattern for database operations
13. Admin user management system
14. Domain-restricted authentication (@billboardsource.com)
15. CSV parsing for billboard data

---

## SUMMARY OF UPDATES NEEDED FOR CLAUDE.MD

### Critical Sections to Add:
1. Complete database schema with all 3 tables
2. All 12 API routes with descriptions
3. New dependencies (Twilio, Inngest, Blob, etc.)
4. Inngest background job system
5. Vector embeddings & semantic search
6. Cost tracking system
7. RBAC (admin vs user roles)
8. DAL pattern for database access
9. Billboard market intelligence system
10. Streaming extraction patterns
11. Updated environment variables list
12. make-admin script and RBAC setup

### Critical Sections to Update:
1. Tech stack (add all new packages)
2. Development commands (add env-specific db commands)
3. Project structure (add new directories and files)
4. API routes section (expand significantly)
5. Authentication section (add RBAC)
6. Code conventions (add streaming, webhooks, background jobs)

### Sections That Can Stay As-Is:
1. Project overview (still accurate)
2. Basic architecture overview (still valid)
3. JWT implementation details (unchanged)
4. General TypeScript conventions (still valid)
5. Database connection strategy (still valid)

