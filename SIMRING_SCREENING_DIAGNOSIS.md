# Simultaneous Ring Cell Screening - Diagnosis & Solutions

## The Three Broken Scenarios

### Scenario 1: Agent Hangs Up on Cell
**Expected:** Browser conference ends, call terminates  
**Actual:** Browser keeps sitting there, call never ends

### Scenario 2: Agent Answers on Browser (clicks Accept)
**Expected:** Cell stops ringing  
**Actual:** Cell keeps ringing, agent gets a second call on their phone

### Scenario 3: Agent Answers on Cell (presses 1)
**Expected:** Browser is removed from conference, only cell + caller connected  
**Actual:** Browser stays in ghost state, potentially two conversations happening

---

## Root Cause Analysis

### The Critical Problem: `cellCallSid` Being Lost

Looking at `assignment/route.ts` lines 173-192:

```javascript
// Line 173: Build status callback BEFORE cell is created
const cellStatusCallback = `...&callerCallSid=${callerCallSid}...`;

// Lines 175-190: Create cell call
let cellCallSid = '';
try {
  const call = await twilioClient.calls.create({
    to: workerAttrs.cell_phone,
    twiml: cellTwiml,
    statusCallback: cellStatusCallback,  // ❌ cellCallSid still empty here!
    ...
  });
  cellCallSid = call.sid;  // cellCallSid obtained AFTER creation
}

// Line 192: Build conference callback with cellCallSid
const conferenceStatusCallbackUrl = `...&cellCallSid=${cellCallSid}...`;
```

**Problem 1:** The cell status callback URL is built BEFORE `cellCallSid` is obtained, so it doesn't have the cell's SID for later identification. This makes it hard for `twilio-status` to self-reference.

**Problem 2:** If cell creation fails (exception at line 177), `cellCallSid` stays `''`, but the conference callback still builds with empty string, getting lost.

**Problem 3:** The `cellCallSid` is passed via URL param to `call-complete`. URL params can get truncated or lost by Twilio if the URL is too long.

**Problem 4:** The cell screening URL is built with XML escaping, but the cell status callback URL might not be getting passed correctly to the cell call's own status callback.

### Why Callbacks Aren't Working

1. **conference-start fires when BROWSER answers** → tries to cancel `cellCallSid` from URL
   - If URL param was lost or empty, nothing happens
   - Cell keeps ringing

2. **twilio-status in-progress fires when CELL answers** → should kick browser
   - Has `conferenceName` and can kick browser from conference ✅
   - But `CallSid` in the callback is the CELL's call SID, not identifiable without stored mapping

3. **participant-leave fires when BROWSER leaves** → tries to cancel cell
   - Needs to know `cellCallSid` from URL params
   - If lost, can't find it

4. **Cell hung up completed event** → should clean conference
   - Relies on `conferenceName` to find conference ✅
   - Can remove participants ✅
   - But doesn't reliably fire or gets lost

---

## Why Previous Attempts Failed

### ❌ "Using conference-start in call-complete to cancel the cell when browser answers"
- **Failed because:** `cellCallSid` was either empty or lost in URL
- **Result:** Tried to cancel empty string, did nothing

### ❌ "Using participant-leave comparing callSid === cellCallSid"
- **Failed because:** `cellCallSid` from URL was empty/lost
- **Result:** Comparison always failed

### ❌ "Moving cell-side cleanup to twilio-status in-progress"
- **Partially works** because it uses `conferenceName` to lookup conference (reliable)
- **Can kick browser** directly via conference API ✅
- **But** doesn't prevent browser from re-joining or staying in ghost state

### ❌ "Moving cell hangup cleanup to twilio-status completed"
- **Partially works** because `conferenceName` is reliable
- **But** relies on callback firing, which Twilio doesn't always guarantee for 100% of calls

---

## The Real Solution

Instead of relying on unreliable callback chains and fragile URL params, use **proactive cleanup** and **reliable lookup mechanisms**:

### 1. Store `cellCallSid` Reliably (Not in URL)

**Current approach:** Pass via URL querystring → Gets lost or truncated

