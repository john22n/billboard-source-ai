import twilio from 'twilio'
import { z } from 'zod'
import { serverConfig } from '@/lib/config'

export type CallChannel = 'browser' | 'cell'

export interface CurrentCall {
  taskSid: string
  callSid: string
  callerFrom: string
  status: 'ringing' | 'answered'
  channel: CallChannel | null
}

const offerSchema = z.object({
  workerSid: z.string(),
  reservationSid: z.string(),
  status: z.enum(['ringing', 'answered']),
  channel: z.enum(['browser', 'cell']).nullable(),
})

export function readCallOffer(attributes: Record<string, unknown>) {
  const result = offerSchema.safeParse(attributes.call_offer)
  return result.success ? result.data : null
}

function readAnswerableOffer(
  attributes: Record<string, unknown>,
  query: URLSearchParams,
  parentCallSid: FormDataEntryValue | null,
) {
  const offer = readCallOffer(attributes)
  if (
    !offer ||
    offer.workerSid !== query.get('workerSid') ||
    (query.has('reservationSid') &&
      offer.reservationSid !== query.get('reservationSid')) ||
    (parentCallSid && parentCallSid !== attributes.call_sid) ||
    offer.status === 'answered'
  )
    return null
  return offer
}

function isRetryableTaskRouterError(error: unknown) {
  const status = (error as { status?: number }).status
  return status === 412 || status === 429 || (status ?? 0) >= 500
}

// The task owns the offer's lifetime. Completing/canceling it removes the call
// from the roster, so a late child-leg callback cannot resurrect an old call.
export async function recordCallAnswer(
  req: Request,
  formData: FormData,
  channel: CallChannel,
) {
  const query = new URL(req.url).searchParams
  const taskSid = query.get('taskSid')
  const workerSid = query.get('workerSid')
  if (!taskSid || !workerSid) return // Calls started before this deployment.

  const workspaceSid =
    query.get('workspaceSid') ?? serverConfig.taskRouter.requireWorkspaceSid()
  const { accountSid, authToken } =
    serverConfig.twilio.requireAccountCredentials()
  const client = twilio(accountSid, authToken)
  const task = client.taskrouter.v1.workspaces(workspaceSid).tasks(taskSid)

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const current = await task.fetch()
      const etag = client.httpClient?.lastResponse?.headers?.etag
      if (current.assignmentStatus !== 'assigned') return
      const attributes = JSON.parse(current.attributes || '{}')
      const offer = readAnswerableOffer(
        attributes,
        query,
        formData.get('ParentCallSid'),
      )
      if (!offer) return

      await task.update({
        ifMatch: etag,
        attributes: JSON.stringify({
          ...attributes,
          call_offer: { ...offer, status: 'answered', channel },
        }),
      })
      return
    } catch (error) {
      // Re-read after conflicts and transient REST failures, so retries cannot
      // overwrite a newer reservation or resurrect a completed call.
      if (attempt === 2 || !isRetryableTaskRouterError(error)) throw error
    }
  }
}
