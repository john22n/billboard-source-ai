import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { configErrorResponseBody, isMissingConfig } from '@/lib/config'
import {
  clearExpiredReportedIssues,
  getReportedIssues,
  resolveReportedIssue,
  saveReportedIssue,
} from '@/lib/dal'
import {
  issueReportSchema,
  issueResolutionSchema,
} from '@/lib/issue-report-schema'
import {
  IssueReportDeliveryError,
  redactDiagnosticSecrets,
  submitIssueReport,
} from '@/lib/issue-reporting'
import { rateLimit, resetRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_REPORT_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const DAILY_REPORT_SCOPE = 'issue-report-daily'
const DAILY_REPORT_WINDOW_SECONDS = 24 * 60 * 60

export async function GET() {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await clearExpiredReportedIssues()
    return NextResponse.json({ issues: await getReportedIssues() })
  } catch {
    console.error('Failed to load reported issues')
    return NextResponse.json(
      { error: 'Reported issues could not be loaded' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const input = issueReportSchema.safeParse(body)
  if (!input.success) {
    return NextResponse.json(
      { error: input.error.issues[0]?.message ?? 'Invalid issue report' },
      { status: 400 },
    )
  }

  const occurredAt = new Date(input.data.occurredAt).getTime()
  const now = Date.now()
  if (
    occurredAt < now - MAX_REPORT_AGE_MS ||
    occurredAt > now + MAX_FUTURE_SKEW_MS
  ) {
    return NextResponse.json(
      { error: 'Issue time must be within the last 30 days' },
      { status: 400 },
    )
  }

  const attempt = await rateLimit(
    DAILY_REPORT_SCOPE,
    session.userId,
    1,
    DAILY_REPORT_WINDOW_SECONDS,
  )
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Each account can report one issue every 24 hours.' },
      {
        status: 429,
        headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
      },
    )
  }

  try {
    await clearExpiredReportedIssues()
    const report = await submitIssueReport({
      input: input.data,
      reporter: {
        id: session.userId,
        email: session.email,
        twilioPhoneNumber: session.twilioPhoneNumber,
        taskRouterWorkerSid: session.taskRouterWorkerSid,
        activeCallSid: session.activeCallSid,
      },
    })

    await saveReportedIssue({
      reportId: report.reportId,
      reporterId: session.userId,
      reporterEmail: session.email,
      title: redactDiagnosticSecrets(input.data.title),
      description: redactDiagnosticSecrets(input.data.description),
      occurredAt: new Date(input.data.occurredAt),
      lookbackMinutes: input.data.lookbackMinutes,
      diagnosis: report.diagnosis,
      unavailableSources: report.unavailableSources,
    })

    return NextResponse.json(report)
  } catch (error) {
    try {
      await resetRateLimit(DAILY_REPORT_SCOPE, session.userId)
    } catch {
      console.error('Failed to reset issue-report daily limit')
    }
    if (error instanceof IssueReportDeliveryError) {
      return NextResponse.json(
        { error: error.publicMessage },
        { status: error.status },
      )
    }
    if (isMissingConfig(error)) {
      return NextResponse.json(configErrorResponseBody(error), { status: 500 })
    }
    console.error('Issue report failed')
    return NextResponse.json(
      { error: 'The issue report could not be completed' },
      { status: 500 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const input = issueResolutionSchema.safeParse(body)
  if (!input.success) {
    return NextResponse.json({ error: 'Invalid report ID' }, { status: 400 })
  }

  try {
    await clearExpiredReportedIssues()
    const issue = await resolveReportedIssue(
      input.data.reportId,
      session.userId,
    )
    if (!issue) {
      return NextResponse.json(
        { error: 'Issue not found or already resolved' },
        { status: 404 },
      )
    }

    return NextResponse.json({ issue })
  } catch {
    console.error('Failed to resolve reported issue')
    return NextResponse.json(
      { error: 'The issue could not be resolved' },
      { status: 500 },
    )
  }
}
