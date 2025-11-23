# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Billboard Source AI is a Next.js application for analyzing sales calls using OpenAI's APIs. The application provides real-time transcription, AI-powered analysis, automated form field extraction from sales conversations, and billboard market intelligence lookup.

## Development Commands

**Start development server:**
```bash
npm run dev
```
Server runs on http://localhost:3000 with Turbopack enabled.

**Build for production:**
```bash
npm run build
```

**Lint code:**
```bash
npm run lint
```

**Run tests:**
```bash
npm test
```

**Database operations:**
```bash
npm run db:push         # Push schema changes (uses .env.local)
npm run db:push:dev     # Push schema changes (uses .env.dev)
npm run db:push:prod    # Push schema changes (uses .env.prod)
npm run db:studio       # Open Drizzle Studio
npm run db:studio:dev   # Open Drizzle Studio (uses .env.dev)
npm run db:studio:prod  # Open Drizzle Studio (uses .env.prod)
npm run db:generate     # Generate migrations
```

**Admin operations:**
```bash
npm run make-admin           # Promote user to admin
npm run make-admin:dev       # Uses .env.dev
npm run make-admin:prod      # Uses .env.prod
```

## Architecture

### Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Drizzle ORM (Neon serverless in production), pgvector for embeddings
- **AI Integration**: OpenAI APIs via Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **Voice/Communications**: Twilio Voice SDK for phone calls, OpenAI Realtime API
- **Background Jobs**: Inngest for async processing
- **File Storage**: Vercel Blob for file uploads
- **Authentication**: Custom JWT-based auth with bcrypt, RBAC (admin/user roles)
- **UI**: Radix UI components with Tailwind CSS, Framer Motion, Recharts, TanStack Table
- **State Management**: React hooks (useState, useCallback, useRef)

### Authentication System

Authentication is JWT-based with RBAC, implemented in `lib/auth.ts`:
- Sessions stored as HTTP-only cookies (`auth_token`)
- Tokens expire after 2 days with automatic refresh threshold (24 hours)
- `getSession()` is cached and used throughout the app for auth checks
- Protected routes redirect to `/` if no session exists
- **Domain restriction**: Only `@billboardsource.com` emails allowed
- **Roles**: `user` (default) and `admin` for management access

### Database Architecture

**Connection Strategy** (`db/index.ts`):
- Uses Neon serverless driver when `process.env.VERCEL` is set
- Falls back to node-postgres for local development
- All tables use snake_case casing

**Schema** (`db/schema.ts`):

1. **`user` table**:
   - `id` (varchar, 21 chars) - Primary key (nanoid)
   - `email` (varchar, 64 chars) - Unique
   - `password` (varchar, 64 chars) - Optional
   - `role` (varchar, 20 chars) - 'user' or 'admin'

2. **`openaiLogs` table** - API usage and cost tracking:
   - `id` (serial) - Primary key
   - `userId` (text) - Foreign key to user.id (cascade delete)
   - `model` (text) - Model used
   - `promptTokens`, `completionTokens`, `totalTokens` (integer)
   - `cost` (numeric, 10 digits, 6 decimals)
   - `sessionId` (text) - Session tracking
   - `status` (text) - 'pending' or 'completed'
   - `createdAt` (timestamp)

3. **`billboardLocations` table** - Market intelligence with vector search:
   - Location: `city`, `state`, `county` (text)
   - `marketIntelligence` (text) - Context for sales reps
   - Availability flags: `hasStaticBulletin`, `hasStaticPoster`, `hasDigital`
   - Vendor breakdown: `lamarPercentage`, `outfrontPercentage`, `clearChannelPercentage`, `otherVendorPercentage`
   - Pricing for bulletin/poster/digital at 12/24/52-week periods
   - Weekly impressions per billboard type
   - `embedding` (vector, 1536 dims) - For semantic search

### Data Access Layer (DAL)

