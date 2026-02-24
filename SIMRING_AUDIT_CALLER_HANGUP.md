# Simultaneous Ring Audit: Cell vs App Behavior

## Problem Statement

The app (GPP2) correctly participates in round-robin queue management, but the cell phone does not. When scenarios occur, they behave differently:

1. **Caller hangs up while waiting** → App cleans up properly, cell keeps ringing + conference stays open
2. **Agent declines/misses on cell** → Caller goes to voicemail instead of next agent
3. **Cell is not part of round-robin** → Cell leg can orphan and cause downstream issues

## Root Cause Analysis

### Issue 1: Caller Hangup Not Handling Cell Leg

**Current Flow (call-complete):**

When caller hangs up, Twilio fires `enqueue-complete` with `QueueResult='hangup'`. Looking at `enqueue-complete/route.ts`:

```javascript
// Line 32-37
if (queueResult === 'hangup') {
  console.log('📞 Caller hung up while waiting');
  return new Response(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } }
  );
}
```

**The Problem:** This only returns `<Hangup/>` for the caller. It does NOT:
- Cancel any ringing cell leg
- Reject the reservation in TaskRouter
- End the conference

**Result:** 
- Caller disconnects
- Cell continues ringing to the worker
- Conference stays active
- Task remains in "assigned" state
- Worker sees phantom ringing

### Issue 2: Cell Decline/No-Answer Not Rejecting Reservation

**Current Flow (twilio-status):**

Lines 241-272 handle cell decline/no-answer:

```javascript
if (
  CallStatus === 'no-answer' ||
  CallStatus === 'busy' ||
  (CallStatus === 'canceled' && (!CallDuration || CallDuration === '0')) ||
  (CallStatus === 'completed' && (!CallDuration || CallDuration === '0'))
) {
  // Rejection logic here
}
```

**The Logic Exists** ✅ BUT the problem is in how TaskRouter parameters are passed.

Looking at `assignment/route.ts` line 130, the cell status callback receives:
- `reservationSid` ✅
- `workspaceSid` ✅  
- `workerSid` ✅

So the rejection SHOULD work... Let me trace more carefully.

**Wait, there's a subtle issue**: The cell call is created BEFORE it's added to the conference. When the caller hangs up in the queue (before conference-start), the cell is still ringing but the `cellCallSid` in the URL might not be available in all callbacks.

### Issue 3: Caller Hangup During Conference Not Ending Conference

**Current Flow:**

When GPP2 (app) is in conference and caller hangs up:
- Conference fires `customer_exit` or similar
- `call-complete` callback handles it
- Should end conference and complete task

But when cell is in-progress and caller hangs up:
- Cell is in a conference via TwiML `<Conference startConferenceOnEnter="false">`
- When caller exits, who tears down the conference?
- Nothing explicitly does!

## Solution: Fix Enqueue-Complete Hangup Handler

The `enqueue-complete/route.ts` needs to handle the simultaneous ring cell leg cleanup when caller hangs up:

```typescript
// When caller hangs up:
// 1. Cancel any active cell leg (already ringing from assignment)
// 2. Reject the reservation so TaskRouter knows not to ring next agent
// 3. End the conference to disconnect worker cleanly
```

### Step 1: Cancel Active Cell Leg

Use the same logic from `cancel-cell/route.ts` — find all active calls and cancel them.

**Problem:** `enqueue-complete` doesn't know which worker was assigned. Need to look up active conferences by caller's call SID.

**Solution:** When caller is in Enqueue, TaskRouter conference already has:
- Caller (CallSid from enqueue-complete)
- Worker (app or cell)
- Cell (if simultaneous ring)

We can:
1. Look up all active conferences for that caller's CallSid
2. Find the one with name pattern `simring-*`
3. Extract `reservationSid` from the conference name
4. Cancel any participant that's NOT the caller
5. Reject the TaskRouter reservation

OR simpler: Pass the reservation context through to enqueue-complete.

## Recommended Fix

**Option A: Pass Metadata Through Enqueue** (Cleaner)

Modify the Enqueue callback to pass reservation metadata:

```xml
<Enqueue 
  workflowSid="..."
  onQueueComplete="{{appUrl}}/api/taskrouter/enqueue-complete?reservationSid={{reservation.sid}}&taskSid={{task.sid}}&workspaceSid={{workspace.sid}}&workerSid={{worker.sid}}"
/>
```

Then in `enqueue-complete`, when `hangup`:
```javascript
if (queueResult === 'hangup') {
  // 1. Cancel cell leg using workerSid
  // 2. Reject reservation using reservationSid
  // 3. Hangup caller
}
```

**Option B: Conference Lookup** (Fallback if Option A not possible)

