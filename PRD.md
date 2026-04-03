# Product Requirements Document: Billboard Source AI

**Status:** Active Development
**Last Updated:** 2026-04-03

---

## 1. Overview

**Billboard Source AI** is an internal sales tool for Billboard Source sales reps. It provides real-time call transcription, AI-powered form auto-fill, billboard market pricing lookup, inbound call routing with voicemail fallback, and one-click CRM lead submission — all in a single browser-based interface.

---

## 2. Problem Statement

Billboard Source sales reps take inbound advertising inquiries over the phone. The current process is manual and fragmented:

- **Manual note-taking during calls** is error-prone and forces reps to split attention between the prospect and their keyboard.
- **No call routing or voicemail**: missed calls when reps are unavailable result in lost leads.
- **Pricing lookup is manual friction mid-call**: reps must context-switch to look up market rates, interrupting the conversation.
- **CRM entry happens after the call**: data is entered from memory, leading to incomplete or inaccurate leads.
- **No cost visibility**: there is no per-rep tracking of telephony or AI usage costs.

---

## 3. Target Users

| Persona       | Description                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sales Rep** | `@billboardsource.com` employees who take inbound billboard advertising calls. Primary daily user of the transcription, form extraction, and CRM submission features. |
| **Admin**     | Internal staff who manage user accounts, upload billboard market pricing data, and review usage costs across all reps.                                                |

---

## 4. Goals & Success Metrics

| Goal                              | Metric                                                    |
| --------------------------------- | --------------------------------------------------------- |
| Reduce time-to-CRM-entry per call | Time from call end to Nutshell lead submitted             |
| Increase lead form completeness   | % of required fields populated before submission          |
| Capture 100% of inbound calls     | Calls answered or routed to voicemail / zero dropped      |
| Surface pricing data during calls | Billboard market lookup available without leaving the app |
| Track costs per rep               | Per-user OpenAI + Twilio cost visible to admins           |

---

## 5. Core Features

### 5.1 Real-Time Call Transcription

Live transcription of inbound sales calls using the OpenAI Realtime API. Two separate WebRTC sessions capture the caller (remote) and agent (local) streams independently. Transcripts are displayed in real-time and used as input for AI field extraction.

- **Model:** OpenAI Realtime API (`whisper-1` via WebRTC DataChannel)
- **Streams:** Dual `RTCPeerConnection` — one per call participant
- **Output:** `TranscriptItem[]` assembled into a single `fullTranscript` string per session

### 5.2 AI-Powered Form Field Extraction

As the transcript grows, GPT-4o streams extracted values (caller name, company, markets of interest, contact info, notes, etc.) directly into the lead form. The AI respects user edits — fields manually edited by the rep are locked and never overwritten.

- **Model:** `gpt-4o` streaming via Vercel AI SDK `streamObject()`
- **Field protection:** Three-tier merge logic (always-update fields, user-locked fields, expansion-allowed fields)
- **Debounced** during the call; one final extraction pass on call end

### 5.3 Billboard Market Intelligence Lookup

When a market (city/state) is identified in the conversation, the app performs a semantic vector search against the billboard locations database to surface relevant pricing ranges and average views per period.

- **Storage:** PostgreSQL + pgvector (512-dim embeddings, HNSW index, cosine similarity)
- **Embedding model:** `text-embedding-3-small`
- **Coverage:** Bulletin, poster, and digital billboard types with per-type pricing and traffic data

### 5.4 Inbound Call Routing (Twilio TaskRouter)

Inbound calls to the main Twilio number are enqueued via TaskRouter and assigned to available sales reps. Supports simultaneous ring (browser client + cell phone) with a "press 1" cell-screening step to prevent carrier voicemail from silently accepting the call.

**Routing logic:**

1. Call arrives → enqueued to TaskRouter workflow
2. TaskRouter assigns task to an available worker
3. If worker has simultaneous ring enabled → browser + cell phone ring in parallel; first to answer wins
4. If no answer after retry → voicemail recording + transcription + email notification

