import 'dotenv/config'
import { createServerConfig, isConfigError } from '@/lib/config-core'

// Verifies that the issue-report Vercel log collection is configured and that
// the request-logs API answers with the credentials in the environment.
// Usage: pnpm vercel-logs:check:prod [lookbackMinutes]
// Never prints token values; only variable names and response metadata.

type RuntimeLogCredentials = ReturnType<
  ReturnType<
    typeof createServerConfig
  >['vercel']['requireRuntimeLogCredentials']
>

interface RequestLogRow {
  timestamp?: string | number
  requestMethod?: string
  requestPath?: string
  statusCode?: number
  logs?: Array<{ level?: string }>
}

interface RequestLogsPayload {
  rows?: RequestLogRow[]
  hasMoreRows?: boolean
}

function fail(message: string, detail?: unknown): never {
  console.error(`❌ ${message}`, detail ?? '')
  process.exit(1)
}

function loadCredentials(): RuntimeLogCredentials {
  try {
    return createServerConfig(process.env).vercel.requireRuntimeLogCredentials()
  } catch (error) {
    if (isConfigError(error)) {
      fail(
        'Missing configuration:',
        error.issues.map((issue) => issue.envKey).join(', '),
      )
    }
    fail('Configuration failed', error)
  }
}

function buildRequestLogsUrl(
  credentials: RuntimeLogCredentials,
  lookbackMinutes: number,
) {
  const end = Date.now()
  const url = new URL('https://vercel.com/api/logs/request-logs')
  url.searchParams.set('projectId', credentials.projectId)
  url.searchParams.set('ownerId', credentials.teamId)
  if (credentials.deploymentId) {
    url.searchParams.set('deploymentId', credentials.deploymentId)
  }
  url.searchParams.set('startDate', String(end - lookbackMinutes * 60 * 1000))
  url.searchParams.set('endDate', String(end))
  url.searchParams.set('page', '0')
  return url
}

async function fetchRequestLogs(
  credentials: RuntimeLogCredentials,
  lookbackMinutes: number,
): Promise<RequestLogsPayload> {
  console.log(`\nRequesting logs for the last ${lookbackMinutes} minutes…`)
  const response = await fetch(
    buildRequestLogsUrl(credentials, lookbackMinutes),
    {
      headers: { Authorization: `Bearer ${credentials.apiToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  )
  console.log('HTTP', response.status, response.statusText)
  if (!response.ok) {
    fail('Vercel rejected the request:', (await response.text()).slice(0, 500))
  }
  return (await response.json()) as RequestLogsPayload
}

function describeRow(row: RequestLogRow) {
  const at = new Date(String(row.timestamp)).toISOString()
  const lines = (row.logs || []).length
  return `   ${at} ${row.requestMethod} ${row.requestPath} → ${row.statusCode} (${lines} log lines)`
}

function printSummary(payload: RequestLogsPayload) {
  const rows = payload.rows ?? []
  console.log(
    `✅ ${rows.length} request log rows (hasMoreRows: ${payload.hasMoreRows ?? false})`,
  )
  rows.slice(0, 5).forEach((row) => console.log(describeRow(row)))
  if (rows.length === 0) {
    console.log(
      '   No traffic in the window. Rerun with a longer lookback, e.g. `pnpm vercel-logs:check:prod 1440`.',
    )
  }
}

async function check() {
  const lookbackMinutes = Number.parseInt(process.argv[2] ?? '60', 10) || 60
  const credentials = loadCredentials()
  console.log('✅ Credentials present')
  console.log('   projectId:', credentials.projectId)
  console.log('   teamId:', credentials.teamId)
  console.log(
    '   deploymentId:',
    credentials.deploymentId ?? '(not set — project-wide query)',
  )
  printSummary(await fetchRequestLogs(credentials, lookbackMinutes))
}

check().catch((error) =>
  fail('Check failed', error instanceof Error ? error.message : error),
)