**Better approach:** Store in a fast key-value store (Redis) with reservation as key:
```javascript
// In assignment/route.ts after creating cell call:
const cacheKey = `simring:${reservationSid}`;
await redis.set(cacheKey, JSON.stringify({
  cellCallSid: cellCallSid,
  conferenceName: conferenceName,
  callerCallSid: callerCallSid,
  taskSid: taskSid,
  workspaceSid: workspaceSid,
  workerSid: workerSid,
  createdAt: Date.now(),
}), 'EX', 3600); // 1 hour TTL
```

Then in callbacks, look it up:
```javascript
const cached = await redis.get(`simring:${reservationSid}`);
if (cached) {
  const { cellCallSid, ...rest } = JSON.parse(cached);
  // Now have reliable cellCallSid
}
```

### 2. Use Proactive Polling + Cancellation (Not Passive Callbacks)

Instead of waiting for Twilio callbacks, **actively check and cancel** in each endpoint:

```javascript
// When browser answers:
// 1. Get cellCallSid from cache (reliable)
// 2. Use Twilio REST API to fetch call status
// 3. If still ringing/in-progress, cancel it immediately

const cellCall = await client.calls(cellCallSid).fetch();
if (['ringing', 'initiated', 'queued'].includes(cellCall.status)) {
  await client.calls(cellCallSid).update({ status: 'canceled' });
}
```

### 3. Use Reliable Conference Lookup

**Current:** Relies on passing `conferenceName` via URL  
**Reliable:** Use `conferenceName` since it's generated from `reservationSid` which is always available

```javascript
// cellScreening: Agent pressed 1
// We have reservationSid from URL (reliable)
const conferenceName = `simring-${reservationSid}`;

// Look up and modify conference (Twilio API is reliable for this)
const conferences = await client.conferences.list({
  friendlyName: conferenceName,
  status: 'in-progress',
  limit: 1,
});

if (conferences.length > 0) {
  const participants = await client.conferences(conferences[0].sid).participants.list();
  // Kick everyone except cell
}
```

### 4. Add Explicit Cleanup Endpoints

Create endpoints for explicit cleanup that can be called from browser:

```typescript
// POST /api/simring-cancel-cell
// Called by browser when agent clicks Accept
// Cancels the ringing cell immediately
```

---

## Detailed Fix: Add Redis Cache Layer

### Installation
```bash
npm install redis
# or add to existing Redis setup
```

### Create cache helper
```typescript
// lib/simring-cache.ts
import { createClient } from 'redis';

const redis = createClient();
redis.connect();

export async function storeSimringContext(reservationSid: string, data: any) {
  await redis.set(
    `simring:${reservationSid}`,
    JSON.stringify(data),
    { EX: 3600 } // 1 hour TTL
  );
}

export async function getSimringContext(reservationSid: string) {
  const cached = await redis.get(`simring:${reservationSid}`);
  return cached ? JSON.parse(cached) : null;
}

export async function deleteSimringContext(reservationSid: string) {
  await redis.del(`simring:${reservationSid}`);
}
```

### Update assignment/route.ts
```typescript
// After creating cell call (line 186)
cellCallSid = call.sid;

// Store context reliably
await storeSimringContext(reservationSid, {
  cellCallSid,
  conferenceName,
  callerCallSid,
  taskSid,
  workspaceSid,
  workerSid,
  createdAt: Date.now(),
});

// Don't rely on passing it via URL anymore!
// If you must pass via URL (for redundancy), at least validate it:
const conferenceStatusCallbackUrl = `${appUrl}/api/taskrouter/call-complete?reservationSid=${reservationSid}${bypassParam}`;
```

### Update call-complete/route.ts
```typescript
// Instead of:
const cellCallSid = url.searchParams.get('cellCallSid') || '';

// Do:
const reservationSid = url.searchParams.get('reservationSid');
const simringContext = await getSimringContext(reservationSid);
const cellCallSid = simringContext?.cellCallSid || '';

// Now cellCallSid is reliable!
```

### Update twilio-status/route.ts (Same pattern)

---

## Detailed Fix: Add Explicit Browser API to Cancel Cell

### New endpoint: `/api/simring-cancel-cell`

