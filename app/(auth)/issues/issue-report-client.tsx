'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  CloudCog,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  handleApiResponse,
  showErrorToast,
  showSuccessToast,
} from '@/lib/error-handling'
import {
  issueReportSchema,
  type IssueReportResponse,
} from '@/lib/issue-report-schema'

const sourceCards = [
  {
    icon: PhoneCall,
    label: 'Twilio',
    detail: 'Debugger alerts, call outcomes, and TaskRouter events',
  },
  {
    icon: CloudCog,
    label: 'Vercel',
    detail: 'Runtime request and function logs around the incident',
  },
  {
    icon: Sparkles,
    label: 'OpenAI',
    detail: 'Timestamp correlation and likely-cause analysis',
  },
  {
    icon: Bot,
    label: 'Amp',
    detail: 'Slack handoff with the sanitized diagnostic package',
  },
]

function toLocalDateTimeInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function severityVariant(
  severity: IssueReportResponse['diagnosis']['severity'],
) {
  return severity === 'critical' || severity === 'high'
    ? 'destructive'
    : severity === 'medium'
      ? 'secondary'
      : 'outline'
}

function parseReportForm(formData: FormData, requestId: string) {
  const incidentDate = new Date(String(formData.get('occurredAt')))
  return issueReportSchema.safeParse({
    requestId,
    title: formData.get('title'),
    description: formData.get('description'),
    occurredAt: Number.isNaN(incidentDate.getTime())
      ? ''
      : incidentDate.toISOString(),
    lookbackMinutes: Number(formData.get('lookbackMinutes')),
  })
}

function PendingReportStatus({ isPending }: { isPending: boolean }) {
  if (!isPending) return null

  return (
    <Alert
      role="status"
      aria-live="polite"
      className="border-amber-400/20 bg-amber-400/5 text-amber-100"
    >
      <Loader2
        aria-hidden="true"
        className="animate-spin motion-reduce:animate-none"
      />
      <AlertTitle>Building the handoff</AlertTitle>
      <AlertDescription className="text-amber-100/70">
        Log APIs may take a few seconds. Keep this page open until Slack
        confirms delivery.
      </AlertDescription>
    </Alert>
  )
}

