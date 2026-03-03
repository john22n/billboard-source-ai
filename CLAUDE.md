# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Billboard Source AI is a Next.js application for analyzing sales calls using OpenAI's APIs. The application provides real-time transcription, AI-powered analysis, automated form field extraction from sales conversations, billboard market intelligence lookup, Twilio TaskRouter call routing with voicemail, and Nutshell CRM integration.

## Development Commands

**Start development server:**

```bash
npm run dev
```

Server runs on http://localhost:3000 with Turbopack enabled (uses `.env.dev`).

**Build for production:**

```bash
npm run build
npm run build:local    # Build using .env.dev
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
npm run db:push:prod    # Push schema changes (uses .env)
npm run db:studio       # Open Drizzle Studio
npm run db:studio:dev   # Open Drizzle Studio (uses .env.dev)
npm run db:studio:prod  # Open Drizzle Studio (uses .env)
npm run db:generate     # Generate migrations
```

**Admin operations:**

```bash
npm run make-admin           # Promote user to admin
npm run make-admin:dev       # Uses .env.dev
npm run make-admin:prod      # Uses .env
```

**TaskRouter operations:**

```bash
npm run taskrouter:setup:prod              # Setup TaskRouter workspace/workflow
npm run taskrouter:update-workflow:prod    # Update workflow config
npm run taskrouter:setup-voicemail:prod    # Setup voicemail worker
```

## Claude Code Plugins

Install these plugins for full project support:

```bash
/plugin frontend-design
/plugin vercel
```

## Architecture

### Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Drizzle ORM (Neon serverless in production), pgvector for embeddings
- **AI Integration**: OpenAI APIs via Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **Voice/Communications**: Twilio Voice SDK for phone calls, Twilio TaskRouter for call routing/queuing, OpenAI Realtime API
- **File Storage**: Vercel Blob for file uploads
- **Authentication**: JWT-based auth with bcrypt + WebAuthn passkeys, RBAC (admin/user roles)
- **CRM**: Nutshell CRM integration for lead creation
- **Maps**: Google Maps API + ArcGIS for location visualization
- **UI**: shadcn/ui (Radix UI primitives) with Tailwind CSS, Framer Motion, Recharts, TanStack Table, dnd-kit for drag-and-drop, Spline 3D (landing page)
- **State Management**: Zustand (`stores/formStore.ts`) + React hooks
- **Notifications**: Sonner toasts

### Authentication System

Dual authentication: JWT-based password auth + WebAuthn passkeys.

**JWT Auth** (`lib/auth.ts`):

- Sessions stored as HTTP-only session cookies (`auth_token`) - cleared when browser closes
- JWT expires after 4 hours; auto-refreshes if within 1 hour of expiration
- Two session getters:
  - `getSession()` - with auto-refresh (use for user-initiated actions)
  - `getSessionWithoutRefresh()` - no refresh (use for SSE/background checks)
- Protected routes redirect to `/` if no session exists
- **Domain restriction**: Only `@billboardsource.com` emails allowed
- **Roles**: `user` (default) and `admin` for management access
- `createUser()` accepts optional `twilioPhoneNumber` param

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

1. **`user` table** (`User`):
   - `id` (varchar, 21) - Primary key (nanoid)
   - `email` (varchar, 64) - Unique
   - `password` (varchar, 64) - Optional (passkey-only users)
   - `role` (varchar, 20) - 'user' or 'admin', default 'user'
   - `twilioPhoneNumber` (varchar, 20) - User's assigned Twilio DID
   - `taskRouterWorkerSid` (varchar, 34) - Twilio TaskRouter worker SID
   - `workerActivity` (varchar, 20) - 'offline'/'available'/'unavailable', default 'offline'

2. **`passkey` table** (`Passkey`) - WebAuthn credentials:
   - `id` (varchar, 36) - Primary key (UUID)
   - `userId` (varchar, 21) - FK to user.id (cascade delete)
   - `credentialId` (text) - Base64 encoded credential ID, unique
   - `publicKey` (text) - Base64 encoded public key
   - `counter` (integer) - Signature counter, default 0
   - `deviceType` (varchar, 32) - 'platform' or 'cross-platform'
   - `transports` (text) - JSON array of authenticator transports
   - `name` (varchar, 64) - User-friendly name, default 'Passkey'
   - `createdAt` (timestamp)