```typescript
// app/api/simring-cancel-cell/route.ts
import { getSimringContext } from '@/lib/simring-cache';
import twilio from 'twilio';

export async function POST(req: Request) {
  const { reservationSid } = await req.json();
  
  if (!reservationSid) {
    return Response.json({ error: 'Missing reservationSid' }, { status: 400 });
  }

  try {
    const simringContext = await getSimringContext(reservationSid);
    if (!simringContext?.cellCallSid) {
      return Response.json({ ok: true, msg: 'No active cell call' });
    }

    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);
    const call = await client.calls(simringContext.cellCallSid).fetch();
    
    // Only cancel if still ringing/queued
    if (['ringing', 'initiated', 'queued', 'in-progress'].includes(call.status)) {
      await client.calls(simringContext.cellCallSid).update({ 
        status: 'canceled' 
      });
      console.log(`✅ Cell ${simringContext.cellCallSid} canceled via API`);
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error('❌ Error canceling cell:', err);
    return Response.json({ error: 'Failed to cancel cell' }, { status: 500 });
  }
}
```

### Call from browser (when agent clicks Accept):
```typescript
// Browser code
const reservationSid = useContext(ReservationContext); // from Twilio.Device callback
await fetch('/api/simring-cancel-cell', {
  method: 'POST',
  body: JSON.stringify({ reservationSid }),
});
```

---

## Detailed Fix: Add Logging Everywhere

### Enhanced logging template:
```typescript
// At START of each endpoint:
console.log('═══════════════════════════════════════════');
console.log('[ENDPOINT_NAME]');
console.log('Inputs:', {
  queryParam1: url.searchParams.get('queryParam1'),
  queryParam2: url.searchParams.get('queryParam2'),
});

// At EACH decision point:
console.log(`[DECISION] Checking ${condition}:`, { condition, value1, value2 });

// At EACH API call:
console.log(`[CALL] Fetching ${resource}...`);
try {
  const result = await api.call();
  console.log(`[CALL] ✅ Got result:`, { status: result.status, sid: result.sid });
} catch (err) {
  console.log(`[CALL] ❌ Failed:`, err.message);
}
```

---

## Summary of Fixes

| Issue | Root Cause | Solution |
|-------|-----------|----------|
| cellCallSid lost | Passed via URL | Store in Redis with reservation key |
| conference-start fails to cancel | Empty cellCallSid | Get from Redis cache, validate non-empty |
| participant-leave doesn't work | Empty cellCallSid | Same: get from Redis |
| Browser in ghost state | Not explicitly kicked | Call `/api/simring-cancel-cell` from browser on Accept |
| Callbacks unreliable | Twilio doesn't guarantee delivery | Proactive API calls instead of waiting for callbacks |
| Hard to debug | Sparse logging | Add detailed logging at every step |

---

## Implementation Priority

1. **Add Redis cache layer** (enables all other fixes)
2. **Add explicit `/api/simring-cancel-cell` endpoint** (fixes "browser keeps ringing" scenario)
3. **Update all callbacks to use Redis** (fixes URL param loss)
4. **Add comprehensive logging** (for debugging)
5. **Test all three scenarios** with logs

---

## Testing After Implementation

### Scenario 1: Agent Hangs Up on Cell
1. Agent receives call
2. Agent presses 1 (accepts on cell)
3. Call connects → both in conference
4. Agent hangs up on cell
5. ✅ Conference should end, browser should disconnect
6. **Verify logs:** "Cell hung up after Xs — cleaning up"

### Scenario 2: Agent Answers on Browser
1. Agent receives call (both ring)
2. Agent clicks Accept in app
3. ✅ Cell should stop ringing immediately
4. ✅ Agent should only hear caller (no second phone call)
5. **Verify logs:** "Browser answered (conference-start) — canceling cell"

### Scenario 3: Agent Answers on Cell
1. Agent receives call (both ring)
2. Agent presses 1 on cell
3. ✅ Browser should be kicked from conference
4. ✅ Only cell + caller should be connected
5. **Verify logs:** "Agent accepted call on cell — kicking browser"

---

## Why This Solution Works

1. **Redis guarantees** cellCallSid is never lost between requests
2. **Proactive API calls** don't rely on callbacks firing
3. **Conference lookup** uses reliable `reservationSid` derivation
4. **Explicit browser endpoint** lets agent action trigger cleanup immediately
5. **Comprehensive logging** makes debugging trivial

This is NOT a callback-driven solution (which is fragile), but an **API-driven solution** (which is reliable).
