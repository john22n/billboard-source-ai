# Nutshell webhook receiver

## Preview release baseline — November 20

Before the November 20 preview update, the protected preview ran commit `b8e7749` with **SSE off**, Cloud SQL dev, and a Sky-only recipient allowlist. Commit `3c1d80b` fixes cross-tab session invalidation and mixed-transport Clear; the approved update carries those fixes and the validation evidence below to `integration/lead-notifications`, preserving the existing preview configuration. The prior preview's authenticated smoke check was blocked by an authentication redirect: its configured database was verified, not runtime database connectivity. Successful live delivery measurements below used the earlier preview. Verify the new deployment's build and smoke results separately; no production release or merge into main is implied.

The original dev receiver records new-lead event IDs and their linked lead IDs in `nutshell_webhook_inbox`. On November 9, seven real Contact Us lead events were confirmed durable; the latest 50 observed requests returned 200 or 202. Read-only REST hydration resolved all seven initial-assignee emails and company names. Nutshell's earlier test-button requests returned 400; that test-payload difference does not prevent the observed real lead deliveries. Request-body compatibility beyond the observed events remains unverified.

The local implementation adds authoritative REST hydration, a durable processor, recipient-only notification APIs, an account-wide inbox, and opt-in desktop alerts. The required tables are already included in main's `0012_preserve_neon_dev_data.sql`, applied to Cloud SQL dev. Preserve that migration chain; do not replay the superseded branch migrations. Explicit configuration is still required before deployment; no shared database migration or new deployment is implied by local verification.

## Processor and notification behavior

- Only **Contact Us Page (`35-sources`)** and **Free Estimtes Form (`115-sources`)** leads created at or after the configured launch cutoff qualify. The integration identity defaults to Sky, but the notification recipient is the unique app account whose email matches the initial assignee case-insensitively.
- Creation/assignment history—not the current owner or webhook actor—establishes the initial assignee. Traverse older history with bounded validated cursors to a matching creation anchor. An ambiguous/missing original assignment, team assignment, unsafe URL, or incomplete history remains pending. The creation-anchor/original-assignment assumption passed read-only validation for seven real leads; this is not a vendor retention/completeness guarantee.
- For multiple linked companies, use the **first account in the lead's relationship order**, not response-array order. Use lead name when that company's name is blank or there are no linked accounts. A missing linked account object stays pending. This deterministic selection rule requires business validation for multi-company leads.
- Freeze the initial assignee before app-account lookup. A missing/ambiguous email match stays pending, so correction can deliver later without routing to a later owner. Non-production processing requires an explicit recipient email allowlist.
- Each lead ID identifies one notification. Clearing preserves a durable acknowledgment; duplicate events and retries cannot resurrect it. Sign-out changes session access only. Opening the canonical Nutshell link in a new tab does not clear it.
- Notifications appear directly as compact cards stacked in the upper-right of authenticated pages, oldest first, without a full-width banner, drawer, or persistent desktop-alert control. Long stacks scroll within the viewport. Elapsed time uses CRM creation time and includes nights/weekends. Urgency is green below one hour, yellow from one through exactly four hours, red above four hours, with text labels as well as color.
- Ordinary polling refreshes durable state every 15 seconds and on focus/reconnection. First snapshots, reconnect snapshots, and snapshots after a suspended tab are silent. Failed refreshes retain the last list with a warning. Clear failures retain the entry. Eligible opt-in SSE uses ten-second server snapshots and 240-second connection rotations instead; its lifecycle is documented below. The deployed preview still uses polling.
- A one-time dialog offers **Enable notifications** when browser permission is undecided. Its button invokes the native permission request from a user gesture. Allowing, blocking, or dismissing the prompt does not trigger repeated requests on refresh, sign-in, or other tabs; the answered marker is stored per browser/site, not per account. Existing granted permission enables alerts without another app opt-in; blocked permission must be changed in browser site settings. Web Locks and persisted notification IDs suppress repeat banners across tabs. Storage restrictions or lack of browser support do not disable in-app delivery. Separate browsers/devices may each alert. Chrome/macOS control presentation; automated browser mocks do not prove native banners.

## Configuration and retry scheduling

