# Nutshell webhook receiver

## Current delivery state

The original dev receiver records new-lead event IDs and their linked lead IDs in `nutshell_webhook_inbox`. On November 9, seven real Contact Us lead events were confirmed durable; the latest 50 observed requests returned 200 or 202. Read-only REST hydration resolved all seven initial-assignee emails and company names. Nutshell's earlier test-button requests returned 400; that test-payload difference does not prevent the observed real lead deliveries. Request-body compatibility beyond the observed events remains unverified.

The local implementation adds authoritative REST hydration, a durable processor, recipient-only notification APIs, an account-wide inbox, and opt-in desktop alerts. These additions require migration `0012_lead_notifications.sql` and explicit configuration before deployment; no shared database migration or new deployment is implied by local verification.

## Processor and notification behavior

- Only **Contact Us Page (`35-sources`)** leads created at or after the configured launch cutoff qualify. The integration identity defaults to Sky, but the notification recipient is the unique app account whose email matches the initial assignee case-insensitively.
- Creation/assignment history—not the current owner or webhook actor—establishes the initial assignee. Traverse older history with bounded validated cursors to a matching creation anchor. An ambiguous/missing original assignment, team assignment, unsafe URL, or incomplete history remains pending. The creation-anchor/original-assignment assumption passed read-only validation for seven real leads; this is not a vendor retention/completeness guarantee.
- For multiple linked companies, use the **first account in the lead's relationship order**, not response-array order. Use lead name when that company's name is blank or there are no linked accounts. A missing linked account object stays pending. This deterministic selection rule requires business validation for multi-company leads.
- Freeze the initial assignee before app-account lookup. A missing/ambiguous email match stays pending, so correction can deliver later without routing to a later owner. Non-production processing requires an explicit recipient email allowlist.
- Each lead ID identifies one notification. Clearing preserves a durable acknowledgment; duplicate events and retries cannot resurrect it. Sign-out changes session access only. Opening the canonical Nutshell link in a new tab does not clear it.
- Notifications appear directly as compact cards stacked in the upper-right of authenticated pages, oldest first, without a full-width banner, drawer, or persistent desktop-alert control. Long stacks scroll within the viewport. Elapsed time uses CRM creation time and includes nights/weekends. Urgency is green below one hour, yellow from one through exactly four hours, red above four hours, with text labels as well as color.
- Browsers refresh durable state every 15 seconds and on focus/reconnection. First snapshots, reconnect snapshots, and snapshots after a suspended tab are silent. Failed refreshes retain the last list with a warning. Clear failures retain the entry.
- A one-time dialog offers **Enable notifications** when browser permission is undecided. Its button invokes the native permission request from a user gesture. Allowing, blocking, or dismissing the prompt does not trigger repeated requests on refresh, sign-in, or other tabs; the answered marker is stored per browser/site, not per account. Existing granted permission enables alerts without another app opt-in; blocked permission must be changed in browser site settings. Web Locks and persisted notification IDs suppress repeat banners across tabs. Storage restrictions or lack of browser support do not disable in-app delivery. Separate browsers/devices may each alert. Chrome/macOS control presentation; automated browser mocks do not prove native banners.

## Configuration and retry scheduling

| Variable                                 | Purpose                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `NUTSHELL_NOTIFICATIONS_ENABLED=true`    | Enable the inbox/APIs; default off                                                          |
| `LEAD_NOTIFICATIONS_LAUNCH_CUTOFF`       | Absolute ISO timestamp with timezone; required for processing                               |
| `NUTSHELL_API_KEY`                       | Server-only REST credential                                                                 |
| `NUTSHELL_INTEGRATION_EMAIL`             | Optional integration identity; defaults to `sky@billboardsource.com`                        |
| `LEAD_NOTIFICATIONS_RECIPIENT_ALLOWLIST` | Comma-separated recipient emails; required outside production, honored in production if set |
| `CRON_SECRET`                            | Bearer credential for the retry endpoint                                                    |

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
2. Review and approve applying `drizzle/0011_nutshell_webhook_inbox.sql` to the dev database. Do not run a broad schema push or migrate unrelated changes implicitly.
3. Set a new server-side webhook secret in the dev Vercel environment. Configure the processor's test-recipient restrictions before real event delivery is enabled.
4. Deploy the approved branch to dev/preview, without promoting production. Check Vercel deployment protection separately: Nutshell cannot complete an interactive Vercel login. Choose a supported scoped bypass/exception only with approval and verify externally.
5. Verify missing/incorrect secrets fail, a controlled valid event is durably recorded, replay is idempotent, and no secret appears in accessible logs. Test real vendor POST compatibility before declaring this callback operational.
6. Only after processing/recovery and recipient safeguards are ready, enter the real URL in Nutshell Setup → API keys, then activate with approval. A 202 currently means inbox storage, **not notification delivery**.

Production migration, deployment, secrets, webhook activation, and rollout validation need separate approval. To stop intake, deactivate the Nutshell subscription and/or unset the receiver secret; preserve inbox state for recovery. Do not drop the table as a routine rollback.
