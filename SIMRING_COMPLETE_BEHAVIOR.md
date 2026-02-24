# Simultaneous Ring - Complete Behavior Matrix

## Overview

This document describes how simultaneous ring should work in all scenarios after the fixes. Cell and app should now behave identically in the round-robin queue.

---

## Scenario Matrix

### ✅ Scenario 1: Caller Dials In

**Flow:**
1. Caller dials main number → `twilio-inbound` enqueues into TaskRouter workflow
2. TaskRouter evaluates expression → assigns first available agent
3. TaskRouter fires assignment callback
4. Agent attributes checked:
   - If `simultaneous_ring=false` → normal conference flow
   - If `simultaneous_ring=true` → dials both app + cell simultaneously

**App behavior:**
- GPP2 (browser client) starts ringing
- Agent sees/hears ring notification

**Cell behavior:**
- Cell phone receives simultaneous call
- Cell phone rings (audible alert)
- AMD active (Answering Machine Detection) to reject voicemail

**Result:** Both ring at the same time ✅

---

### ✅ Scenario 2: Agent Answers on App

**Trigger:** Agent accepts on browser client

**Flow:**
1. TaskRouter conference fires `conference-start` event
2. `call-complete` callback receives event
3. Checks for `cellCallSid` in URL
4. Calls `cancelCellLeg(cellCallSid, 'conference-start')`
5. Cell call is fetched to determine status
   - If ringing → `status: 'canceled'`
   - If in-progress → `status: 'completed'`
6. Cell call terminated

**App behavior:**
- ✅ Agent connected to caller
- ✅ Audio streams both directions
- ✅ Call-complete logs "Someone answered the call"

**Cell behavior:**
- ✅ Stops ringing immediately
- ✅ No voicemail played
- ✅ Call dropped cleanly

**Result:** Caller hears agent on app only ✅

---

### ✅ Scenario 3: Agent Answers on Cell

**Trigger:** Agent answers physical cell phone

**Flow:**
1. Cell call status changes to `in-progress`
2. `twilio-status` callback fires with `CallStatus='in-progress'`
3. System knows cell was answered:
   - Redirects caller into conference: `startConferenceOnEnter='true'`
   - Completes TaskRouter task
   - Cancels all ringing/in-progress app calls

**App behavior:**
- ✅ App call stops ringing
- ✅ App disconnects cleanly (either with `status: 'canceled'` or `completed'`)

**Cell behavior:**
- ✅ Caller bridged into conference
- ✅ Audio streams both directions
- ✅ Call-complete logs "Caller redirected into conference"

**Result:** Caller hears agent on cell only ✅

---

### ✅ Scenario 4: Agent Declines on App

**Trigger:** Agent rejects assignment on app (or app disconnects)

**Flow:**
1. TaskRouter fires reservation rejection
2. App itself triggers cell cleanup via `cancel-cell` endpoint
3. Any ringing cell call is canceled
4. Reservation is rejected (TaskRouter reassigns)

**App behavior:**
- ✅ Agent sees "call rejected" or similar
- ✅ Agent returns to available status

**Cell behavior:**
- ✅ Cell call cancelled (if still ringing)
- ✅ No voicemail played

**Caller behavior:**
- ✅ Stays in queue
- ✅ Rings next available agent
- ✅ Does NOT go to voicemail

**Result:** Proper round-robin behavior ✅

---

### ✅ Scenario 5: Agent Declines/No-Answer on Cell

**Trigger:** Cell rings 20 seconds with no answer (timeout)

**Flow:**
1. Cell timeout expires (or agent explicitly declines on phone)
2. Twilio fires `twilio-status` callback with:
   - `CallStatus='no-answer'` OR
   - `CallStatus='completed'` with `CallDuration='0'`
3. System rejects the TaskRouter reservation
4. Cell call naturally ends (timeout)

**Cell behavior:**
- ✅ Stops ringing after timeout
- ✅ Call ends
- ✅ No voicemail played (AMD already rejected it)

