# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Billboard Source AI is a Next.js application for analyzing sales calls using OpenAI's APIs. The application provides real-time transcription, AI-powered analysis, automated form field extraction from sales conversations, billboard market intelligence lookup, and Nutshell CRM integration.

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
- **File Storage**: Vercel Blob for file uploads
- **Authentication**: JWT-based auth with bcrypt + WebAuthn passkeys, RBAC (admin/user roles)
- **CRM**: Nutshell CRM integration for lead creation
- **Maps**: Google Maps API + ArcGIS for location visualization
- **UI**: Radix UI components with Tailwind CSS, Framer Motion, Recharts, TanStack Table, dnd-kit for drag-and-drop
- **State Management**: React hooks (useState, useCallback, useRef)

### Authentication System

Dual authentication: JWT-based password auth + WebAuthn passkeys.

**JWT Auth** (`lib/auth.ts`):
- Sessions stored as HTTP-only cookies (`auth_token`)
- Tokens expire after 2 days with automatic refresh threshold (24 hours)
- `getSession()` is cached and used throughout the app for auth checks
- Protected routes redirect to `/` if no session exists
- **Domain restriction**: Only `@billboardsource.com` emails allowed
- **Roles**: `user` (default) and `admin` for management access

**Passkey Auth** (`lib/passkey.ts`):
- Full WebAuthn/FIDO2 support via `@simplewebauthn/server` & `@simplewebauthn/browser`
- Passwordless login option
- PasskeyManager component for managing registered passkeys
- API routes under `/api/passkey/` for registration/authentication

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

2. **`passkey` table** - WebAuthn credentials:
   - `id` (varchar, 255) - Primary key
   - `userId` (varchar, 21) - Foreign key to user.id
   - `publicKey` (text) - WebAuthn public key
   - `counter` (integer) - Signature counter
   - `transports` (text) - Authenticator transports (JSON)
   - `deviceName` (varchar, 255) - User-friendly device name
   - `createdAt` (timestamp)

3. **`openaiLogs` table** - API usage and cost tracking:
   - `id` (serial) - Primary key
   - `userId` (text) - Foreign key to user.id (cascade delete)
   - `model` (text) - Model used
   - `promptTokens`, `completionTokens`, `totalTokens` (integer)
   - `cost` (numeric, 10 digits, 6 decimals)
   - `sessionId` (text) - Session tracking
   - `status` (text) - 'pending' or 'completed'
   - `createdAt` (timestamp)

4. **`billboardLocations` table** - Market intelligence with vector search:
   - Location: `city`, `state`, `county`, `market` (text)
   - `marketIntelligence` (text) - Context for sales reps
   - Availability flags: `hasStaticBulletin`, `hasStaticPoster`, `hasDigital`
   - Pricing: `avgMonthlyBulletinPrice`, `avgMonthlyPosterPrice`, `avgMonthlyDigitalPrice`
   - `avgDailyViews`, `avgViewsPerPeriod` (text)
   - Price ranges: `fourWeekRange`, `marketRange`, `generalRange`
   - `details` (text) - Additional info
   - `embedding` (vector, 1536 dims) - For semantic search

### Data Access Layer (DAL)

`lib/dal.ts` centralizes database operations:
- `getCurrentUser()` - Get authenticated user
- `getUserByEmail()` - Query by email
- `createPendingLog()` / `updateLogCost()` - Cost tracking
- `getAllUsers()` / `deleteUsersByIds()` - Admin functions
- `getUserCosts()` - Aggregate costs per user
- `promoteToAdmin()` - Role management
- Passkey operations: `createPasskey()`, `getPasskeysByUserId()`, `deletePasskey()`, etc.

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

**Sales Call Components** (`components/sales-call/`):
- `LeadForm.tsx` - Complex lead form with multiple contacts/markets, AI auto-fill, drag-and-drop reordering
- `PricingPanel.tsx` - Billboard pricing cards, Nutshell CRM submit integration
- `GoogleMapPanel.tsx` - Google Maps with Street View for location visualization
- `ArcGISMapPanel.tsx` - ArcGIS mapping alternative
- `TranscriptView.tsx` - Real-time transcript display

**SalesCallTranscriber** (`components/SalesCallTranscriber.tsx`):
- Main orchestrator component
- OpenAI Realtime API for transcription
- Twilio Voice SDK for phone calls
- WebRTC peer connection setup
- Billboard form field auto-extraction with confidence scoring
- Manual override for AI suggestions
- Cost tracking per session

**BillboardDataUploader** (`components/BillboardDataUploader.tsx`):
- CSV file upload for billboard location data
- Chunked processing (5000 records per chunk)
- Progress tracking UI

