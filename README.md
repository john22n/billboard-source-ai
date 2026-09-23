# billboard-source-ai

website: https://www.billboardsource.com/index.html

The offical BillBoard Source Company AI application

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## CI/CD

The GitHub Actions workflow in `.github/workflows/ci-cd.yml`:

- lints, type-checks, and tests every pull request targeting `main`;
- runs the login and Creative Studio Playwright tests in a separate job, using Chromium and disposable local PostgreSQL;
- retains Playwright reports, failure screenshots, and retry traces for seven days;
- audits dependencies for critical vulnerabilities; and
- publishes an SPDX SBOM.

Vercel's native Git integration owns deployments: pull requests receive preview deployments and pushes to `main` produce production deployments. GitHub Actions does not require Vercel credentials and does not build or deploy the application.

## Admin voicemail AI logs

The **Voicemail AI** admin tab reads the last 21 days of Twilio call history.
Calls are included only when Twilio Call Events show a request to
`voicemail-agent.john22n-iii.com`; weekend timing alone is not proof of an AI call.
Use **Check older calls** to scan additional batches within the same date range.
Expand a call for Twilio notifications, recordings, and existing recording
transcripts. All three API endpoints require an admin session, and audio is
proxied with server-side Twilio credentials rather than exposing credentials
to the browser. No database migration or Twilio configuration change is needed.

Call Events may not appear until 15 minutes after a call ends. Missing provider
resources and bounded result limits appear as notices, not as proof that no
errors occurred. This feature does not enable recording/transcription, restore
deleted media, or retrieve AI transcripts stored only in Nutshell. The older
Twilio recording-transcription API is deprecated but can still return existing
transcripts. No new transcripts are generated or billed by this tab.

## Admin issue reporting

Signed-in employees can open **Report an Issue** from the dashboard sidebar. A report collects a bounded diagnostic window from Twilio and the current Vercel deployment, scopes provider records to the reporting employee's phone number, Twilio client identity, worker SID, and related Call SIDs, and redacts credentials while retaining operational email addresses and phone numbers. OpenAI returns only a reason for the issue, never a fix. When an employee asks for information about a Twilio call they had, the result includes only contact details and call records tied to that employee's account. The finding remains available when the employee navigates away and returns during the same browser session; logging out or moving the Twilio worker to Offline clears it. Every accepted report is posted as a new message in the configured Slack channel with the account-scoped diagnostic logs and an explicit Amp mention. Administrators can review and resolve retained reports from the Admin Panel.

Each employee account can save one issue every 16 hours. The database keeps at most the newest 100 reported issues and deletes any report older than 30 days. Cleanup runs after each saved report, during issue-list and resolution requests, and from the daily maintenance cron.

Configure these server-only environment variables:

```bash
OPENAI_API_KEY=
VERCEL_API_TOKEN=
VERCEL_TEAM_ID=
SLACK_USER_TOKEN=
SLACK_AMP_CHANNEL_ID=
SLACK_AMP_USER_ID=
```

`VERCEL_PROJECT_ID` and `VERCEL_DEPLOYMENT_ID` come from Vercel system environment variables; enable **Project Settings → Environment Variables → Enable access to System Environment Variables**. `VERCEL_TEAM_ID` is **not** a system variable: copy the team ID from **Team Settings → General** and add it manually next to `VERCEL_API_TOKEN`, which needs Runtime Logs access for that team. If the deployment ID is unavailable, logs are collected for the whole project instead of the current deployment. When any of these are missing, the report's diagnostic bundle names the missing variable in `vercel.warnings` and the admin panel lists Vercel as an unavailable source.

For Slack, add the `chat:write` **User Token Scope** to an internal Slack app, reinstall it as the Slack user linked to Amp, and use its user OAuth token for `SLACK_USER_TOKEN`. Add `@Amp` to the Slack channel that should receive issue reports, then use that channel's `C...` or `G...` ID for `SLACK_AMP_CHANNEL_ID`. This integration rejects direct-message `D...` IDs because Amp documents channel and thread mentions as its supported trigger. `SLACK_AMP_USER_ID` is the installed Amp app's `U...` member ID. Keep the token server-only and never commit or print it. Slack attributes each automated report to the user who authorized the token.

## Billboard market data

Vercel syncs billboard market pricing from the Market Intel API every Sunday at 11:00 PM Central. Configure these server-only environment variables in Vercel:

```bash
CRON_SECRET=
DIALOGS_API_KEY=
OPENAI_API_KEY=
```

The cron runs at both possible UTC equivalents and performs the sync only during the matching Central-time hour, so daylight saving time does not shift the local schedule.

## Weekend voicemail AI recordings and transcripts

Saturday/Sunday calls routed through this app from 6 AM inclusive to 10 PM exclusive in `America/Chicago` hear a recording/transcription notice, start a dual-channel Twilio recording, and redirect to the AI agent. The recording continues through the AI conversation. Calls sent directly to the agent's hostname bypass this routing and recording setup.

Before deploying, create a Twilio Conversation Intelligence (classic) Service in the same account as `TWILIO_ACCOUNT_SID`, with unique name `weekend-voicemail-ai`, language `en-US`, **AutoTranscribe disabled**, and **DataLogging disabled**. The callback resolves this unique name; no additional Vercel environment variable is needed. Do not enable account-wide automatic transcription, which would transcribe ordinary sales calls too.

Twilio posts completed recordings to the signature-validated `/api/twilio/voicemail-ai-recording` endpoint. It verifies recording ownership and requests an Intelligence transcript using the Recording SID, with the Call SID as its customer key. Callback retries do not create additional transcripts. Connection/read failures and 5xx responses have bounded Twilio retries; persistent failures appear in Vercel logs as `Voicemail AI transcription request failed`. After resolving the cause, replay the recording callback using Twilio's signed webhook mechanism or request the transcript for that Recording SID through the Intelligence API.

The admin Voicemail AI tab shows recording audio, legacy Twilio transcripts, and Intelligence transcript text/status for the existing rolling 21-day call window. Refresh after transcription completes; Call Events may take 15 minutes to appear. A 21-day display window is not a Twilio deletion policy. Recording/storage/transcription charges apply, and old unrecorded calls cannot be recovered. Verify the spoken notice meets the business's recording-consent requirements before release.

## Playwright browser tests

Install PostgreSQL locally and put `initdb` and `pg_ctl` on your `PATH` (for Homebrew PostgreSQL 17: `export PATH="$(brew --prefix postgresql@17)/bin:$PATH"`). Run as a regular user, not root. Ports 3000 and 54329 must be free.

```bash
pnpm exec playwright install chromium
pnpm test:e2e
# Creative Studio only:
pnpm exec playwright test creative-studio.spec.ts
```

Playwright starts an isolated Next.js server and a temporary PostgreSQL cluster containing only a test user. Both stop after the run, and the database files are removed. Shell and `.env` service credentials are cleared for the app; the suite does not use the dev or production database.

The Creative Studio test opens the actual dashboard with a signed test session and exercises all seven intake answers, editable approval, website palette propagation, generation, download, failed revision/retry, refresh persistence, and reset. AI and telephony HTTP responses are mocked, so it verifies the browser workflow and request contracts—not live model quality or website extraction. Existing API/unit tests cover those server-side contracts. The tiny JPEG fixtures are synthetic, not customer artwork.
