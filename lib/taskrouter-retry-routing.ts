/**
 * Shared TaskRouter retry/overflow routing.
 *
 * Both the simultaneous-ring path (simultaneous-dial-complete) and the normal
 * conference path (call-complete → retry-or-overflow) must enforce the same
 * "up to two distinct Sales Rep attempts, then terminal Overflow Number" rule
 * (Feature 3 / docs/adr/0002). This module holds the pure decision logic and
 * TwiML builders so the two paths never drift.
 *
 * Nothing here performs Twilio REST side effects — callers own those.
 */

import { serverConfig } from '@/lib/config'

export interface MissedAttemptRouting {
  /** Distinct Sales Reps offered this call so far (includes the one just missed). */
  excludedWorkers: string[]
  /** Number of distinct Sales Rep attempts so far. */
  attemptCount: number
  /** True once the single allowed non-owner fallback of a direct call was offered. */
  directFallbackOffered: boolean
  /** True when no further Sales Rep attempt is allowed → route to overflow. */
  shouldOverflow: boolean
  /** Task attributes to carry into a re-enqueued task. */
  nextTaskAttributes: Record<string, unknown>
}

/**
 * Decide whether a missed Call Attempt should re-enqueue for a distinct Sales
 * Rep or hand off to the terminal Overflow Number. Idempotent: re-adding a
 * worker already in `excluded_workers` does not inflate the attempt count.
 */
export function computeMissedAttemptRouting(
  taskAttributes: Record<string, unknown>,
  workerSid?: string | null,
): MissedAttemptRouting {
  const previouslyExcluded = Array.isArray(taskAttributes.excluded_workers)
    ? (taskAttributes.excluded_workers as string[])
    : []
  const excludedWorkers = workerSid
    ? [...new Set([...previouslyExcluded, workerSid])]
    : [...previouslyExcluded]

  const attemptCount = excludedWorkers.length
  const directFallbackOffered = taskAttributes.direct_fallback_offered === true

  return {
    excludedWorkers,
    attemptCount,
    directFallbackOffered,
    // Overflow when two distinct Sales Reps have been tried, OR the single
    // allowed non-owner fallback for a direct (Sales Rep Number) call is done.
    shouldOverflow: attemptCount >= 2 || directFallbackOffered,
    nextTaskAttributes: {
      ...taskAttributes,
      excluded_workers: excludedWorkers,
      attempt_count: attemptCount,
    },
  }
}

function appendBypass(u: URL): URL {
  return serverConfig.app.addVercelBypassToken(u)
}

/**
 * TwiML that hands the caller off to the terminal Overflow Number handler.
 */
export function buildOverflowRedirectTwiml(
  appUrl: string,
  params: {
    taskSid?: string | null
    workspaceSid?: string | null
    callSid?: string | null
    callerFrom?: string | null
  },
): string {
  const overflowUrl = new URL(`${appUrl}/api/taskrouter/overflow`)
  if (params.taskSid) overflowUrl.searchParams.set('taskSid', params.taskSid)
  if (params.workspaceSid)
    overflowUrl.searchParams.set('workspaceSid', params.workspaceSid)
  if (params.callSid) overflowUrl.searchParams.set('callSid', params.callSid)
  if (params.callerFrom)
    overflowUrl.searchParams.set('callerFrom', params.callerFrom)
  appendBypass(overflowUrl)

  const escaped = overflowUrl.toString().replace(/&/g, '&amp;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${escaped}</Redirect>
</Response>`
}

/**
 * TwiML that re-enqueues the caller for a distinct Sales Rep. The workflow's
 * `worker.sid NOT IN task.excluded_workers` expression guarantees the next
 * offer goes to a rep that has not already been tried.
 */
export function buildRequeueTwiml(
  appUrl: string,
  nextTaskAttributes: Record<string, unknown>,
): string {
  const waitUrlObj = new URL(`${appUrl}/api/taskrouter/wait`)
  waitUrlObj.searchParams.set('retry', 'true')
  appendBypass(waitUrlObj)

  const enqueueActionUrlObj = appendBypass(
    new URL(`${appUrl}/api/taskrouter/enqueue-complete`),
  )

  const escapedWaitUrl = waitUrlObj.toString().replace(/&/g, '&amp;')
  const escapedEnqueueActionUrl = enqueueActionUrlObj
    .toString()
    .replace(/&/g, '&amp;')
  const workflowSid = serverConfig.taskRouter.requireWorkflowSid()

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Enqueue workflowSid="${workflowSid}"
           action="${escapedEnqueueActionUrl}"
           method="POST"
           waitUrl="${escapedWaitUrl}"
           waitUrlMethod="POST">
    <Task>${JSON.stringify(nextTaskAttributes)}</Task>
  </Enqueue>
</Response>`
}
