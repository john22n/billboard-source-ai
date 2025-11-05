# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Billboard Source AI is a Next.js application for analyzing sales calls using OpenAI's APIs. The application provides real-time transcription, AI-powered analysis, and automated form field extraction from sales conversations.

## Development Commands

**Start development server:**
```bash
npm run dev
```
Server runs on http://localhost:3000 with Turbopack enabled.

**Build for production:**
```bash
npm build
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
npm run db:push    # Push schema changes to database
npm run db:studio  # Open Drizzle Studio for database inspection
```

## Architecture

### Tech Stack
- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Database**: PostgreSQL with Drizzle ORM (Neon serverless in production)
- **AI Integration**: OpenAI APIs via Vercel AI SDK (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`)
- **Authentication**: Custom JWT-based auth with bcrypt password hashing
- **UI**: Radix UI components with Tailwind CSS
- **State Management**: React hooks (useState, useCallback, useRef)

### Authentication System

Authentication is JWT-based, implemented in `lib/auth.ts`:
- Sessions stored as HTTP-only cookies (`auth_token`)
- Tokens expire after 2 days with automatic refresh threshold (24 hours)
- `getSession()` is cached and used throughout the app for auth checks
- Protected routes redirect to `/` if no session exists (see `app/dashboard/page.tsx`)

### Database Architecture

**Connection Strategy** (`db/index.ts`):
- Uses Neon serverless driver when `process.env.VERCEL` is set
- Falls back to node-postgres for local development
- All tables use snake_case casing

**Schema** (`db/schema.ts`):
- Single `User` table with id (nanoid), email, and password fields
- Schema is minimal; extend as needed for storing transcripts or analysis results

### AI Integration Patterns

The app uses **two distinct approaches** for AI operations:

**1. Vercel AI SDK (Recommended for new features)**
Located in `app/api/analyze-transcript/route.ts`:
- Uses `generateText()` for summaries and unstructured text
- Uses `generateObject()` with Zod schemas for type-safe structured extraction
- Supports two modes:
  - `incremental`: Fast analysis during recording (gpt-4o-mini)
  - `full`: Comprehensive analysis after recording (gpt-4o)
- Parallel execution of multiple AI calls with Promise.all
- Example Zod schemas: `keyPointsSchema`, `actionItemsSchema`, `detailedSentimentSchema`, `recommendationsSchema`

**2. OpenAI SDK Direct (Legacy pattern)**
Located in `actions/transcribe-actions.ts`:
- Server actions using `'use server'`
- Direct OpenAI API calls for transcription and analysis
- Used for: `createTranscriptionSession()`, `transcribeAudioFile()`, `analyzeSalesCall()`

**When adding new AI features**, prefer the Vercel AI SDK pattern for better type safety and streaming support.

### Key Components

**SalesCallTranscriber** (`components/SalesCallTranscriber.tsx`):
- Main UI component for recording and analyzing sales calls
- Handles audio capture, real-time transcription, and AI analysis display
- Large component (40KB+) managing multiple states

**useBillboardFormExtraction** (`hooks/useBillboardFormExtraction.ts`):
- Custom hook for extracting billboard form fields from transcripts
- Maintains form state with confidence scoring
- Supports both streaming and non-streaming extraction modes
- Tracks recent updates and extraction history

### API Routes

**Structure:**
- `app/api/analyze-transcript/route.ts` - Main AI analysis endpoint (incremental & full modes)
- `app/api/token/route.ts` - Token management
- `app/api/transcribe-file/route.ts` - File upload transcription

**Authentication:**
API routes should validate sessions using `getSession()` from `lib/auth.ts` when needed.

### Server Actions

Located in `actions/`:
- `auth.ts` - Authentication actions (login, signup, logout)
- `transcribe-actions.ts` - OpenAI transcription and analysis
- `voice-actions.ts` - Voice/audio processing

All actions use `'use server'` directive and are async functions.

## Environment Variables

Required in `.env.local`:
```
DATABASE_URL=          # PostgreSQL connection string
JWT_SECRET=            # Min 32 chars for JWT signing
OPENAI_API_KEY=        # OpenAI API key for transcription/analysis
NODE_ENV=              # production or development
```

## Code Conventions

### AI SDK Usage
- Always use Zod schemas with `generateObject()` for structured data extraction
- Use `gpt-4o-mini` for fast, cheap operations (incremental updates, simple tasks)
- Use `gpt-4o` for complex analysis requiring accuracy
- Set appropriate temperature: 0.2-0.3 for factual extraction, 0.4+ for creative content

### Session Management
- Always use `getSession()` at the start of protected server components/actions
- Check for null session and redirect to `/` if unauthorized
- Session is cached via React's `cache()` wrapper

### Database Operations
- Use Drizzle ORM's query syntax, not raw SQL
- Import `db` from `@/db` and schema types from `@/db/schema`
- Run `npm run db:push` after schema changes to update database

### TypeScript
- Use type inference where possible
- Define explicit types for API responses and Zod schemas
- Use `InferSelectModel` from Drizzle for database types

## Project Structure

```
app/
  (auth)/           # Auth-related pages (login, signup)
  api/              # API routes
  dashboard/        # Protected dashboard pages
  layout.tsx        # Root layout with fonts
  page.tsx          # Landing page
actions/            # Server actions
components/
  ui/               # Radix UI primitives
  [features]        # Feature components (SalesCallTranscriber, etc.)
db/
  schema.ts         # Drizzle schema definitions
  index.ts          # Database connection
hooks/              # Custom React hooks
lib/
  auth.ts           # Authentication utilities
  utils.ts          # General utilities
public/             # Static assets
```

## Testing

Tests run with Vitest. To run a single test file:
```bash
npm test -- path/to/test.spec.ts
```

## Common Issues

**Database connection errors:**
- Verify `DATABASE_URL` is set correctly
- Local dev uses node-postgres; production uses Neon serverless
- Check Neon dashboard if deployed to Vercel

**OpenAI API errors:**
- Verify `OPENAI_API_KEY` is set
- Check API quota/billing in OpenAI dashboard
- Model names: `gpt-4o`, `gpt-4o-mini`, `whisper-1`, `gpt-4o-transcribe`

**Session/auth issues:**
- Ensure `JWT_SECRET` is at least 32 characters
- Check cookie settings in `lib/auth.ts` (httpOnly, secure, sameSite)
- Session cookies expire after 2 days

**Build errors:**
- Next.js 15 requires React 19
- Run `npm install` to ensure dependencies are synced
- Clear `.next` cache if seeing stale builds