**App behavior:**
- ✅ Stays ringing (unless timeout also hit)

**Caller behavior:**
- ✅ Stays in queue (not released to voicemail)
- ✅ Rings next available agent
- ✅ Eventually app might timeout (20s global TaskRouter timeout)

**Result:** Proper round-robin behavior ✅

---

### ✅ Scenario 6: Voicemail Detected on Cell

**Trigger:** AMD detects answering machine

**Flow:**
1. During cell ring, AMD callback fires
2. `AnsweredBy` is one of: `machine_start`, `machine_end_beep`, `machine_end_silence`
3. System cancels cell call immediately
4. No voicemail bridge occurs

**Cell behavior:**
- ✅ Call cancelled before voicemail can record
- ✅ Voicemail system disconnected

**App behavior:**
- ✅ Stays ringing

**Caller behavior:**
- ✅ Stays in queue
- ✅ Caller is NOT connected to voicemail
- ✅ Rings next available agent

**Result:** Proper round-robin behavior ✅

---

### ✅ Scenario 7: Caller Hangs Up While Waiting in Queue

**Trigger:** Caller hangs up before any agent answers

**Flow:**
1. Enqueue exits with `QueueResult='hangup'`
2. `enqueue-complete` callback fires
3. System looks for active reservation context:
   - First checks URL parameters
   - Falls back to conference lookup by caller SID
4. If simultaneous ring found:
   - Fetches worker attributes
   - Cancels active cell calls
   - Rejects the reservation

**App behavior:**
- ✅ App call ends (caller disconnected)
- ✅ No further ringing

**Cell behavior:**
- ✅ Cell call cancelled immediately
- ✅ No phantom ringing
- ✅ Conference cleaned up

**Reservation behavior:**
- ✅ Reservation rejected
- ✅ TaskRouter doesn't reassign
- ✅ Worker goes back to "available" (not assigned)

**Result:** Clean disconnect ✅

---

### ✅ Scenario 8: Caller Hangs Up While Connected to Agent (App)

**Trigger:** Active call, agent/caller in conference, caller hangs up

**Flow:**
1. Caller disconnects
2. Conference fires `customer_exit` or `end` event
3. `call-complete` callback handles cleanup
4. Cell call cancelled (if still there somehow)
5. Task completed
6. Conference ended

**App behavior:**
- ✅ Conference ends
- ✅ Task completed
- ✅ Agent returns to available

**Cell behavior:**
- ✅ If cell is in conference but not participating: exits when conference ends
- ✅ If cell answer was pending: cancels

**Result:** Clean disconnect ✅

---

### ✅ Scenario 9: Caller Hangs Up While Connected to Agent (Cell)

**Trigger:** Active call, agent/caller in conference, caller hangs up

**Flow:**
1. Caller disconnects from conference
2. Cell is in conference with `startConferenceOnEnter='false'`
3. Conference fires `customer_exit` event
4. Cell is left alone in conference
5. Either:
   - Cell hangs up (ends conference)
   - Conference timeout fires
6. `call-complete` cleans up any orphans

**Cell behavior:**
- ✅ Detects caller left (only one participant)
- ✅ Cell agent hangs up (natural behavior)
- ✅ Conference ends

**Result:** Clean disconnect ✅

---

### ✅ Scenario 10: Both Ring but Neither Answers

**Trigger:** 20-second TaskRouter timeout with no answer

**Flow:**
1. Both app and cell ring for 20 seconds
2. Neither answers
3. Twilio timeout fires on cell (configured)
4. Cell call ends naturally
5. TaskRouter timeout fires (20s)
6. TaskRouter rejects reservation
7. Caller released to voicemail or next workflow stage

**App behavior:**
- ✅ Stops ringing (TaskRouter timeout)
- ✅ Call remains in Enqueue

