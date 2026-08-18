import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { configErrorResponseBody, isMissingConfig } from '@/lib/config'
import { issueReportSchema } from '@/lib/issue-report-schema'
import {
  IssueReportDeliveryError,
  submitIssueReport,
} from '@/lib/issue-reporting'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_REPORT_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

export async function POST(request: NextRequest) {
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

  const attempt = await rateLimit('issue-report', session.userId, 3, 15 * 60)
  if (!attempt.allowed) {
    return NextResponse.json(
      { error: 'Too many issue reports. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(attempt.retryAfterSeconds) },
      },
    )
  }

  try {
    const report = await submitIssueReport({
      input: input.data,
      reporter: { id: session.userId, email: session.email },
    })
    return NextResponse.json(report)
  } catch (error) {
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