`lib/dal.ts` centralizes database operations:
- `getCurrentUser()` - Get authenticated user
- `getUserByEmail()` - Query by email
- `createPendingLog()` / `updateLogCost()` - Cost tracking
- `getAllUsers()` / `deleteUsersByIds()` - Admin functions
- `getUserCosts()` - Aggregate costs per user
- `promoteToAdmin()` - Role management

### AI Integration Patterns

**1. Vercel AI SDK (Recommended)**
- `generateText()` - Summaries and unstructured text
- `generateObject()` - Type-safe structured extraction with Zod schemas
- `streamObject()` - Real-time streaming extraction (used in `/api/extract-billboard-fields`)
- `experimental_useObject` - Client-side streaming in hooks

**2. OpenAI SDK Direct**
- Used for Twilio integration and Realtime sessions
- Server actions in `actions/voice-actions.ts`

**Model Selection:**
- `gpt-4o-mini` - Fast, cheap operations (incremental updates, simple tasks)
- `gpt-4o` - Complex analysis requiring accuracy
- `text-embedding-3-small` - Vector embeddings (1536 dimensions)
- `gpt-4o-transcribe` - Realtime transcription

### Key Components

**SalesCallTranscriber** (`components/SalesCallTranscriber.tsx`):
- Main UI component (1166 lines)
- OpenAI Realtime API for transcription
- Twilio Voice SDK for phone calls
- WebRTC peer connection setup
- Billboard form field auto-extraction with confidence scoring
- Manual override for AI suggestions
- Cost tracking per session
- Billboard pricing context lookup

**BillboardDataUploader** (`components/BillboardDataUploader.tsx`):
- CSV file upload for billboard location data
- Triggers Inngest background job for processing

**useBillboardFormExtraction** (`hooks/useBillboardFormExtraction.ts`):
- Streaming extraction using `experimental_useObject`
- Debounced updates (500ms)
- Retry logic (max 3 retries)
- Confidence scoring per field
- Abort controller for request cancellation

### API Routes

| Route | Description |
|-------|-------------|
| `/api/token` | OpenAI realtime token generation |
| `/api/transcribe-file` | File upload transcription |
| `/api/extract-billboard-fields` | Streaming form field extraction |
| `/api/billboard-pricing` | Market intelligence lookup (RAG) |
| `/api/billboard-data/upload-blob` | File upload to Vercel Blob |
| `/api/billboard-data/process` | Trigger Inngest CSV processing |
| `/api/twilio-token` | Twilio Voice SDK tokens |
| `/api/twilio-inbound` | Incoming call webhook handler |
| `/api/openai/update-cost` | Update call duration and cost |
| `/api/inngest` | Inngest webhook for background jobs |

### Server Actions

Located in `actions/`:
- `auth.ts` - Authentication (login, signup with @billboardsource.com validation)
- `voice-actions.ts` - OpenAI Realtime sessions and text generation
- `user-actions.ts` - Admin user management (deleteUsers)

### Background Jobs (Inngest)

**Purpose:** Process large CSV files asynchronously

**Files:**
- `lib/inngest/client.ts` - Inngest client
- `lib/inngest/functions.ts` - Job definitions
- `app/api/inngest/route.ts` - Webhook handler

**processBillboardData function:**
1. Fetches CSV from Vercel Blob
2. Parses billboard location data
3. Generates text embeddings
4. Inserts records with vector embeddings

### Cost Tracking System

- Log entry created at session start (status: 'pending')
- Cost calculated at session end: `durationMinutes * 0.06`
- Admin dashboard displays per-user costs
- Implemented in `lib/dal.ts` and `/api/openai/update-cost`

## Environment Variables