**Cell behavior:**
- ✅ Stops ringing (call timeout or AMD)
- ✅ No voicemail recorded (cancelled by AMD)

**Caller behavior:**
- ✅ Stays in queue
- ✅ Rings next available agent
- ✅ Eventually goes to voicemail if no agents available

**Result:** Proper round-robin, eventual voicemail ✅

---

## Key Implementation Details

### App Cleanup
- **Location:** Browser client (TwilioProvider) or `cancel-cell` endpoint
- **Trigger:** Rejection, hangup, or disconnect
- **Action:** Cancel any ringing calls to `contactUri` (client:email)

### Cell Cleanup  
- **Location:** `twilio-status` or `enqueue-complete` callbacks
- **Trigger:** Answer detected, no-answer timeout, voicemail, or caller hangup
- **Action:** Cancel calls to `cell_phone` number with appropriate status

### Reservation Handling
- **Rejection triggers:**
  - Cell no-answer timeout
  - Cell declined/busy
  - Caller hung up in queue
  - Agent explicitly declined
- **Result:** TaskRouter reassigns to next agent

### Conference Management
- **Created:** When assignment callback runs
- **Name:** `simring-{reservationSid}` for simring calls
- **Participants:** Caller + app/cell agent
- **Exits:**
  - App with `end_conference_on_exit: true` (ends conference)
  - Cell with `endConferenceOnExit: false` (doesn't end conference)
  - Caller disconnect causes participant-leave event

---

## Expected Logs for Each Scenario

### Scenario 2: Answer on App
```
📋 TASKROUTER ASSIGNMENT CALLBACK
📱 Simultaneous ring enabled

📞 CONFERENCE STATUS CALLBACK  
📱 conference-start event fired
🔍 Fetching cell call status...
📞 Cell call status: ringing
📤 Updating cell call to status: canceled
✅ Cell leg canceled (conference-start)
```

### Scenario 3: Answer on Cell
```
📊 Call status update: in-progress
✅ Caller redirected into conference
✅ Task completed
🔍 Looking for active app calls
✅ App call CA123... canceled
```

### Scenario 5: No-Answer on Cell
```
📊 Call status update: no-answer
📵 Cell declined/no-answer — rejecting reservation
✅ Reservation rejected — TaskRouter will ring next agent
```

### Scenario 7: Caller Hangup
```
📞 ENQUEUE COMPLETE
QueueResult: hangup
🔍 Looking up active conferences for caller
✅ Found reservation context from conference
📱 Worker has simultaneous ring enabled — canceling cell leg
✅ Cell call CA456... canceled
✅ Reservation rejected — TaskRouter will not reassign
```

---

## Summary Table

| Scenario | App | Cell | Caller | Result |
|----------|-----|------|--------|--------|
| Answers on app | ✅ Connected | ❌ Stopped | Hears app | ✅ |
| Answers on cell | ❌ Stopped | ✅ Connected | Hears cell | ✅ |
| Declines on app | ❌ Rejected | ❌ Cancelled | Queue | ✅ |
| No-answer on cell | ⏱️ Still ring | ❌ Timeout | Queue | ✅ |
| Voicemail detected | ⏱️ Still ring | ❌ Cancelled | Queue | ✅ |
| Caller hangup (queue) | Ends | ❌ Cancelled | Disconnect | ✅ |
| Caller hangup (call) | Ends | Ends | Disconnect | ✅ |
| Both no-answer | Timeout | Timeout | Voicemail | ✅ |

---

## Files That Work Together

1. **`assignment/route.ts`** - Dials both app + cell
2. **`call-complete/route.ts`** - Handles conference events (start, leave, end)
3. **`twilio-status/route.ts`** - Handles cell call state changes
4. **`enqueue-complete/route.ts`** - Handles caller hangup in queue
5. **`cancel-cell/route.ts`** - Allows app to cancel cell (called by browser)

All work together to ensure app and cell behavior stays synchronized and properly participates in round-robin queue.