**PasskeyManager** (`components/passkey-manager.tsx`):
- Register new passkeys
- List/delete existing passkeys

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
| `/api/billboard-data/start-process` | Start chunked CSV processing, returns metadata |
| `/api/billboard-data/process-chunk` | Process single chunk of billboard data |
| `/api/twilio-token` | Twilio Voice SDK tokens |
| `/api/twilio-inbound` | Incoming call webhook handler |
| `/api/twilio/usage` | Fetch Twilio usage/costs |
| `/api/openai/update-cost` | Update call duration and cost |
| `/api/openai/usage` | Fetch OpenAI API usage via Admin API |
| `/api/passkey/auth-options` | Generate passkey auth options |
| `/api/passkey/auth-verify` | Verify passkey authentication |
| `/api/passkey/register-options` | Generate passkey registration options |
| `/api/passkey/register-verify` | Verify passkey registration |
| `/api/passkey/delete` | Delete a passkey |
| `/api/passkey/list` | List user's passkeys |
| `/api/nutshell/create-lead` | Create lead in Nutshell CRM |

### Server Actions

Located in `actions/`:
- `auth.ts` - Authentication (login with @billboardsource.com validation)
- `voice-actions.ts` - OpenAI Realtime sessions and text generation
- `user-actions.ts` - Admin user management (deleteUsers)

### Billboard Data Processing

CSV upload uses chunked processing (no background jobs):
1. `/api/billboard-data/start-process` - Counts records, clears existing data, returns chunk metadata
2. `/api/billboard-data/process-chunk` - Processes chunks of 5000 records at a time with embeddings
3. Progress tracked client-side in BillboardDataUploader

### Nutshell CRM Integration

`/api/nutshell/create-lead` creates leads in Nutshell CRM:
- Uses JSON-RPC API
- Finds user by email, creates lead with form data
- Auto-assigns to authenticated user
- PricingPanel has submit-to-Nutshell button

### Cost Tracking System

- Log entry created at session start (status: 'pending')
- Cost calculated at session end: `durationMinutes * 0.06`
- Admin dashboard displays per-user costs
- `/api/openai/usage` fetches last 30 days from OpenAI Admin API
- `/api/twilio/usage` fetches current/last month Twilio costs
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
OPENAI_ADMIN_KEY=          # OpenAI Admin API key (for usage stats)

# Twilio
TWILIO_ACCOUNT_SID=        # Twilio account SID
TWILIO_API_KEY_SID=        # Twilio API key ID
TWILIO_API_KEY_SECRET=     # Twilio API key secret
TWILIO_AUTH_TOKEN=         # Twilio auth token (for usage stats)

# Passkeys (WebAuthn)
PASSKEY_RP_ID=             # Relying party ID (e.g., domain name)
PASSKEY_ORIGIN=            # Origin URL (e.g., https://yourdomain.com)

# Nutshell CRM
NUTSHELL_API_KEY=          # Nutshell CRM API key

# Vercel
VERCEL=                    # Set automatically in production
BLOB_READ_WRITE_TOKEN=     # Vercel Blob storage token
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
    login/            # Login page (password + passkey)
    admin/            # Admin dashboard (RBAC protected)
  api/                # API routes (19 endpoints)
  dashboard/          # Protected dashboard pages
  layout.tsx          # Root layout with fonts
  page.tsx            # Landing page
actions/              # Server actions
components/
  ui/                 # Radix UI primitives
  sales-call/         # Modular sales call components
    LeadForm.tsx
    PricingPanel.tsx
    GoogleMapPanel.tsx
    ArcGISMapPanel.tsx
    TranscriptView.tsx
    index.ts
  SalesCallTranscriber.tsx
  BillboardDataUploader.tsx
  passkey-manager.tsx
  data-table.tsx
  chart-area-interactive.tsx
db/
  schema.ts           # Drizzle schema (4 tables)
  index.ts            # Database connection
drizzle/              # Migration files
hooks/
  useBillboardFormExtraction.ts
  use-mobile.ts
lib/
  auth.ts             # JWT authentication
  passkey.ts          # WebAuthn passkey helpers
  dal.ts              # Data access layer
  schemas.ts          # Shared Zod schemas
  openai-pricing.ts   # Cost calculation
  utils.ts            # General utilities
types/
  sales-call.ts       # Shared types (LeadSentiment enum, etc.)
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

**Passkey errors:**
- Verify `PASSKEY_RP_ID` matches your domain
- Ensure `PASSKEY_ORIGIN` includes protocol (https://)
- Check browser WebAuthn support

**Nutshell CRM errors:**
- Verify `NUTSHELL_API_KEY` is set
- Check user email exists in Nutshell

**Build errors:**
- Next.js 15 requires React 19
- Run `npm install` to ensure dependencies are synced
- Clear `.next` cache if seeing stale builds

**Cost tracking:**
- Costs calculated at $0.06/minute for realtime transcription
- Check `openaiLogs` table for session tracking
- Admin dashboard shows aggregate costs per user
