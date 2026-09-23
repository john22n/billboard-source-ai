'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, RefreshCw, PhoneIncoming } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type {
  VoicemailAICall,
  VoicemailAIDetail,
  VoicemailAIPage,
} from '@/lib/voicemail-ai-log-types'

const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

async function readLogs<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: 'no-store' })
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new Error(
        'Your admin session has expired or access was denied. Sign in again.',
      )
    throw new Error('Twilio logs could not be loaded. Please try again.')
  }
  return response.json()
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null
  return (
    <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
      {warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  )
}

function Recording({
  callSid,
  recording,
}: {
  callSid: string
  recording: VoicemailAIDetail['recordings'][number]
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-medium">
          Recording · {recording.duration ?? '—'} seconds
        </h5>
        <Badge variant="outline">{recording.status}</Badge>
      </div>
      <audio
        controls
        preload="none"
        className="w-full"
        aria-label={`Recording ${recording.sid}`}
        onError={() => setFailed(true)}
        src={`/api/admin/voicemail-ai/${callSid}/recordings/${recording.sid}`}
      />
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          Audio is unavailable. It may have been deleted or Twilio could not
          serve it.
        </p>
      )}
      <h6 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Twilio transcript
      </h6>
      {recording.transcriptions.length ? (
        recording.transcriptions.map((transcript) => (
          <div key={transcript.sid}>
            <Badge variant="secondary">{transcript.status}</Badge>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              {transcript.text || 'No transcript text is available yet.'}
            </p>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No Twilio transcript is available for this recording.
        </p>
      )}
    </div>
  )
}

function CallDetail({ callSid }: { callSid: string }) {
  const [data, setData] = useState<VoicemailAIDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    readLogs<VoicemailAIDetail>(
      `/api/admin/voicemail-ai/${callSid}`,
      controller.signal,
    )
      .then((detail) => {
        if (!controller.signal.aborted) setData(detail)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [callSid, retry])
  if (error)
    return (
      <div role="alert" className="p-4 text-sm text-destructive">
        {error}{' '}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null)
            setRetry(retry + 1)
          }}
        >
          Retry details
        </Button>
      </div>
    )
  if (!data)
    return (
      <p
        role="status"
        className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        Loading call details…
      </p>
    )
  return <CallDetailContent data={data} callSid={callSid} />
}

function CallDetailContent({
  data,
  callSid,
}: {
  data: VoicemailAIDetail
  callSid: string
}) {
  return (
    <div className="space-y-4 border-t bg-muted/20 p-4 md:p-5">
      <Warnings warnings={data.warnings} />
      <div className="grid gap-5 lg:grid-cols-2">
        <section
          className="min-w-0 space-y-3"
          aria-label="Twilio errors and warnings"
        >
          <h4 className="font-medium">
            Errors &amp; warnings{' '}
            <span className="text-muted-foreground">
              ({data.errors.length})
            </span>
          </h4>
          {data.errors.length ? (
            data.errors.map((error) => (
              <div
                key={error.sid}
                className="space-y-2 rounded-lg border bg-background p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Code {error.code}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {dateFormat.format(new Date(error.createdAt))}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {error.message}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No Twilio error records returned. Check any availability notices
              above.
            </p>
          )}
        </section>
        <section
          className="min-w-0 space-y-3"
          aria-label="Recordings and transcripts"
        >
          <h4 className="font-medium">
            Recordings &amp; transcripts{' '}
            <span className="text-muted-foreground">
              ({data.recordings.length})
            </span>
          </h4>
          {data.recordings.length ? (
            data.recordings.map((recording) => (
              <Recording
                key={recording.sid}
                callSid={callSid}
                recording={recording}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No Twilio recordings returned for this call. Streaming to the AI
              does not automatically create a recording or transcript.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function CallRow({ call }: { call: VoicemailAICall }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="overflow-hidden rounded-xl border bg-background">
      <button
        type="button"
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring md:p-5"
        aria-expanded={open}
        aria-controls={`detail-${call.sid}`}
        onClick={() => setOpen(!open)}
      >
        <PhoneIncoming className="mt-1 size-4 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <p className="font-medium">{call.from}</p>
            <p className="text-xs text-muted-foreground">To {call.to}</p>
          </div>
          <div>
            <p className="text-sm">
              {dateFormat.format(new Date(call.startedAt))}
            </p>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {call.sid}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{call.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {call.duration ?? '—'}s
            </span>
          </div>
        </div>
        <ChevronDown
          className={`mt-1 size-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={`detail-${call.sid}`} hidden={!open}>
        {open && <CallDetail callSid={call.sid} />}
      </div>
    </article>
  )
}

function useVoicemailCalls() {
  const [data, setData] = useState<VoicemailAIPage | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    readLogs<VoicemailAIPage>('/api/admin/voicemail-ai', controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return
        setData(page)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [refresh])
  function reload() {
    setLoading(true)
    setError(null)
    setData(null)
    setRefresh(refresh + 1)
  }
  function retry() {
    setLoading(true)
    setError(null)
    setRefresh(refresh + 1)
  }
  return { data, calls: data?.calls ?? [], loading, error, reload, retry }
}

export default function VoicemailAITab() {
  const { data, calls, loading, error, reload, retry } = useVoicemailCalls()
  return (
    <section className="space-y-5" aria-label="Voicemail AI logs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Voicemail AI logs
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saturdays and Sundays · Last 21 days · Central time
          </p>
        </div>
        <Button
          className="group"
          variant="outline"
          disabled={loading}
          onClick={reload}
        >
          <RefreshCw
            data-icon="inline-start"
            className="size-4 group-disabled:animate-spin"
          />
          Refresh logs
        </Button>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Calls verified by Twilio’s requests to the voicemail AI service. Expand
        a call to inspect errors, play available recordings, and read Twilio
        transcripts. AI conversation transcripts saved only to Nutshell are not
        included.
      </p>
      {data && <Warnings warnings={data.warnings} />}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
        >
          {error}
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {calls.map((call) => (
          <CallRow key={call.sid} call={call} />
        ))}
      </div>
      <CallHistoryStatus loading={loading} error={error} count={calls.length} />
    </section>
  )
}

function CallHistoryStatus({
  loading,
  error,
  count,
}: {
  loading: boolean
  error: string | null
  count: number
}) {
  if (error) return null
  if (loading)
    return (
      <p
        role="status"
        className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" />
        Checking Twilio call history…
      </p>
    )
  return count === 0 ? <EmptyCalls /> : null
}

function EmptyCalls() {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <PhoneIncoming className="mx-auto mb-3 size-6 text-muted-foreground" />
      <h3 className="font-medium">No verified weekend AI calls found</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Recent calls may take 15 minutes to appear. Refresh after Twilio
        finishes processing.
      </p>
    </div>
  )
}
