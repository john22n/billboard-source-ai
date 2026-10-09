import { defineConfig, devices } from 'playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { parse } from 'dotenv'
import { baseUrl, databaseUrl, jwtSecret } from './tests/end-to-end/environment'

// Do not inherit live service credentials from the shell or Next's env files.
const envKeys = new Set(Object.keys(process.env))
for (const file of [
  '.env',
  '.env.local',
  '.env.dev',
  '.env.development',
  '.env.development.local',
]) {
  if (existsSync(file))
    for (const key of Object.keys(parse(readFileSync(file)))) envKeys.add(key)
}
const env = Object.fromEntries([...envKeys].map((key) => [key, '']))
for (const key of [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'COMSPEC',
]) {
  if (process.env[key]) env[key] = process.env[key]!
}
Object.assign(env, {
  NODE_ENV: 'development',
  NEXT_TELEMETRY_DISABLED: '1',
  PLAYWRIGHT_TEST: '1',
  VERCEL: '',
  DATABASE_URL: databaseUrl,
  JWT_SECRET: jwtSecret,
  NEXT_PUBLIC_APP_URL: baseUrl,
  PASSKEY_RP_ID: 'localhost',
  PASSKEY_ORIGIN: baseUrl,
})

export default defineConfig({
  testDir: './tests/end-to-end',
  globalSetup: './tests/end-to-end/setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm exec next dev --port 3100',
    env,
    url: `${baseUrl}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