| Variable                                 | Purpose                                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `NUTSHELL_NOTIFICATIONS_ENABLED=true`    | Enable the inbox/APIs; default off                                                                                                        |
| `LEAD_NOTIFICATIONS_LAUNCH_CUTOFF`       | Absolute ISO timestamp with timezone; required for processing                                                                             |
| `NUTSHELL_API_KEY`                       | Server-only REST credential                                                                                                               |
| `NUTSHELL_INTEGRATION_EMAIL`             | Optional integration identity; defaults to `sky@billboardsource.com`                                                                      |
| `LEAD_NOTIFICATIONS_RECIPIENT_ALLOWLIST` | Comma-separated recipient emails (or `*` for all recipients); required outside production, honored in production if set                   |
| `LEAD_NOTIFICATIONS_SSE_ENABLED=true`    | Opt into SSE only in `VERCEL_ENV=preview`, with notifications enabled and an explicitly allowlisted recipient; absent/false keeps polling |
| `CRON_SECRET`                            | Bearer credential for the retry endpoint                                                                                                  |

The webhook schedules processing with Next.js `after()` only after durable intake and only when processing is enabled. Each invocation handles at most ten due rows in a 20-second budget, with atomic 60-second leases. Retry delay grows from 15 seconds to 15 minutes; reason codes and attempt counts are retained without raw payload logging.

`GET /api/cron/process-lead-notifications` requires `Authorization: Bearer <CRON_SECRET>`. `vercel.json` prepares a once-per-minute production cron, requiring a Vercel plan supporting that frequency. **Vercel does not run this cron on Preview**: dev validation needs separately authorized invocations/scheduling. No persistent daemon runs inside a Function.

This retry loop only recovers events already in the inbox. **Missed-webhook reconciliation is not implemented.** The one-minute retry schedule plus browser polling does not guarantee the 60-second assignment-to-display target, particularly for delayed assignment or throttled background tabs. End-to-end notification delivery, recovery scheduling, measured latency, native Chrome/macOS presentation, and the vendor delivery/retention contract remain release gates. Production stays disabled until those gates are resolved.

## Authentication and request handling

- Set `NUTSHELL_WEBHOOK_SECRET` to a cryptographically random secret of at least 32 characters in the destination Vercel environment. Use a distinct secret for dev and production; generate securely rather than using a human password.
- Configure the callback as `https://<deployment-domain>/api/webhooks/nutshell?token=<URL-encoded-secret>`. This is a shape, not a live URL.
- The URL token is a bearer credential, **not a Nutshell signature**. Anyone with it can submit signals. Keep the complete URL private, restrict access to Nutshell settings, and rotate the secret if exposed.
- The handler does not log tokens, URLs, payloads, or database errors. Platform access logs, proxies, request tracing, and local framework access logs may capture URLs independently. Verify redaction/access controls before activation; do not paste the real callback URL into issues, chats, or screenshots.
- Missing/short server secret returns 503. Missing, incorrect, or repeated token parameters return 401. Authentication happens before body processing or database access.
- JSON bodies are limited to 1 MiB, 1,000 events, and 1,000 total relevant lead references. Malformed input returns 400; excessive body/reference size returns 413. Establish that these limits fit actual Nutshell deliveries before activation. Automatic vendor splitting/retries are not assumed.
- Only `payloadType: leads` / `action: create` events enter this inbox. Other well-formed events return 200 with `accepted: 0`. All candidate source types are queued because callback fields are untrusted; **only the processor may decide notification eligibility**.
- Validate numeric Nutshell event/lead IDs. Read all linked lead IDs; do not join embedded objects by position or follow callback-provided URLs.
- Insert the entire valid batch atomically, deduplicating by event ID plus lead ID. Return 202 only after persistence; `accepted` counts newly inserted items. Replays cannot reset processed state. Database failure returns 503 rather than falsely acknowledging delivery. Nutshell retry guarantees still require verification; 503 alone does not guarantee redelivery.
- No app sign-in cookie is required. A session-based proxy or deployment login wall must not intercept the callback. Public network access must retain receiver authentication; do not disable protection for the entire app just to expose this endpoint.

## Local verification