function UnavailableSources({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null

  return (
    <div className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/70">
      Partial handoff: {sources.join(', ')} could not provide complete data.
    </div>
  )
}

function CompletedReportStatus({
  result,
}: {
  result: IssueReportResponse | null
}) {
  if (!result) return null

  return (
    <Card
      role="status"
      aria-live="polite"
      className="gap-0 rounded-xl border-emerald-400/30 bg-emerald-400/5"
    >
      <CardHeader className="border-b border-emerald-400/20 py-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-emerald-100">
            <CheckCircle2 aria-hidden="true" className="size-5" />
            Sent to Amp
          </CardTitle>
          <Badge variant={severityVariant(result.diagnosis.severity)}>
            {result.diagnosis.severity}
          </Badge>
        </div>
        <CardDescription className="font-mono text-emerald-100/60">
          {result.reportId}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 py-5">
        <p className="text-sm leading-6 text-slate-300">
          {result.diagnosis.summary}
        </p>
        <UnavailableSources sources={result.unavailableSources} />
        <div className="flex items-center gap-2 text-xs text-emerald-100/60">
          <MessageSquareText aria-hidden="true" className="size-4" />
          Amp was contacted directly in Slack.
        </div>
      </CardContent>
    </Card>
  )
}

function DiagnosticRouteCard() {
  return (
    <Card className="gap-0 rounded-xl border-slate-800 bg-slate-900/70">
      <CardHeader className="border-b border-slate-800 py-5">
        <CardTitle className="text-sm uppercase tracking-[0.16em] text-slate-400">
          Diagnostic route
        </CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        {sourceCards.map((source, index) => (
          <div
            key={source.label}
            className="relative flex gap-3 border-b border-slate-800 py-4 last:border-0"
          >
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-amber-300">
              <source.icon aria-hidden="true" className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-200">
                  {source.label}
                </span>
                <span className="font-mono text-[10px] text-slate-600">
                  0{index + 1}
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {source.detail}
              </p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function IssueReportSidebar({
  isPending,
  result,
}: {
  isPending: boolean
  result: IssueReportResponse | null
}) {
  return (
    <aside className="space-y-6">
      <DiagnosticRouteCard />
      <PendingReportStatus isPending={isPending} />
      <CompletedReportStatus result={result} />
    </aside>
  )
}

export default function IssueReportClient({
  reporterEmail,
}: {
  reporterEmail: string
}) {
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<IssueReportResponse | null>(null)
  const [occurredAt, setOccurredAt] = useState(() =>
    toLocalDateTimeInput(new Date()),
  )
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const input = parseReportForm(new FormData(form), requestId)

    if (!input.success) {
      showErrorToast(
        input.error.issues[0]?.message ?? 'Check the report fields',
      )
      return
    }

    startTransition(async () => {
      try {
        setResult(null)
        const response = await fetch('/api/issues', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input.data),
        })
        const report = await handleApiResponse<IssueReportResponse>(response)
        setResult(report)
        showSuccessToast(`${report.reportId} sent to Amp in Slack`)
        form.reset()
        setOccurredAt(toLocalDateTimeInput(new Date()))
        setRequestId(crypto.randomUUID())
      } catch (error) {
        showErrorToast(error, 'The issue could not be reported')
      }
    })
  }

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="mb-8 flex flex-col gap-5 border-b border-slate-800 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-3 mb-4 text-slate-400 hover:bg-slate-900 hover:text-white"
            >
              <Link href="/dashboard">
                <ArrowLeft aria-hidden="true" data-icon="inline-start" />
                Dashboard
              </Link>
            </Button>
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-md border border-amber-400/30 bg-amber-400/10 text-amber-300">
                <TriangleAlert aria-hidden="true" className="size-5" />
              </div>
              <Badge
                variant="outline"
                className="border-slate-700 bg-slate-900 text-slate-300"
              >
                Support diagnostics
              </Badge>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Report a production issue
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
              Capture what happened once. The system gathers the surrounding
              evidence, asks OpenAI for an initial diagnosis, and hands the
              package to Amp in Slack.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <LockKeyhole
              aria-hidden="true"
              className="size-4 text-emerald-400"
            />
            Signed in as {reporterEmail}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="gap-0 overflow-hidden rounded-xl border-slate-800 bg-slate-900/70 shadow-2xl shadow-black/20">
            <CardHeader className="border-b border-slate-800 py-6">
              <CardTitle className="text-xl text-white">
                Incident brief
              </CardTitle>
              <CardDescription className="leading-6 text-slate-400">
                Be specific about what the user did, what you expected, and what
                happened instead.
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit} aria-busy={isPending}>
              <CardContent className="space-y-6 py-6">
                <div className="space-y-2">
                  <Label htmlFor="issue-title" className="text-slate-200">
                    Short title
                  </Label>
                  <Input
                    id="issue-title"
                    name="title"
                    minLength={5}
                    maxLength={120}
                    required
                    disabled={isPending}
                    placeholder="Inbound calls ring but cannot be accepted"
                    className="border-slate-700 bg-slate-950/70 text-white placeholder:text-slate-600"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="issue-description" className="text-slate-200">
                    What happened?
                  </Label>
                  <Textarea
                    id="issue-description"
                    name="description"
                    minLength={20}
                    maxLength={4000}
                    required
                    disabled={isPending}
                    rows={8}
                    placeholder="At approximately 2:15 PM, two reps saw the incoming-call banner. Pressing Accept closed the banner, but neither rep connected to the caller…"
                    className="min-h-48 resize-y border-slate-700 bg-slate-950/70 text-white placeholder:text-slate-600"
                  />
                  <p className="text-xs leading-5 text-slate-500">
                    Include the affected workflow and any visible error. Do not
                    paste passwords, API keys, or customer payment data.
                  </p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="issue-time" className="text-slate-200">
                      When did it happen?
                    </Label>
                    <div className="relative">
                      <Clock3
                        aria-hidden="true"
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
                      />
                      <Input
                        id="issue-time"
                        name="occurredAt"
                        type="datetime-local"
                        value={occurredAt}
                        required
                        disabled={isPending}
                        onChange={(event) => setOccurredAt(event.target.value)}
                        className="border-slate-700 bg-slate-950/70 pl-10 text-white [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lookback" className="text-slate-200">
                      Evidence window
                    </Label>
                    <select
                      id="lookback"
                      name="lookbackMinutes"
                      defaultValue="30"
                      disabled={isPending}
                      className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950/70 px-3 py-1 text-sm text-white shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-amber-400 focus-visible:ring-[3px] focus-visible:ring-amber-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="15">15 minutes before</option>
                      <option value="30">30 minutes before</option>
                      <option value="60">1 hour before</option>
                      <option value="180">3 hours before</option>
                    </select>
                  </div>
                </div>

                <Alert className="border-emerald-400/20 bg-emerald-400/5 text-emerald-100">
                  <ShieldCheck aria-hidden="true" />
                  <AlertTitle>Sanitized before handoff</AlertTitle>
                  <AlertDescription className="text-emerald-100/70">
                    Credentials, email addresses, and phone numbers found in
                    logs are redacted before diagnostics are sent to OpenAI,
                    Slack, or Amp.
                  </AlertDescription>
                </Alert>
              </CardContent>
              <CardFooter className="justify-between gap-4 border-t border-slate-800 py-5">
                <p className="hidden text-xs text-slate-500 sm:block">
                  Reports are limited to 3 every 15 minutes.
                </p>
                <span
                  id="issue-submit-status"
                  role="status"
                  aria-live="polite"
                  className="sr-only"
                >
                  {isPending
                    ? 'Gathering diagnostic evidence'
                    : 'Issue report ready to submit'}
                </span>
                <Button
                  type="submit"
                  disabled={isPending}
                  aria-describedby="issue-submit-status"
                  aria-label="Diagnose and send issue report"
                  className="ml-auto min-w-44 bg-amber-400 text-slate-950 hover:bg-amber-300"
                >
                  {isPending ? (
                    <>
                      <Loader2
                        aria-hidden="true"
                        data-icon="inline-start"
                        className="animate-spin motion-reduce:animate-none"
                      />
                      Gathering evidence…
                    </>
                  ) : (
                    <>
                      <Send aria-hidden="true" data-icon="inline-start" />
                      Diagnose and send
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>

          <IssueReportSidebar isPending={isPending} result={result} />
        </div>
      </div>
    </main>
  )
}