**Worker states:** `offline` / `available` / `unavailable` — controlled by the rep via a toggle in the UI.

### 5.5 Nutshell CRM Lead Submission

After the call, the rep reviews the auto-filled lead form and submits it to Nutshell CRM with one click. The lead is created via Nutshell's JSON-RPC API and auto-assigned to the authenticated rep.

### 5.6 Cost Tracking

Session costs are logged at call start (status: `pending`) and finalized at call end. Admins can view per-user aggregate costs for OpenAI usage and Twilio telephony from the admin dashboard.

- **Realtime transcription cost:** `$0.06 / minute`
- **OpenAI usage:** Last 30 days via OpenAI Admin API
- **Twilio usage:** Current and prior month via Twilio Usage API

### 5.7 Admin Dashboard

Protected admin area for managing the application:

- **User management:** View all users, promote to admin, delete accounts
- **Billboard data upload:** CSV bulk upload with chunked processing (5,000 records/chunk) and vector embedding generation
- **Cost visibility:** Per-user cost breakdown for OpenAI and Twilio

### 5.8 Authentication

Dual authentication supporting both password-based login and passwordless WebAuthn passkeys.

- **Password auth:** JWT in HTTP-only session cookie; 4-hour expiry with auto-refresh; clears on browser close
- **Passkeys:** Full WebAuthn/FIDO2 via `@simplewebauthn/server`; platform and cross-platform authenticators supported
- **Domain restriction:** Only `@billboardsource.com` email addresses may register or log in
- **RBAC:** `user` (default) and `admin` roles

---

## 6. User Stories

### Sales Rep

- As a sales rep, I want my call to be transcribed in real-time so I can focus on the conversation instead of taking notes.
- As a sales rep, I want the lead form to auto-fill from the transcript so I don't have to type out details I already discussed.
- As a sales rep, I want to see billboard pricing for any market mentioned during the call so I can quote rates without leaving the app.
- As a sales rep, I want to submit the completed lead directly to Nutshell CRM from the same screen where I took the call.
- As a sales rep, I want my phone to ring simultaneously with my browser so I can answer calls on my cell if needed.
- As a sales rep, I want callers to reach voicemail when I'm unavailable so no lead is lost.
- As a sales rep, I want to set my availability status (available/unavailable/offline) from the app.

### Admin

- As an admin, I want to see how much each rep is spending on AI and phone usage so I can manage costs.
- As an admin, I want to upload updated billboard pricing data so reps always have current market information.
- As an admin, I want to promote users to admin and deactivate accounts without touching the database.
- As an admin, I want voicemail recordings and transcriptions delivered by email so I can review missed calls.

---

## 7. Out of Scope

The following are explicitly not supported in the current version:

- **Outbound dialing** — the app handles inbound calls only
- **Multi-tenant / multi-organization support** — single-org deployment for Billboard Source
- **Mobile native app** — web-only; responsive design is not a stated goal
- **Non-billboard advertising verticals** — pricing data and form fields are billboard-specific
- **Call recording** — transcription only; no audio archiving
- **SMS / messaging** — voice channel only

---

## 8. Technical Constraints

| Constraint             | Details                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| **Domain restriction** | Only `@billboardsource.com` emails allowed; enforced at the server action layer                        |
| **Database**           | PostgreSQL with pgvector extension required; 512-dimensional embeddings for market search              |
| **Telephony**          | Twilio account with TaskRouter workspace, workflow, and worker SIDs required                           |
| **Deployment**         | Assumes Vercel; uses Neon serverless driver when `VERCEL` env var is set; Vercel Blob for file storage |
| **OpenAI**             | Requires both a standard API key (transcription, extraction) and an Admin API key (usage stats)        |
| **Email**              | Resend API key required for voicemail notification emails                                              |
| **Maps**               | Google Maps API key required for location visualization in the lead form                               |
| **CRM**                | Nutshell CRM API key required; user email must exist in Nutshell for lead assignment                   |