Run `pnpm exec playwright test nutshell-webhook --workers=1` for real HTTP requests through Next.js against the existing disposable local PostgreSQL test setup. That setup applies the inbox SQL migration to the temporary database and destroys the database/server after testing. Live environment credentials are stripped. Run `pnpm exec vitest run app/api/webhooks/nutshell/route.test.ts lib/config-core.test.ts` for missing-secret and configuration checks.

Tests cover invalid credentials, malformed/oversized bodies, unrelated events, multiple linked IDs, misleading embedded data, replay, concurrent deliveries, processed-state preservation, no partial batch writes, and database failure. `pnpm exec playwright test lead-notifications --workers=1` additionally exercises the real processor and local database through authenticated APIs and the UI, using controlled REST responses. It covers delayed assignment, unmatched-account correction, recipient isolation, company fallback, concurrent processing, persistence, Clear replay, urgency boundaries, denied permissions, disconnects, and cross-tab desktop suppression. They do not establish real Nutshell delivery, OS alerts, or webhook source authenticity beyond the bearer token.

## Dev deployment checklist — requires approval

1. Confirm the intended Vercel project/environment and stable dev hostname. Verify its database points to dev, not production. The local dev/prod files currently share Nutshell credentials; database separation is not CRM isolation.
2. Verify the destination's migration history against `docs/cloud-sql-dev-migrations.md`. Cloud SQL dev already has the required tables through `0012_preserve_neon_dev_data.sql`; do not reapply superseded branch migrations. Any pending migration on another destination requires separate review and approval; do not run a broad schema push.
3. Set a new server-side webhook secret in the dev Vercel environment. Configure the processor's test-recipient restrictions before real event delivery is enabled.
4. Deploy the approved branch to dev/preview, without promoting production. Check Vercel deployment protection separately: Nutshell cannot complete an interactive Vercel login. Choose a supported scoped bypass/exception only with approval and verify externally.
5. Verify missing/incorrect secrets fail, a controlled valid event is durably recorded, replay is idempotent, and no secret appears in accessible logs. Test real vendor POST compatibility before declaring this callback operational.
6. Only after processing/recovery and recipient safeguards are ready, enter the real URL in Nutshell Setup → API keys, then activate with approval. A 202 currently means inbox storage, **not notification delivery**.

Production migration, deployment, secrets, webhook activation, and rollout validation need separate approval. To stop intake, deactivate the Nutshell subscription and/or unset the receiver secret; preserve inbox state for recovery. Do not drop the table as a routine rollback.

## Release evidence and remaining gates — November 18–19, 2026

The integration branch is deployed to a protected Vercel Preview against Cloud SQL dev. Main was not changed. The Sky-only test replayed a real creation event through the receiver, fetched real Nutshell assignment evidence, and displayed one notification in 15,900 ms from replay start. Opening, refresh, duplicate delivery, Clear, and a renewed session passed; checksums of 126 unrelated inbox rows and eight unrelated notification rows were unchanged. The synthetic CRM lead was deleted afterward. This measures receiver-to-UI delivery, **not automatic vendor delivery or assignment-to-display latency**.

On November 19, a separately approved temporary callback delivered Contact Us test lead `97006-leads`, initially assigned to Sky, without any manual webhook replay. The preview displayed one notification 14,776 ms after the CRM creation request and approximately 15,072 ms after Nutshell's second-resolution initial-assignment timestamp. Refresh preserved it; Clear remained effective after refresh. This is one successful foreground sample, not a percentile or sustained-background guarantee. An earlier test lead was created before callback registration completed, timed out without a card, and was deleted; it is excluded from the successful measurement.

Both synthetic leads were deleted. Temporary callback `2120` was removed, and the dedicated Vercel automation-bypass credential was revoked. A fresh settings reload confirmed that both original subscription names, URLs, and active states were unchanged. Requests using the revoked credential returned Vercel's authentication redirect. The existing default bypass credential was preserved. No production deployment, migration, global retry sweep, or main merge ran.

Deployment-scoped share links returned HTTP 307, which Nutshell's ping rejected. The approved temporary automation bypass supported stateless POSTs without that redirect; its credential was project-wide, so it was used only for the test preview and revoked afterward. Do not reuse the deleted callback configuration or assume a share link works for webhook delivery.