Look up active conferences by friendlyName pattern and extract reservation from name.

## Expected Behavior After Fix

### Scenario: Caller Hangs Up While Waiting

**Before (broken):**
1. Caller in queue → cell ringing
2. Caller hangs up → `enqueue-complete` fires with `hangup`
3. Only caller disconnects
4. Cell keeps ringing indefinitely
5. Conference stays open
6. Worker confused

**After (fixed):**
1. Caller in queue → cell ringing
2. Caller hangs up → `enqueue-complete` fires with `hangup`
3. `enqueue-complete` cancels active cell leg
4. `enqueue-complete` rejects reservation
5. `enqueue-complete` ends conference
6. TaskRouter knows reservation was rejected
7. Cell stops ringing immediately
8. Everything clean

### Scenario: Agent Declines on Cell

**Before (broken):**
1. Cell rings → agent doesn't answer (20s timeout)
2. `twilio-status` fires with `no-answer`
3. Reservation is rejected ✅
4. TaskRouter assigns next agent... BUT
5. Cell leg might still be in-progress or hung in conference

**After (fixed):**
- Same as before, but confirmed cell is fully terminated by status callback

### Scenario: Caller Hangs Up While Connected to Cell

**Before (broken):**
1. Caller and cell connected in conference
2. Caller hangs up
3. Cell is left holding empty conference
4. Eventually times out (bad UX)

**After (fixed):**
1. Caller and cell connected
2. Caller hangs up
3. Twilio fires conference participant-leave
4. Cell detects it's alone, exits gracefully
5. Conference ends cleanly

## Implementation Plan

### Phase 1: Fix enqueue-complete Hangup (HIGH PRIORITY)

Modify `enqueue-complete/route.ts` to accept and use reservation context:

```typescript
export async function POST(req: Request) {
  const formData = await req.formData();
  const queueResult = formData.get('QueueResult') as string;
  const callSid = formData.get('CallSid') as string;
  
  // Get params from URL (passed from workflow)
  const url = new URL(req.url);
  const reservationSid = url.searchParams.get('reservationSid');
  const taskSid = url.searchParams.get('taskSid');
  const workspaceSid = url.searchParams.get('workspaceSid');
  const workerSid = url.searchParams.get('workerSid');
  
  if (queueResult === 'hangup') {
    // 1. Cancel cell using cancel-cell logic (by workerSid)
    // 2. Reject reservation (if present)
    // 3. Hangup caller
  }
}
```

### Phase 2: Enhance twilio-status Cell Cleanup

Ensure all cell termination scenarios properly clean up:
- ✅ No-answer: Reject reservation (already done)
- ✅ Voicemail: Cancel cell (AMD already handles)
- ✅ Cell declined: Reject reservation (already done)
- ❓ Caller exits while cell ringing: Ensure cell is canceled

### Phase 3: Add Fallback Conference Cleanup

If a cell call ends up orphaned in a conference:
- Monitor conference for participants with no active call
- Auto-clean after timeout

## Files to Modify

1. **`app/api/taskrouter/enqueue-complete/route.ts`** (MUST FIX)
   - Add reservation context handling
   - Cancel active cell leg on hangup
   - Reject reservation on hangup

2. **`app/api/taskrouter/call-complete/route.ts`** (VERIFY)
   - Ensure it handles conference-end with cell properly
   - Log comprehensive participant state

3. **`app/api/twilio-status/route.ts`** (VERIFY)
   - Ensure reservation rejection is logging success/failure
   - Add conferenceName extraction from friendly name

4. **`app/api/taskrouter/assignment/route.ts`** (VERIFY)
   - Ensure all necessary params passed to callbacks
   - Confirm cellCallSid is populated before URL building

## Testing Checklist

- [ ] Caller hangs up while waiting → cell stops ringing immediately
- [ ] Caller hangs up while connected to cell → cell disconnects cleanly
- [ ] Agent declines on cell → caller goes to next agent (not voicemail)
- [ ] Agent times out on cell → caller goes to next agent (not voicemail)
- [ ] Cell voicemail detected → cell canceled, caller continues to next agent
- [ ] Agent answers on app → cell stops ringing
- [ ] Agent answers on cell → app stops ringing, caller bridges

## Key Insight

The core issue is that **`enqueue-complete` is not aware of simultaneous ring**. It only knows about the caller. But when simultaneous ring is active, the callback needs to:

1. Know which reservation/worker was active
2. Cancel the cell leg immediately
3. Reject the reservation (not complete it) so TaskRouter reassigns
4. Close the conference

Currently it just returns `<Hangup/>` blindly, leaving the cell leg and conference orphaned.