3. **`openaiLogs` table** (`openai_logs`) - API usage and cost tracking:
   - `id` (serial) - Primary key
   - `userId` (text) - FK to user.id (cascade delete)
   - `model` (text) - Model used
   - `promptTokens`, `completionTokens`, `totalTokens` (integer)
   - `cost` (numeric, 10 digits, 6 decimals)
   - `sessionId` (text) - Session tracking
   - `status` (text) - 'pending' or 'completed'
   - `createdAt` (timestamp)

4. **`billboardLocations` table** (`billboard_locations`) - Market intelligence with vector search:
   - `id` (serial) - Primary key
   - Location: `city` (text, not null), `state` (text, not null), `county` (text)
   - `market`, `avgDailyViews`, `fourWeekRange`, `marketRange`, `generalRange`, `details`, `avgViewsPerPeriod` (text)
   - Per-type pricing/views (integer, default 0):
     - `avgBullPricePerMonth`, `avgStatBullViewsPerWeek`
     - `avgPosterPricePerMonth`, `avgPosterViewsPerWeek`
     - `avgDigitalPricePerMonth`, `avgDigitalViewsPerWeek`
   - `embedding` (vector, **512 dims**) - For semantic search
   - **Indexes**: HNSW on embedding (cosine), composite on city+state
   - **Unique constraint**: `city_state_unique` on (city, state) for UPSERT support

### Data Access Layer (DAL)

`lib/dal.ts` centralizes database operations:

- `createPendingLog()` / `updateLogCost()` - Cost tracking
- `getAllUsers()` / `deleteUsersByIds()` - Admin functions
- `getUserCosts()` - Aggregate costs per user
- `updateUserTwilioPhone()` - Update user's Twilio DID
- `promoteToAdmin()` - Role management
- `getIssue()` / `getIssues()` - Issue queries

### AI Integration Patterns

**1. Vercel AI SDK (Recommended)**

- `generateText()` - Summaries and unstructured text
- `generateObject()` - Type-safe structured extraction with Zod schemas
- `streamObject()` - Real-time streaming extraction (used in `/api/extract-billboard-fields`)
- `experimental_useObject` - Client-side streaming in hooks

**2. OpenAI SDK Direct** (`lib/openai.ts`)

- Used for Twilio integration and Realtime sessions
- Server actions in `actions/voice-actions.ts`

**Model Selection:**

- `gpt-4o-mini` - Fast, cheap operations (incremental updates, simple tasks)
- `gpt-4o` - Complex analysis requiring accuracy
- `text-embedding-3-small` - Vector embeddings (512 dimensions)
- `gpt-4o-transcribe` - Realtime transcription

### Key Components

**Sales Call Components** (`components/sales-call/`):

- `LeadForm.tsx` - Complex lead form with multiple contacts/markets, AI auto-fill, drag-and-drop reordering
- `PricingPanel.tsx` - Billboard pricing cards, Nutshell CRM submit integration
- `GoogleMapPanel.tsx` - Google Maps with Street View for location visualization
- `ArcGISMapPanel.tsx` - ArcGIS mapping alternative
- `TranscriptView.tsx` - Real-time transcript display
- `formFields.tsx` - Field configuration for form rendering

**SalesCallTranscriber** (`components/SalesCallTranscriber.tsx`):

- Main orchestrator component
- OpenAI Realtime API for transcription
- Twilio Voice SDK for phone calls
- WebRTC peer connection setup
- Billboard form field auto-extraction with confidence scoring
- Manual override for AI suggestions
- Cost tracking per session

**Layout/Navigation** (`components/`):

- `app-sidebar.tsx` - Application sidebar
- `site-header.tsx` - Site header
- `nav-main.tsx`, `nav-user.tsx`, `nav-secondary.tsx`, `nav-documents.tsx` - Navigation components
- `login-form.tsx` - Login form with password + passkey
- `sign-up.tsx` - Sign up component
- `WorkerStatusToggle.tsx` - Twilio worker availability toggle

**Providers** (`components/providers/`):

- `TwilioProvider.tsx` - Twilio Voice SDK context provider

**Other**:

- `BillboardDataUploader.tsx` - CSV file upload with chunked processing
- `passkey-manager.tsx` - Register/list/delete passkeys
- `data-table.tsx` - TanStack data table

