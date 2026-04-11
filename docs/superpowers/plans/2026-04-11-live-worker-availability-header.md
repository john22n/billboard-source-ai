# Live Worker Availability Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display which Twilio TaskRouter workers are currently "Available" in a live-updating indicator in the site header, visible to all logged-in users.

**Architecture:** A new GET route at `/api/workers/available` queries Twilio's TaskRouter Workers API filtered by `activityName = "Available"`, cross-references the returned SIDs against the `user` table to resolve display names from email addresses, and returns a JSON array. A custom hook polls this endpoint every 30 seconds and feeds a new `OnPhonesIndicator` header component.

**Tech Stack:** Next.js App Router (Route Handler), Twilio Node SDK (`twilio`), Drizzle ORM, React `useEffect`/`setInterval` polling, Tailwind CSS, shadcn/ui, Lucide icons.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/api/workers/available/route.ts` | **Create** | Twilio query + DB name resolution |
| `hooks/useAvailableWorkers.ts` | **Create** | 30s polling hook with loading/error state |
| `components/OnPhonesIndicator.tsx` | **Create** | Header UI pill — phone icon + names + count |
| `components/site-header.tsx` | **Modify** | Import and render `<OnPhonesIndicator />` |

---

## Task 1: Create the feature branch

**Files:** (git only — no code changes)

- [ ] **Step 1: Create and switch to the feature branch**

```bash
git checkout main
git pull origin main
git checkout -b feature/live-worker-availability-header
```

Expected output: `Switched to a new branch 'feature/live-worker-availability-header'`

---

## Task 2: Build the `/api/workers/available` route

**Files:**
- Create: `app/api/workers/available/route.ts`

This route:
1. Authenticates via `getSessionWithoutRefresh()` (no token refresh on polling calls)
2. Queries Twilio for workers with `activityName = "Available"`
3. Extracts the list of `workerSid` values from the Twilio response
4. Queries the `user` table for matching `taskRouterWorkerSid` rows to get emails
5. Converts each email to a display name (`jason.doe@...` → `"Jason D."`)
6. Returns `{ workers: [{ sid, displayName }] }`

- [ ] **Step 1: Create the route file**

```typescript
// app/api/workers/available/route.ts
import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { getSessionWithoutRefresh } from '@/lib/auth'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!

function emailToDisplayName(email: string): string {
  const local = email.split('@')[0] // e.g. "jason.doe"
  const parts = local.split('.')
  const first = parts[0]
    ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase()
    : ''
  const lastInitial = parts[1]
    ? ` ${parts[1].charAt(0).toUpperCase()}.`
    : ''
  return `${first}${lastInitial}` // "Jason D." or "Andre"
}