Required in `.env.local` (or `.env.dev`/`.env.prod`):
```
# Core
DATABASE_URL=              # PostgreSQL connection string
JWT_SECRET=                # Min 32 chars for JWT signing
NODE_ENV=                  # production or development

# OpenAI
OPENAI_API_KEY=            # OpenAI API key

# Twilio
TWILIO_ACCOUNT_SID=        # Twilio account SID
TWILIO_API_KEY_SID=        # Twilio API key ID
TWILIO_API_KEY_SECRET=     # Twilio API key secret

# Vercel
VERCEL=                    # Set automatically in production
BLOB_READ_WRITE_TOKEN=     # Vercel Blob storage token

# Inngest (optional - auto-configured in Vercel)
INNGEST_EVENT_KEY=         # Inngest event key
INNGEST_SIGNING_KEY=       # Inngest signing key
```

## Code Conventions

### AI SDK Usage
- Use Zod schemas with `generateObject()` for structured extraction
- Use `streamObject()` for real-time streaming to clients
- Temperature: 0.2-0.3 for factual extraction, 0.4+ for creative content

### Session Management
- Use `getSession()` at the start of protected components/actions
- Check for null session and redirect to `/` if unauthorized
- Use DAL functions (`lib/dal.ts`) for database operations

### Database Operations
- Use Drizzle ORM's query syntax, not raw SQL
- Import `db` from `@/db` and schema types from `@/db/schema`
- Prefer DAL functions for common operations
- Run `npm run db:push:dev` or `db:push:prod` after schema changes

### Streaming Patterns
- Use `streamObject()` with `toTextStreamResponse()` for SSE
- Client-side: `experimental_useObject` from `@ai-sdk/react`
- Implement abort controllers for request cancellation

## Project Structure

```
app/
  (auth)/
    login/            # Login page
    signup/           # Signup page
    admin/            # Admin dashboard (RBAC protected)
  api/                # API routes (12 endpoints)
  dashboard/          # Protected dashboard pages
  layout.tsx          # Root layout with fonts
  page.tsx            # Landing page
actions/              # Server actions
components/
  ui/                 # Radix UI primitives
  SalesCallTranscriber.tsx
  BillboardDataUploader.tsx
  data-table.tsx
  chart-area-interactive.tsx
db/
  schema.ts           # Drizzle schema (3 tables)
  index.ts            # Database connection
drizzle/              # Migration files
hooks/
  useBillboardFormExtraction.ts
  use-mobile.ts
lib/
  auth.ts             # JWT authentication
  dal.ts              # Data access layer
  inngest/
    client.ts         # Inngest client
    functions.ts      # Background jobs
  schemas.ts          # Shared Zod schemas
  openai-pricing.ts   # Cost calculation
  utils.ts            # General utilities
scripts/
  make-admin.ts       # Promote user to admin
public/
  images/             # Product images
  videos/             # Demo videos
```

## Testing

Tests run with Vitest:
```bash
npm test                        # Run all tests
npm test -- path/to/test.spec.ts  # Run single file
```

## Common Issues

**Database connection errors:**
- Verify `DATABASE_URL` is set correctly
- Use correct env file (`.env.dev` vs `.env.prod`)
- Check Neon dashboard if deployed to Vercel

**OpenAI API errors:**
- Verify `OPENAI_API_KEY` is set
- Check API quota/billing in OpenAI dashboard
- Models: `gpt-4o`, `gpt-4o-mini`, `text-embedding-3-small`, `gpt-4o-transcribe`

**Twilio errors:**
- Verify all Twilio credentials are set
- Check webhook URL configuration in Twilio console
- Validate signature header in development may be skipped if token not set

**Session/auth issues:**
- Ensure `JWT_SECRET` is at least 32 characters
- Only @billboardsource.com emails are allowed
- Check cookie settings in `lib/auth.ts`

**Inngest job failures:**
- Check Inngest dashboard for job status
- Verify `BLOB_READ_WRITE_TOKEN` is set
- CSV must have correct column headers

**Build errors:**
- Next.js 15 requires React 19
- Run `npm install` to ensure dependencies are synced
- Clear `.next` cache if seeing stale builds

**Cost tracking:**
- Costs calculated at $0.06/minute for realtime transcription
- Check `openaiLogs` table for session tracking
- Admin dashboard shows aggregate costs per user