### Hooks

| Hook                            | Description                                                         |
| ------------------------------- | ------------------------------------------------------------------- |
| `useBillboardFormExtraction.ts` | Streaming field extraction with debounce, retry, confidence scoring |
| `useOpenAITranscription.ts`     | OpenAI transcription management                                     |
| `useWorkerStatus.tsx`           | Twilio TaskRouter worker activity status (SSE)                      |
| `useAutoLogout.ts`              | Auto-logout on session expiration                                   |
| `use-mobile.ts`                 | Mobile viewport detection                                           |

### State Management

**Zustand Store** (`stores/formStore.ts`):

- Client-side form state for lead form
- Tracks `userEditedFields`, `lockedFields`, `recentlyChangedFields`
- Used by LeadForm and SalesCallTranscriber
- **Three-tier AI merge logic in `updateFromAI()`**:
  1. `ALWAYS_UPDATE_FIELDS` (e.g. `notes`) — never locked, always overwritten by AI
  2. `userEditedFields` — user wins absolutely, AI never overwrites
  3. Locked fields — AI can update only if the new value is meaningfully different (word overlap check) or an "expansion" (e.g. "John" → "John Smith")
- **Phone field protection**: if `twilioPhonePreFilled` is true, AI extraction never overwrites the phone field (but still checks match for verification state)
- Granular selectors (`selectField`, `selectIsFieldLocked`, etc.) keep re-renders minimal

### API Routes (34 endpoints)

| Route                                     | Description                            |
| ----------------------------------------- | -------------------------------------- |
| **Auth**                                  |                                        |
| `/api/auth/check-user`                    | Check if user exists                   |
| `/api/auth/logout`                        | Logout / clear session                 |
| **OpenAI**                                |                                        |
| `/api/token`                              | OpenAI realtime token generation       |
| `/api/transcribe-file`                    | File upload transcription              |
| `/api/extract-billboard-fields`           | Streaming form field extraction        |
| `/api/openai/update-cost`                 | Update call duration and cost          |
| `/api/openai/usage`                       | Fetch OpenAI API usage via Admin API   |
| **Billboard**                             |                                        |
| `/api/billboard-pricing`                  | Market intelligence lookup (RAG)       |
| `/api/billboard-data/upload-blob`         | File upload to Vercel Blob             |
| `/api/billboard-data/start-process`       | Start chunked CSV processing           |
| `/api/billboard-data/process-chunk`       | Process single chunk of billboard data |
| **Twilio**                                |                                        |
| `/api/twilio-token`                       | Twilio Voice SDK tokens                |
| `/api/twilio-inbound`                     | Incoming call webhook handler          |
| `/api/twilio-status`                      | Call status callback                   |
| `/api/twilio/usage`                       | Fetch Twilio usage/costs               |
| `/api/twilio/voicemails`                  | Fetch voicemail recordings             |
| **TaskRouter**                            |                                        |
| `/api/taskrouter/assignment`              | Task assignment callback               |
| `/api/taskrouter/call-complete`           | Call completion handler                |
| `/api/taskrouter/enqueue-complete`        | Enqueue completion handler             |
| `/api/taskrouter/events`                  | TaskRouter event webhook               |
| `/api/taskrouter/voicemail`               | Voicemail recording handler            |
| `/api/taskrouter/voicemail-complete`      | Voicemail completion callback          |
| `/api/taskrouter/voicemail-transcription` | Voicemail transcription callback       |
| `/api/taskrouter/wait`                    | Queue wait music/message               |
| `/api/taskrouter/worker-availability`     | Get/set worker availability            |
| `/api/taskrouter/worker-status`           | Get worker status                      |
| `/api/taskrouter/worker-status-stream`    | SSE stream for worker status           |
| **Passkeys**                              |                                        |
| `/api/passkey/auth-options`               | Generate passkey auth options          |
| `/api/passkey/auth-verify`                | Verify passkey authentication          |
| `/api/passkey/register-options`           | Generate passkey registration options  |
| `/api/passkey/register-verify`            | Verify passkey registration            |
| `/api/passkey/delete`                     | Delete a passkey                       |
| `/api/passkey/list`                       | List user's passkeys                   |
| **CRM**                                   |                                        |
| `/api/nutshell/create-lead`               | Create lead in Nutshell CRM            |