export async function GET() {
  try {
    const session = await getSessionWithoutRefresh()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!WORKSPACE_SID) {
      return Response.json({ workers: [] })
    }

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

    // Fetch workers whose current activity is "Available" from Twilio
    const twilioWorkers = await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers.list({ activityName: 'Available' })

    if (twilioWorkers.length === 0) {
      return Response.json(
        { workers: [] },
        { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
      )
    }

    const workerSids = twilioWorkers.map((w) => w.sid)

    // Cross-reference with DB to get display-friendly names from email
    const matchedUsers = await db
      .select({ email: user.email, taskRouterWorkerSid: user.taskRouterWorkerSid })
      .from(user)
      .where(inArray(user.taskRouterWorkerSid, workerSids))

    // Build a sid→email map for fast lookup
    const sidToEmail = new Map(
      matchedUsers.map((u) => [u.taskRouterWorkerSid, u.email]),
    )

    const workers = twilioWorkers.map((w) => {
      const email = sidToEmail.get(w.sid)
      const displayName = email
        ? emailToDisplayName(email)
        : w.friendlyName // fallback to Twilio friendly name
      return { sid: w.sid, displayName }
    })

    return Response.json(
      { workers },
      { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } },
    )
  } catch (error) {
    console.error('❌ Available workers GET error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify the route file is in the right place**

```bash
ls app/api/workers/available/route.ts
```

Expected: file exists with no error.

- [ ] **Step 3: Commit**

```bash
git add app/api/workers/available/route.ts
git commit -m "feat: add /api/workers/available route with Twilio + DB name resolution"
```

---

## Task 3: Build the `useAvailableWorkers` polling hook

**Files:**
- Create: `hooks/useAvailableWorkers.ts`

Follows the same shape as `hooks/useWorkerStatus.tsx`: `useEffect` + `setInterval` at 30s, abort controller to cancel in-flight requests on unmount, graceful auth/error handling.

- [ ] **Step 1: Create the hook file**

```typescript
// hooks/useAvailableWorkers.ts
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface AvailableWorker {
  sid: string
  displayName: string
}

interface UseAvailableWorkersResult {
  workers: AvailableWorker[]
  isLoading: boolean
  error: string | null
}

const POLL_INTERVAL = 30_000 // 30 seconds

export function useAvailableWorkers(): UseAvailableWorkersResult {
  const [workers, setWorkers] = useState<AvailableWorker[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const authFailedRef = useRef(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  const fetchWorkers = useCallback(async () => {
    if (authFailedRef.current) return

    try {
      const res = await fetch('/api/workers/available')

      if (res.status === 401) {
        authFailedRef.current = true
        if (intervalRef.current) clearInterval(intervalRef.current)
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Failed to fetch available workers')
      }

      const data = await res.json() as { workers: AvailableWorker[] }
      setWorkers(data.workers ?? [])
      setError(null)
    } catch (err) {
      console.error('Failed to fetch available workers:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkers()
    intervalRef.current = setInterval(fetchWorkers, POLL_INTERVAL)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchWorkers])

  return { workers, isLoading, error }
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useAvailableWorkers.ts
git commit -m "feat: add useAvailableWorkers polling hook (30s interval)"
```

---

## Task 4: Build the `OnPhonesIndicator` component

**Files:**
- Create: `components/OnPhonesIndicator.tsx`

Renders a pill/chip in the header. Uses `useAvailableWorkers`. Three display states:
- **Loading**: subtle pulsing skeleton
- **0 workers**: `📞 No one on phones` (muted text)
- **1+ workers**: `📞 On Phones: Jason D., Andre` with a badge showing the count

Style with Tailwind, consistent with the existing `site-header.tsx` muted-text aesthetic. Uses the `Phone` icon from `lucide-react` (already a project dependency, same as `BrainCircuit`).

- [ ] **Step 1: Create the component file**

```tsx
// components/OnPhonesIndicator.tsx
'use client'

import { Phone } from 'lucide-react'
import { useAvailableWorkers } from '@/hooks/useAvailableWorkers'
import { cn } from '@/lib/utils'

export function OnPhonesIndicator() {
  const { workers, isLoading, error } = useAvailableWorkers()

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground animate-pulse">
        <Phone className="size-3.5" />
        <span className="h-4 w-24 rounded bg-muted" />
      </div>
    )
  }

  // Silent failure — don't break the header if Twilio is down
  if (error) {
    return null
  }

  const count = workers.length

  if (count === 0) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground">
        <Phone className="size-3.5" />
        <span>No one on phones</span>
      </div>
    )
  }

  const names = workers.map((w) => w.displayName).join(', ')

  return (
    <div className="hidden sm:flex items-center gap-1.5 text-sm">
      <Phone className="size-3.5 text-green-500" />
      <span className="text-muted-foreground">
        On Phones:{' '}
        <span className="font-medium text-foreground">{names}</span>
      </span>
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-full px-1.5 py-0.5',
          'text-[11px] font-semibold leading-none',
          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        )}
      >
        {count}
      </span>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/OnPhonesIndicator.tsx
git commit -m "feat: add OnPhonesIndicator header component"
```

---

## Task 5: Wire `OnPhonesIndicator` into the site header

**Files:**
- Modify: `components/site-header.tsx`

Add `<OnPhonesIndicator />` to the left side of the header (after the `BrainCircuit` icon), before the `ml-auto` right section. This keeps the worker toggle flush-right while the availability indicator sits in the center-left area.

- [ ] **Step 1: Update `site-header.tsx`**

Replace the entire file content with:

```tsx
// components/site-header.tsx
"use client"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { WorkerStatusToggle } from "@/components/WorkerStatusToggle"
import { OnPhonesIndicator } from "@/components/OnPhonesIndicator"
import { BrainCircuit } from "lucide-react"

export function SiteHeader() {
  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-2 sm:px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mx-1 sm:mx-2 data-[orientation=vertical]:h-4"
        />
        <h1 className="text-base font-medium">
          <BrainCircuit className="size-4" />
        </h1>
        <OnPhonesIndicator />
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <span className="hidden sm:inline text-sm text-muted-foreground">Available to take calls?</span>
          <WorkerStatusToggle />
        </div>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npm run build:local 2>&1 | tail -20
```

Expected: build completes with no TypeScript errors. If errors appear, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add components/site-header.tsx
git commit -m "feat: wire OnPhonesIndicator into site header"
```

---

## Task 6: Security review of the new API route

**Files:**
- Modify (if needed): `app/api/workers/available/route.ts`

Checklist to verify manually:

- [ ] **Step 1: Confirm auth guard is present**

Open `app/api/workers/available/route.ts`. Verify that `getSessionWithoutRefresh()` is called first and returns a 401 if session is null — before any Twilio or DB call is made.

- [ ] **Step 2: Confirm no secrets are returned to the client**

The response only contains `{ workers: [{ sid, displayName }] }`. Worker SIDs are Twilio-internal identifiers (not secrets). No emails, auth tokens, or internal IDs are returned.

- [ ] **Step 3: Confirm environment variables are server-side only**

`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TASKROUTER_WORKSPACE_SID` have no `NEXT_PUBLIC_` prefix and are only read in the route handler (server). They will never be sent to the client bundle.

- [ ] **Step 4: Confirm graceful WORKSPACE_SID guard**

If `TASKROUTER_WORKSPACE_SID` is missing (e.g. local dev without `.env.dev`), the route returns `{ workers: [] }` instead of crashing.

- [ ] **Step 5: Commit any security fixes if needed**

If any issues were found and fixed:

```bash
git add app/api/workers/available/route.ts
git commit -m "fix: address security review findings on available workers route"
```

If no issues: no commit needed.

---

## Task 7: Manual smoke test

**Files:** (no code changes)

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Log in and check the header**

Navigate to `http://localhost:3000/dashboard`. Verify:
- The `OnPhonesIndicator` renders in the header (no blank crashes)
- If no workers are available: "No one on phones" displays
- If a worker is available: their name and a green count badge appear

- [ ] **Step 3: Toggle a worker to Available**

Use `WorkerStatusToggle` to set yourself Available. Within 30 seconds the indicator should update to show your name. Toggle back to Unavailable and it should disappear within 30 seconds.

- [ ] **Step 4: Test unauthenticated access**

```bash
curl -s http://localhost:3000/api/workers/available | jq .
```

Expected: `{"error":"Unauthorized"}` with HTTP 401 (no session cookie means no auth).

---

## Task 8: Final commit and push

- [ ] **Step 1: Verify git log looks clean**

```bash
git log --oneline feature/live-worker-availability-header ^main
```

Expected: 4–5 clean commits for this feature.

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feature/live-worker-availability-header
```
