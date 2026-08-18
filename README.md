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

Signed-in administrators can open **Report an Issue** from the dashboard sidebar. A report collects a bounded diagnostic window from Twilio and the current Vercel deployment, redacts credentials and customer contact details, asks an OpenAI model for initial triage through the direct OpenAI API, and posts the sanitized package as the configured Slack user in that user's existing Amp conversation.

Configure these server-only environment variables:

```bash
OPENAI_API_KEY=
VERCEL_API_TOKEN=
SLACK_USER_TOKEN=
SLACK_AMP_CHANNEL_ID=
SLACK_AMP_USER_ID=
```

`VERCEL_PROJECT_ID`, `VERCEL_DEPLOYMENT_ID`, and `VERCEL_TEAM_ID` come from Vercel system environment variables; enable **Project Settings → Environment Variables → Automatically expose System Environment Variables**. The Vercel API token needs Runtime Logs access.

For Slack, add the `chat:write` **User Token Scope** to an internal Slack app, reinstall it as the Slack user linked to Amp, and use its user OAuth token for `SLACK_USER_TOKEN`. `SLACK_AMP_CHANNEL_ID` is the `D...` channel ID shown in that user's Amp conversation, and `SLACK_AMP_USER_ID` is the installed Amp app's `U...` member ID. Reports are explicitly limited to administrators because Slack attributes every message to the user who authorized `SLACK_USER_TOKEN`.