### Server Actions

Located in `actions/`:

- `auth.ts` - Authentication (login with @billboardsource.com validation)
- `voice-actions.ts` - OpenAI Realtime sessions and text generation
- `transcribe-actions.ts` - Transcription-related server actions
- `user-actions.ts` - Admin user management (deleteUsers)

### Twilio TaskRouter Integration

Call routing system using Twilio TaskRouter:

- Inbound calls to `TWILIO_MAIN_NUMBER` are enqueued via TaskRouter
- Workers (sales reps) mapped to users via `taskRouterWorkerSid`
- Worker activity states: offline, available, unavailable
- `WorkerStatusToggle` component lets reps set availability
- `useWorkerStatus` hook streams status via SSE (`/api/taskrouter/worker-status-stream`)
- Voicemail handling: recording, transcription, email notification via Resend
- Scripts in `scripts/` for setup, debugging, and diagnostics

**Assignment callback routing logic** (`/api/taskrouter/assignment`):
1. `voicemail@system` worker → redirect to `/api/taskrouter/voicemail`
2. Worker has `simultaneous_ring: true` + `cell_phone` → redirect to `/api/taskrouter/simultaneous-dial` (dials browser client + cell phone in parallel; first to answer wins)
3. All others → conference instruction

**Simultaneous-dial-complete re-enqueue logic** (`/api/taskrouter/simultaneous-dial-complete`):
- `completed` → task marked complete
- `canceled`/`no-answer` and NOT already retried → re-enqueue call to next available worker (sets `retried: true` on task attributes to prevent loops)
- `canceled`/`no-answer` and already retried, or `busy`/`failed` → redirect to voicemail

**Worker attribute merge strategy** (`/api/taskrouter/worker-status` POST):
- Always fetches existing Twilio worker attributes before updating so custom fields (`simultaneous_ring`, `cell_phone`, `contact_uri`) are preserved
- Retries up to 3× on 409 Conflict (concurrent update race condition)

**SSE worker status stream** (`/api/taskrouter/worker-status-stream`):
- Uses `getSessionWithoutRefresh()` — won't extend the session timer
- Auth failures (401) are returned as SSE-formatted data (not HTTP 401) so the client can handle gracefully without triggering browser error behavior
- Keepalive comment (`: keepalive`) sent every 30 seconds

**Dashboard layout provider order** (`app/dashboard/layout.tsx`):
- `WorkerStatusProvider` wraps `TwilioProvider` — this order is required because `TwilioProvider` reads from `useWorkerStatus()`

**TwilioProvider device lifecycle** (`components/providers/TwilioProvider.tsx`):
- The Twilio Device is **never destroyed on component unmount** — it persists for the entire app session
- Destroyed only explicitly via `destroyDevice()` (called on logout)
- Polls every 2 seconds to detect unexpected destruction

### Billboard Data Processing

CSV upload uses chunked processing (no background jobs):

1. `/api/billboard-data/start-process` - Counts records, clears existing data, returns chunk metadata
2. `/api/billboard-data/process-chunk` - Processes chunks of 5000 records with 512-dim embeddings
3. Progress tracked client-side in BillboardDataUploader
4. UPSERT on city+state unique constraint

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

Required in `.env.local` (or `.env.dev`/`.env`):

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
TWILIO_MAIN_NUMBER=        # Main inbound Twilio number

# TaskRouter
TASKROUTER_WORKSPACE_SID=          # TaskRouter workspace SID
TASKROUTER_WORKFLOW_SID=           # TaskRouter workflow SID
TASKROUTER_ACTIVITY_AVAILABLE_SID= # "Available" activity SID
TASKROUTER_ACTIVITY_UNAVAILABLE_SID= # "Unavailable" activity SID
TASKROUTER_ACTIVITY_OFFLINE_SID=   # "Offline" activity SID

# Voicemail
VOICEMAIL_NOTIFICATION_EMAIL=      # Email for voicemail notifications
RESEND_API_KEY=                    # Resend email service API key

# Passkeys (WebAuthn)
PASSKEY_RP_ID=             # Relying party ID (e.g., domain name)
PASSKEY_ORIGIN=            # Origin URL (e.g., https://yourdomain.com)

# Nutshell CRM
NUTSHELL_API_KEY=          # Nutshell CRM API key

