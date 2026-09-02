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
- audits dependencies for critical vulnerabilities; and
- publishes an SPDX SBOM.

Vercel's native Git integration owns deployments: pull requests receive preview deployments and pushes to `main` produce production deployments. GitHub Actions does not require Vercel credentials and does not build or deploy the application.

## Admin issue reporting

Signed-in employees can open **Report an Issue** from the dashboard sidebar. A report collects a bounded diagnostic window from Twilio and the current Vercel deployment, scopes provider records to the reporting employee's phone number, Twilio client identity, worker SID, and related Call SIDs, and redacts credentials while retaining operational email addresses and phone numbers. OpenAI returns only a reason for the issue, never a fix. When an employee asks for information about a Twilio call they had, the result includes only contact details and call records tied to that employee's account. The finding remains available when the employee navigates away and returns during the same browser session; logging out or moving the Twilio worker to Offline clears it. The event-driven Amp Orb is notified only when OpenAI requests engineering help or OpenAI triage is unavailable. Administrators can review and resolve retained reports from the Admin Panel.

Each employee account can save one issue every 16 hours. The database keeps at most the newest 100 reported issues and deletes any report older than 30 days. Cleanup runs after each saved report, during issue-list and resolution requests, and from the daily maintenance cron.

Configure these server-only environment variables:

```bash
OPENAI_API_KEY=
VERCEL_API_TOKEN=
AMP_ISSUE_WEBHOOK_URL=
```

`VERCEL_PROJECT_ID` and `VERCEL_DEPLOYMENT_ID` come from Vercel system environment variables; enable **Project Settings → Environment Variables → Enable access to System Environment Variables**. `VERCEL_TEAM_ID` is **not** a system variable: copy the team ID from **Team Settings → General** and add it manually next to `VERCEL_API_TOKEN`, which needs Runtime Logs access for that team. If the deployment ID is unavailable, logs are collected for the whole project instead of the current deployment. When any of these are missing, the report's diagnostic bundle names the missing variable in `vercel.warnings` and the admin panel lists Vercel as an unavailable source.

Load `.amp/plugins/issue-report-webhook.ts` in the Orb thread that should investigate escalated reports, then set its private durable webhook URL as `AMP_ISSUE_WEBHOOK_URL`. The URL is a credential: keep it server-only and never commit or print it. The sender uses each report ID as its idempotency key, and the plugin validates the versioned payload before waking its owning thread.

## Billboard market data

Vercel syncs billboard market pricing from the Market Intel API every Sunday at 11:00 PM Central. Configure these server-only environment variables in Vercel:

```bash
CRON_SECRET=
DIALOGS_API_KEY=
OPENAI_API_KEY=
```

The cron runs at both possible UTC equivalents and performs the sync only during the matching Central-time hour, so daylight saving time does not shift the local schedule.