Separate disposable-local-database tests on real Chrome/macOS captured native banners with the app foregrounded and in a freshly backgrounded tab. The background test verified `document.visibilityState === 'hidden'` without Playwright's focus emulation. These tests establish native presentation in those states, not a sustained-background timing guarantee. An earlier longer-hidden trial did not observe a banner within its 60-second observation window. Browser scheduling and the silent-recovery behavior still require validation together.

### Sustained-background failure reproduced

A subsequent investigation used standalone, headed Chrome 158.0.8127.36 on Linux with ordinary timer settings, the real app, and disposable PostgreSQL. Playwright prepared the session and then disconnected; no browser commands ran during the hidden observation window. Permission remained granted. The app stayed hidden for over six minutes before the measured arrival. This measures database-to-browser behavior, not Nutshell ingestion or native macOS presentation.

| Case                         | Lead fetched after insertion | Desktop notification requested |
| ---------------------------- | ---------------------------- | ------------------------------ |
| Foreground control           | 14,972 ms                    | Yes, at 14,985 ms              |
| Fresh-background control     | 4,925 ms                     | Yes, at 4,930 ms               |
| Sustained-background arrival | 38,876 ms                    | No                             |

All observed inbox responses were HTTP 200, with no fetch errors, offline, freeze, or resume events. Poll intervals reached 60,003 ms; the interval containing the sustained arrival was 59,997 ms. The persistent card remained visible after returning to the app.

`components/lead-notifications.tsx` only requests desktop alerts when the gap since the previous successful snapshot is **strictly less than 45 seconds**. A throttled successful poll therefore takes the silent-recovery path, and its IDs become known without an alert. A controlled-clock browser check against the real API/database confirmed that 44,999 ms alerts, while exactly 45,000 ms and 60,000 ms do not. Those suppressed IDs were not claimed by desktop deduplication; a subsequent arrival after a 15-second gap alerted normally. This smaller check stubbed the native notification object to isolate the application decision, rather than claiming OS delivery.

