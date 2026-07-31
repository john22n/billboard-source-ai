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
- blocks newly introduced high-severity dependency vulnerabilities and publishes an SPDX SBOM;
- deploys same-repository pull requests to the Vercel Preview environment only after the gates pass; and
- deploys pushes to `main` to the protected GitHub `production` environment only after the gates pass.

Application secrets stay in Vercel. The workflow runs `vercel pull` for the target environment, builds once with `vercel build`, and deploys that exact artifact with `vercel deploy --prebuilt`. Preview and Production therefore use their corresponding Vercel environment variables without a second remote build.

This project uses CI-managed deployments so deployment is gated on GitHub checks. Disable automatic deployments for this project in Vercel's Git settings to avoid creating a second deployment for the same commit. If the project returns to Vercel's native Git deployment flow, remove the deploy jobs and keep the quality and security jobs as required checks.

Add only these deployment credentials as GitHub Actions repository secrets:

| Secret              | Source                                                                   |
| ------------------- | ------------------------------------------------------------------------ |
| `VERCEL_TOKEN`      | A Vercel account or team token with access to the project                |
| `VERCEL_ORG_ID`     | `orgId` in the local `.vercel/project.json` created by `vercel link`     |
| `VERCEL_PROJECT_ID` | `projectId` in the local `.vercel/project.json` created by `vercel link` |

Pull requests from forks run the quality checks but skip deployment because GitHub does not expose repository secrets to forked workflows.

To require a manual production approval, add required reviewers to the `production` environment under **GitHub repository settings → Environments**. The workflow works without reviewers but still scopes production secrets and deployment history to that environment.