# Google Maps
NEXT_PUBLIC_GOOGLE_MAP_KEY= # Google Maps API key (client-side)

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
- Use `getSessionWithoutRefresh()` for SSE endpoints and background checks
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
- SSE manager in `lib/sse-manager.ts` for custom SSE endpoints
- Implement abort controllers for request cancellation

## Project Structure

```
app/
  (auth)/
    login/            # Login page (password + passkey)
    admin/            # Admin dashboard (RBAC protected)
  api/                # API routes (34 endpoints)
  dashboard/          # Protected dashboard (with own layout)
  layout.tsx          # Root layout with fonts
  page.tsx            # Landing page (Spline 3D)
actions/              # Server actions (4 files)
components/
  ui/                 # shadcn/ui primitives
  sales-call/         # Modular sales call components
    LeadForm.tsx
    PricingPanel.tsx
    GoogleMapPanel.tsx
    ArcGISMapPanel.tsx
    TranscriptView.tsx
    formFields.tsx
    index.ts
  providers/
    TwilioProvider.tsx
  SalesCallTranscriber.tsx
  BillboardDataUploader.tsx
  WorkerStatusToggle.tsx
  passkey-manager.tsx
  login-form.tsx
  sign-up.tsx
  app-sidebar.tsx
  site-header.tsx
  nav-main.tsx
  nav-user.tsx
  nav-secondary.tsx
  nav-documents.tsx
  data-table.tsx
db/
  schema.ts           # Drizzle schema (4 tables)
  index.ts            # Database connection
drizzle/              # Migration files
hooks/
  useBillboardFormExtraction.ts
  useOpenAITranscription.ts
  useWorkerStatus.tsx
  useAutoLogout.ts
  use-mobile.ts
stores/
  formStore.ts        # Zustand store for lead form state
lib/
  auth.ts             # JWT authentication
  passkey.ts          # WebAuthn passkey helpers
  dal.ts              # Data access layer
  schemas.ts          # Shared Zod schemas
  openai.ts           # OpenAI SDK direct usage
  openai-pricing.ts   # Cost calculation
  summarize.ts        # Summarization utilities
  error-handling.ts   # Error handling utilities
  sse-manager.ts      # Server-Sent Events manager
  utils.ts            # General utilities
types/
  sales-call.ts       # Shared types (LeadSentiment enum, etc.)
scripts/
  make-admin.ts       # Promote user to admin
  setup-taskrouter.ts # Setup TaskRouter workspace
  update-workflow.ts  # Update TaskRouter workflow
  setup-voicemail-worker.ts  # Setup voicemail worker
  sync-workers.ts     # Sync workers with DB
  # + diagnostic scripts (check-*, debug-*, diagnose-*)
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
- Use correct env file (`.env.dev` vs `.env`)
- Check Neon dashboard if deployed to Vercel

**OpenAI API errors:**

- Verify `OPENAI_API_KEY` is set
- Check API quota/billing in OpenAI dashboard
- Models: `gpt-4o`, `gpt-4o-mini`, `text-embedding-3-small`, `gpt-4o-transcribe`

**Twilio errors:**

- Verify all Twilio credentials are set
- Check webhook URL configuration in Twilio console
- For TaskRouter: ensure all `TASKROUTER_*` env vars are set
- Run diagnostic scripts (`check-workspace`, `check-workflow`, etc.) to debug

**Session/auth issues:**

- Ensure `JWT_SECRET` is at least 32 characters
- Only @billboardsource.com emails are allowed
- JWT expires after 4 hours of inactivity; session cookie clears on browser close
- Check cookie settings in `lib/auth.ts`

**Passkey errors:**

- Verify `PASSKEY_RP_ID` matches your domain
- Ensure `PASSKEY_ORIGIN` includes protocol (https://)
- Check browser WebAuthn support

**Nutshell CRM errors:**

- Verify `NUTSHELL_API_KEY` is set
- Check user email exists in Nutshell

**Build errors:**

- Next.js 16 requires React 19
- Run `npm install` to ensure dependencies are synced
- Clear `.next` cache if seeing stale builds

**Cost tracking:**

- Costs calculated at $0.06/minute for realtime transcription
- Check `openaiLogs` table for session tracking
- Admin dashboard shows aggregate costs per user