The sustained-background gate is a **confirmed failure**, not merely unverified timing. [Chrome documents minute-level timer batching](https://developer.chrome.com/blog/timer-throttling-in-chrome-88/) and [suspension of timers/fetch callbacks in frozen pages](https://developer.chrome.com/docs/web-platform/page-lifecycle-api). The historical timer article explains the mechanism; its rollout thresholds are not assumed to be identical in current Chrome. Do not fix this by raising the cutoff and declaring the 60-second target met. Distinguishing ordinary throttling from actual recovery can improve best-effort polling, but a stronger background delivery target needs a separately designed timer-independent notification path and validation of frozen tabs. Any design must preserve silent backlog recovery and the exclusion of fully closed-app alerts. No application behavior was changed in this investigation; macOS sustained-background validation remains open.

Detailed sanitized evidence: [Sky notification validation](https://ampcode.com/artifacts/sky-notification-validation-c0bfbf86-4bdc-42c4-9558-317d65ebc370).

Release remains blocked on the following:

| Gate                          | Required resolution                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live latency coverage         | Automatic vendor delivery passed for one initially assigned Sky lead. Still measure delayed assignment, retries, and sustained background delivery before asserting the 60-second target generally. Temporary callback and bypass cleanup are complete.                                      |
| Missed-webhook recovery       | Implement durable discovery in addition to inbox retry. Establish a trustworthy enumeration/history contract before claiming complete recovery; verify deliberately omitted delivery and restart/checkpoint cases. Do not run a broad shared backlog sweep under the Sky-only test approval. |
| Vendor guarantees             | Obtain authoritative numerical REST quotas/429 handling, webhook authentication/retry/order behavior, history retention/completeness, and visibility bounds. Unknown guarantees remain unknown; a successful sample does not establish them.                                                 |
| Initial team assignment       | Confirm whether the first individual assigned after team routing is eligible and obtain an authoritative event sequence. Never substitute current owner when initial history is missing.                                                                                                     |
| Multiple companies            | Confirm the business-primary company rule. The current first-linked-account selection is deterministic but not documented as primary.                                                                                                                                                        |
| Sustained background delivery | Polling retains the confirmed 45-second-gate failure. Local SSE native popup presentation passed after 13 minutes 57 seconds hidden and three rotations on macOS; deployed platform behavior remains unproven. Do not silently relax the target.                                             |

The [lead API reference](https://developers.nutshell.com/reference/132e65861bebcb3781c3d37e66aff309.md) documents zero-based pages, but its sort enum omits `createdTime`, `id`, and `number`. Do not invent stable keyset pagination. [Filters](https://developers.nutshell.com/docs/filters.md) support creation windows and source IDs; overlap and repeated scans can improve discovery but cannot prove completeness without a visibility/enumeration contract. The [list-item endpoint](https://developers.nutshell.com/reference/3b3fb3c15cb2f6f9bd67ecae3cb0baa9.md) exposes an unexplained `primaryAccount` string, which does not establish the meaning of the first account relationship. [Assignment documentation](https://support.nutshell.com/en/articles/8429051-sales-automation-automate-lead-assignment) distinguishes team assignment from round-robin distribution.

### Rollout and rollback controls

Keep production disabled while these gates remain open. A future rollout must record the approved deployment, database, launch cutoff, recipient scope, callback configuration, and retry scheduler before activation. Verify pending reasons and retry ages as well as visible notifications; Preview has no automatic Vercel cron.

To stop processing and notification access, disable `NUTSHELL_NOTIFICATIONS_ENABLED` in the affected deployment and redeploy with approval. This does not revoke webhook intake: deactivate the relevant subscription or remove its receiver secret separately if intake must stop. Preserve inbox rows, frozen assignment data, and cleared acknowledgments. Do not drop tables, reset the launch cutoff, or clear deduplication state as rollback steps. Re-enabling processing may deliver queued records, so review the allowlist and backlog before restart. Every shared configuration change, scheduler activation, or production deployment requires its own authorization.

## SSE transport and operational checks

The authenticated inbox chooses `transport: sse | polling`; a browser query parameter is not preview authorization. `/api/lead-notifications/stream` verifies session and recipient eligibility before opening and at each snapshot. Production is ineligible even when the SSE flag is true. The local test exception requires development mode, `PLAYWRIGHT_TEST=1`, no Vercel deployment environment, an allowlisted fixture account, and `leadSsePrototype=true`. Never set the local fixture flag in Vercel.

Only fresh, contiguous live frames may request desktop alerts. Initial load, rotation, reconnect, offline recovery, thaw, and transport changes establish silent baselines. HTTP fallback is silent. Missing/withdrawn SSE capability returns to ordinary polling. Frozen pages cannot execute alerts, and arrivals inside a connection gap may appear as cards without a banner. No worker, Web Push, or closed-app alert mechanism exists.

Clear acknowledgment state and broadcasts belong to the page, not its current transport. Both polling and SSE desktop-alert executors consult that state inside their Web Lock. App sign-in/sign-out broadcasts stop old-page streams, pending HTTP requests and queued alerts, and clear private cards. Invalidated pages require reload to resume. Focus revalidates the current cookie-backed session. This is not server-side JWT revocation: an existing stream retains its original token, and cross-tab immediacy depends on browser messaging availability and page execution.

Before any approved preview activation:

1. Record the exact branch/commit/deployment, dev database identity, allowlist and disabled SSE flag. Verify authenticated inbox polling, signed-out rejection, and another account's read/Clear denial on that deployment.
2. Deploy with SSE off first. Enable SSE only through approved branch-scoped configuration and a new deployment; confirm Sky receives SSE capability and other accounts do not. Retain deployment protection.
3. Measure actual public-preview frame arrival and at least three rotations, one and two tabs, hidden delivery, disconnect cleanup, session invalidation, Clear races, silent recovery and capability withdrawal. Observe function duration/invocations and database query/connection usage; local query counts do not prove Cloud SQL capacity or Vercel buffering behavior.
4. Treat another vendor callback/bypass and synthetic CRM writes as separate approvals. Verify callback registration before creating leads, preserve existing subscriptions, and remove/revoke temporary access afterward. Do not run the global retry backlog under a scoped lead-test approval.

For transport rollback, close old test pages and return to the previous protected deployment or redeploy with SSE disabled. Confirm the replacement advertises polling and loads a silent baseline. Environment changes do not change an older immutable deployment or instantly terminate its open streams. Keep old deployments protected. Do not delete notifications, acknowledgments or webhook inbox state to roll back transport.

## Acceptance audit — November 20

This maps the current implementation/evidence to tickets, rather than checking off whole tickets from aggregate test counts. Latest local regression runs passed 35 Playwright tests and 445 Vitest tests (eight skipped), typecheck, targeted ESLint, Fallow, formatting and normal commit hooks; Shadscan was 88/100. These tests use sanitized local fixtures, not production credentials.

| Ticket / contract                 | Available evidence                                                                                                                                                               | Remaining acceptance gap                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #163 integration contract         | Approved Contact Us source, real initial-assignment hydration, Sky email mapping, automatic vendor delivery sample                                                               | Team routing, history completeness, multi-company primary rule, quotas/retries and enumeration guarantees remain unverified                                                                                  |
| #164 durable recipient-only inbox | Real preview hydration/persistence, read/Clear isolation in local HTTP tests, replay/sign-out persistence, canonical navigation without Clear, urgency boundary tests            | Full release still depends on #163/#165; the ticket's bell/count/panel wording differs from the current stacked-card/one-time-dialog UI and must be reconciled with the approved UI direction before closing |
| #165 recovery                     | Pending-assignment/mismatch fixtures, immutable initial-recipient behavior, durable Clear/replay, silent offline/freeze/reopen evidence, mixed polling/SSE Clear race regression | No discovery of webhooks that never arrived; cross-tab broadcast evidence is not a guarantee of immediate cross-device synchronization                                                                       |
| #166 desktop alerts               | Permission/onboarding tests, deduplication, queued-alert invalidation, local hidden SSE and native presentation evidence                                                         | Universal background/60-second guarantee is not established; platform presentation/click-through evidence must be recorded separately from mocked Notification calls                                         |
| #167 release readiness            | Controlled dev tests and access cleanup, exact deployment/configuration record, rollout/rollback procedure                                                                       | Latest fixes are local only; deployed authenticated smoke/SSE/platform-load checks and vendor recovery gates remain open                                                                                     |

Do not silently reinterpret the approved UI specification or the 60-second requirement. Record an explicit product decision where the current card-based UI supersedes the older ticket text. No feature implementation is authorized by this audit alone.

## Questions needed to unblock the vendor contract

Prepare these for Nutshell support/the account owner; this document does not send them or authorize tenant changes. Request documentation or sanitized representative payloads, not customer exports or credentials.

1. What numerical REST limits apply to this integration, at what scope, and what 429/retry headers and backoff policy are supported?
2. What authenticates outgoing webhook requests? What are the retry schedule, maximum retry age, duplicate/order semantics, payload limits, and behavior for 202, 400, 429 and 503 responses?
3. For lead history, what is retained, for how long, and can initial assignment be absent or late-visible? Which cursor direction and end condition establish complete history back to creation?
4. Which event sequence represents initial team routing followed by individual assignment, including replacement links? Product owner: should the first individual after team routing be the recipient?
5. Can all post-launch leads be enumerated without omissions under concurrent creation/deletion/updates? Is a stable snapshot/cursor or retained change feed available, and what is the maximum visibility lag? Zero-based offset pages alone are insufficient.
6. Which REST field is the supported business-primary company, and is relationship order guaranteed? Product owner: confirm the intended fallback when multiple companies exist or the primary name is blank.
7. Does the chosen integration identity see all eligible representatives' leads and complete assignment histories? How do permission changes affect discovery and callbacks?

Bounded creation-window scanning with durable checkpoints and overlap can be designed/tested locally, but is not an exhaustive-recovery guarantee without these answers. Do not implement a guessed stable keyset or substitute current ownership for missing initial assignment.

## Local gate measurements — November 20

Tested unchanged application commit `3c1d80b` with synthetic fixtures and disposable PostgreSQL. No shared database, CRM, preview deployment, or production settings were used. The only tracked change from this validation is this runbook, retaining its earlier uncommitted evidence.

### Native Mac validation is partial, not a popup pass

Chrome 156.0.8078.80 on a disposable macOS 27.2 satellite used the real local Next application through a forwarded port. Browser automation established the fixture session and then detached; Chrome had ordinary timer flags. A forwarding subclass called the real native Notification constructor and recorded browser events. No page-driving commands ran between the hidden-state check and the post-measurement inspection; OS settings/capture commands did not foreground the app tab.

The app remained hidden from 16:07:28.608 UTC through the sustained insertion at 16:18:03.000 UTC (634.392 seconds), with two stream rotations. The fresh-background insertion requested an alert after 743 ms; the sustained insertion requested one after **1,416 ms** and emitted the browser's native `show` event after 1,417 ms. These cross-machine local timestamps are individual observations, not vendor latency, percentiles or guaranteed popup timing.

The sustained notification was visibly present when macOS Notification Center history was opened. **The inspected 45-second recording covering the sustained arrival showed no automatic popup banner.** OS notification permission/Desktop delivery and notification display during screen sharing were enabled on the disposable Mac; the reason automatic presentation remained absent was not established. A `show` event alone is not evidence of a visible popup. Earlier foreground/fresh-background native evidence remains historical; this run does not prove that those banners still display under every OS setting.

Native Notification Center click-through passed on synthetic destinations `nativeClick=99206` and `nativeClick=99209`: clicking the stored OS notification opened its matching new browser tab. Both database records remained uncleared. The final inspected recording shows the menu-bar action, pointer movement, native notification click, and destination navigation. This proves native history-item click-through, not automatic popup interaction or live Nutshell navigation.

Setup failures are excluded: initial Turbopack reloads prevented a stable probe; the local harness switched to webpack and waited for a baseline. Browser permission and the Mac's initially disabled notification service/settings required setup. Early captures missed clicks or started recording after a popup was gone; an attempted control during rotation lost its notification. The final click proof starts recording before opening history. No application implementation was changed to make these probes pass.

Scratch evidence: `.amp/in/orb-backup/native-captures/result.json` retains the detached hidden-run events; `native-seeds.jsonl` holds local insert timestamps; `native-captures/native-harness.tgz` retains Mac scripts. The inspected click clip is `.amp/in/artifacts/native-notification-click.mp4`. At that point automatic popup presentation remained an open local/platform validation gate; the follow-up below isolates a capture-policy cause.

### Popup suppression follow-up — local capture policy

A fresh disposable Mac running the same Chrome/macOS versions reproduced automatic native banners from the unchanged local app with its tab hidden. The notification service and both Chrome notification entries were enabled. No shared services or deployment configuration were changed.

`node ~/native-validation/popup.mjs watch <label>` sampled native Notification Center accessibility windows and screenshots twenty times without opening notification history. Exact title matching distinguishes a new banner from an older banner still onscreen. A direct native `Notification` control bypassed the app's delivery lifecycle. Completed ffmpeg AVFoundation recordings established that capture was actually running for the paired comparisons:

| Source                                       | Video capture | Notifications while mirroring/sharing | New automatic banner                          |
| -------------------------------------------- | ------------- | ------------------------------------- | --------------------------------------------- |
| Actual app (`app-baseline`)                  | Off           | Notifications Off                     | Yes                                           |
| Actual app (`app-recorded`)                  | On            | Notifications Off                     | No; constructor and native `show` still fired |
| Direct native control (`control-recorded`)   | On            | Notifications Off                     | No                                            |
| Direct native control (`control-unrecorded`) | Off           | Notifications Off                     | Yes                                           |
| Direct native control (`control-allowed`)    | On            | Allow Notifications                   | Yes                                           |
| Actual app (`app-allowed`)                   | On            | Allow Notifications                   | Yes                                           |

The inspected `app-allowed.mp4` shows the new app banner appearing automatically at about 15 seconds, remaining through 19 seconds, over the active blank tab without opening history. The suppressed recording still contains the older `app-baseline` banner, not the newly requested `app-recorded` banner. Thus browser `show` is still not a popup assertion.

These comparisons identify macOS screen-capture notification policy as a cause of the reproduced suppression, independent of app lifecycle. They do not retrospectively establish the exact settings on the previous satellite, prove every platform, or upgrade the earlier sustained-hidden measurement into a guaranteed visible-popup latency result. The setting was read back as Allow Notifications after the menu transition; an immediate read during the animation returned the old value. Future validation must wait and confirm the selected value.

After restoring Notifications Off, two attempted reverse controls had ffmpeg stall before producing frames. Their popup verdicts are excluded from the capture comparison, despite one initially looking like a successful suppression reproduction. Another unrecorded app notification appeared normally. No application fix or mocked browser regression test is warranted for this OS policy: use this native comparison as the manual/platform regression procedure. Respect the user's OS suppression choices; do not bypass them or introduce closed-app alerts. Silent recovery and deployed SSE-off behavior remain unchanged.

Evidence: `.amp/in/orb-backup/popup-diagnosis/popup-diagnosis.tgz` retains the harness, title-matched samples and screenshots; `.amp/in/artifacts/popup-diagnosis/app-allowed.mp4` is the inspected successful recording. All data is synthetic and local. This closes the reproduced popup-suppression diagnosis, not the outstanding deployed transport, vendor recovery or universal background-delivery gates.

### Sustained native popup validation — passed locally

A subsequent fresh macOS 27.2 / Chrome 156.0.8078.80 run tested unchanged application commit `3c1d80b`, using disposable PostgreSQL and the local-only SSE opt-in. Before measurement, screenshots confirmed both Chrome notification entries enabled and sharing set to Allow Notifications; a fresh app notification produced a visible native banner. The initial setup probe with one Chrome entry still disabled is excluded.

Playwright established the synthetic session and detached. Chrome used ordinary timer flags. The forwarding Notification/EventSource subclasses logged real native calls and frames without substituting delivery. No browser-driving commands or page evaluations occurred during the sustained waiting interval; recording and native-window sampling did not foreground the app. The same document remained hidden, with no intervening visibility change, focus, navigation, freeze or resume event.

| Measurement                                                  | Observed result                         |
| ------------------------------------------------------------ | --------------------------------------- |
| Hidden before insertion                                      | 837.456 seconds (13 minutes 57 seconds) |
| Completed rotations before insertion                         | 3                                       |
| Native alert request after insertion                         | 1,367 ms                                |
| First title-matched native window sample after insertion     | 1,881 ms                                |
| Alert requests for the sustained lead                        | Exactly 1                               |
| Replay requests for earlier leads across rotations/reconnect | 0                                       |

The native-window assertion returned `PASS`. The inspected 65-second recording shows “AMP MAC TEST — sustained-native” automatically appearing around 00:11 and remaining through 00:24 over active `about:blank`; the app tab stays inactive and Notification Center is never opened. This is visible automatic presentation, not merely a browser `show` event or history entry. Sampling is approximate and cross-machine timestamp deltas are observations, not a latency guarantee.

One stream-open error followed the third rotation. The next connection established a silent baseline containing the earlier leads, followed by live frames and the new sustained lead. No older notification was requested again. This records recovery in this run, not a guarantee of delivery for arrivals during connection gaps. No closed-app delivery mechanism was introduced or newly claimed tested.

Evidence: `.amp/in/orb-backup/sustained-native/sustained-evidence.tgz` contains the harness, unchanged-document/visibility log, frame/rotation log, measurements, native-window samples and settings screenshot. The inspected recording is `.amp/in/artifacts/sustained-native/sustained-native.mp4`. This completes the local sustained-hidden native-popup case on this Mac/Chrome combination. Deployed SSE transport, capacity, vendor recovery and other platforms remain separate gates. No shared data, deployment, push or main merge was performed; the app, disposable database and satellite were stopped after validation.

### Connection sampling stops after abort

`node .amp/in/orb-backup/sse-capacity.mjs` used the real authenticated stream route and disposable PostgreSQL statement logging, after closing all browser pages. Each measurement excludes connection startup:

| Observation  | Duration       | Inbox SELECTs | Account SELECTs |
| ------------ | -------------- | ------------- | --------------- |
| No streams   | 12.005 seconds | 0             | 0               |
| One stream   | 30.001 seconds | 3             | 3               |
| Two streams  | 30.001 seconds | 6             | 6               |
| Both aborted | 22.021 seconds | 0             | 0               |

The script asserted the inbox counts and returned `PASS: sampling scales with open connections and stops after abort`. This measures local database work and disconnect cleanup, not Vercel function cancellation, Cloud SQL connection capacity, memory consumption or production cost. Local statement logging was reset after the probe.
