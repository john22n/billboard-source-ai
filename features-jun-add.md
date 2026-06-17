# June Feature Additions

## 1. Average Workday Hours

Update the Admin Dashboard User Accounts tab so the existing availability metric shows **Average Workday Hours** instead of a seven-day daily average.

Rules:

- Use the existing TaskRouter eligibility/status behavior.
- Keep the rolling availability lookback, but calculate the average over Monday-Friday workdays only.
- Use Central Time to decide whether a time window is a weekday.
- Exclude weekend availability hours from both the numerator and denominator because the company is closed on weekends.
- This change affects only the admin metric. It must not change call routing eligibility or business-hours routing behavior.

## 2. Call Attempt Totals

Add a compact User Accounts column labeled `Missed / Rejected / Accepted`.

Rules:

- Store production Call Attempt Outcomes in the application database going forward.
- Do not backfill historical attempts from Twilio.
- Do not record local, preview, staging, or simulated traffic in admin totals.
- Show totals for every user row, defaulting to `0 / 0 / 0`.
- Admin accounts can also take calls, so admin users must not be excluded from totals.
- Display the compact value in the exact order `Missed / Rejected / Accepted`, for example `4 / 1 / 23`.

Outcome definitions:

- `Accepted`: the Sales Rep actually connects with and takes the Caller.
- `Rejected`: the Sales Rep explicitly clicks Reject in Billboard Source AI. The browser click is enough to count it.
- `Missed`: the Call Attempt ends without the Sales Rep taking or explicitly rejecting the call, including caller hangup while that Sales Rep is being tried or cell-screening failure.

Counting rules:

- Count one final outcome per Call Attempt.
- Make duplicate callbacks idempotent.
- Store one row per Call Attempt with a unique Twilio reservation or attempt identifier.
- An initial offered/pending record may be finalized once.
- If `Rejected` is recorded from the browser click, later ambiguous Twilio outcomes must not overwrite it.
- If a conflicting final outcome appears later, log it as an error and do not change the count.
- Do not create missed totals for Sales Reps who were never offered the call under the existing routing logic.
- If the Overflow Number belongs to exactly one user account by exact Sales Rep Number match, count the terminal overflow attempt for that Sales Rep.
- If the Overflow Number matches no user account, do not count the overflow attempt.
- If the Overflow Number matches multiple user accounts, treat it as a configuration error and do not count the overflow attempt for anyone.
- Enforce Sales Rep Number ownership with a database uniqueness constraint after verifying existing data has no duplicates.

## 3. Routing Changes

Change inbound call routing so Sales Rep Call Attempts ring for 15 seconds instead of 20 seconds, and after two failed Sales Rep attempts the call routes to the configured Overflow Number instead of Billboard Source AI voicemail.

Rules:

- Keep the current TaskRouter queue and eligibility logic.
- Do not change Available, Unavailable, or Offline semantics.
- Use two distinct Sales Reps when available.
- Do not retry the same Sales Rep during the two-attempt phase.
- If fewer than two eligible distinct Sales Reps are available under the current routing logic, route to the Overflow Number after the available attempts are exhausted.
- Apply this behavior to both Company Routing Number calls and Sales Rep Number calls.
- For a Sales Rep Number call, try that Sales Rep first, then one other eligible Sales Rep second, then the Overflow Number.
- The Overflow Number is configured by environment variable, for example `TWILIO_OVERFLOW_NUMBER`.
- The Overflow Number is terminal and external to Billboard Source AI. The app must not route the caller to its voicemail flow after the overflow handoff.
- The app should not enforce a 15-second overflow ring window; the external cell phone destination owns final call handling.

References:

- `CONTEXT.md`
- `docs/adr/0001-store-call-attempt-outcomes-in-db.md`
- `docs/adr/0002-terminal-overflow-number-after-two-call-attempts.md`
