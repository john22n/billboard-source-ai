/**
 * Conference Status Callback
 *
 * Called when conference events occur (start, end, join, leave).
 * Completes the task when the conference ends.
 * If the conference ended without being answered, redirects caller to voicemail.
 * Worker reset is handled by reservation.canceled in events/route.ts.
 */
import twilio from 'twilio'
import { recordMissedAttempt } from '@/lib/call-attempt-outcomes'
import { computeMissedAttemptRouting } from '@/lib/taskrouter-retry-routing'
import { serverConfig } from '@/lib/config'

export async function POST(req: Request) {
  try {
    const formData = await req.formData()

    const statusCallbackEvent = formData.get('StatusCallbackEvent') as string
    const conferenceSid = formData.get('ConferenceSid') as string
    const callSid = formData.get('CallSid') as string

    const url = new URL(req.url)
    const taskSid = url.searchParams.get('taskSid')
    const workspaceSid =
      url.searchParams.get('workspaceSid') ||
      serverConfig.taskRouter.requireWorkspaceSid()
    const workerSid = url.searchParams.get('workerSid')
    const reservationSid = url.searchParams.get('reservationSid') ?? ''
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    const client = twilio(accountSid, authToken)

    const appUrl = serverConfig.app.baseUrlFromRequest(req.url)

    console.log('═══════════════════════════════════════════')
    console.log('📞 CONFERENCE STATUS CALLBACK')
    console.log('═══════════════════════════════════════════')
    console.log('StatusCallbackEvent:', statusCallbackEvent)
    console.log('ConferenceSid:', conferenceSid)
    console.log('CallSid:', callSid)
    console.log('TaskSid:', taskSid)
    console.log('WorkerSid:', workerSid)
    console.log('═══════════════════════════════════════════')

    if (!taskSid || !workspaceSid) {
      console.error('❌ Missing taskSid or workspaceSid')
      return new Response('Missing parameters', { status: 400 })
    }

    if (statusCallbackEvent === 'conference-end') {
      try {
        const task = await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .fetch()
        const taskAttributes = JSON.parse(task.attributes || '{}')
        const callerCallSid = taskAttributes.call_sid as string | undefined

        // Idempotency guard: Twilio can re-deliver conference-end. Only the
        // first delivery (task still active) performs side effects; later ones
        // see a completed task and no-op so we never double redirect/re-enqueue.
        const taskWasActive =
          task.assignmentStatus === 'assigned' ||
          task.assignmentStatus === 'wrapping'
        if (!taskWasActive) {
          console.log(
            `ℹ️ Task is ${task.assignmentStatus}, skipping conference-end side effects`,
          )
          return new Response('OK', { status: 200 })
        }

        const participants = await client
          .conferences(conferenceSid)
          .participants.list()

        console.log(`📊 Participants count: ${participants.length}`)
        const wasAnswered = participants.length >= 2
        console.log(`📊 wasAnswered: ${wasAnswered}`)

        if (wasAnswered) {
          // Answered → just complete the task; no retry/overflow.
          await client.taskrouter.v1
            .workspaces(workspaceSid)
            .tasks(taskSid)
            .update({
              assignmentStatus: 'completed',
              reason: 'Conference ended',
            })
          console.log('✅ Conference was answered — task completed, no retry')
          return new Response('OK', { status: 200 })
        }

        console.log(
          '📤 Conference ended unanswered — advancing to next Sales Rep or overflow',
        )
        // Note: worker reset is handled by reservation.canceled in events/route.ts

        // Record this Sales Rep's Call Attempt as Missed (idempotent;
        // suppressed if the rep just explicitly rejected this attempt).
        if (workerSid) {
          await recordMissedAttempt({ reservationSid, workerSid })
        }

        // The conference instruction ACCEPTED the reservation, so TaskRouter
        // will not advance to the workflow's next target on its own. Complete
        // this accepted task (persisting the offered-worker state) and redirect
        // the caller's live leg to retry-or-overflow, which re-enqueues for a
        // distinct Sales Rep or hands off to overflow — matching the
        // simultaneous-ring path's two-attempt-then-overflow behavior.
        const routing = computeMissedAttemptRouting(taskAttributes, workerSid)
        await client.taskrouter.v1
          .workspaces(workspaceSid)
          .tasks(taskSid)
          .update({
            attributes: JSON.stringify(routing.nextTaskAttributes),
            assignmentStatus: 'completed',
            reason: routing.shouldOverflow
              ? 'Conference ended unanswered — overflow'
              : 'Conference ended unanswered — retrying distinct rep',
          })
        console.log(
          `✅ Task ${taskSid} completed (attempt ${routing.attemptCount}, shouldOverflow=${routing.shouldOverflow})`,
        )

        if (!callerCallSid) {
          console.log(
            '⚠️ Conference ended unanswered but no callerCallSid available',
          )
          return new Response('OK', { status: 200 })
        }

        const retryUrl = new URL(`${appUrl}/api/taskrouter/retry-or-overflow`)
        retryUrl.searchParams.set('taskSid', taskSid)
        retryUrl.searchParams.set('workspaceSid', workspaceSid)
        if (workerSid) retryUrl.searchParams.set('workerSid', workerSid)
        retryUrl.searchParams.set('callSid', callerCallSid)
        if (taskAttributes.from) {
          retryUrl.searchParams.set('callerFrom', taskAttributes.from as string)
        }
        serverConfig.app.addVercelBypassToken(retryUrl)

        try {
          const callerCall = await client.calls(callerCallSid).fetch()
          if (callerCall.status === 'in-progress') {
            await client.calls(callerCallSid).update({
              url: retryUrl.toString(),
              method: 'POST',
            })
            console.log(
              `✅ Caller ${callerCallSid} redirected to retry-or-overflow`,
            )
          } else {
            console.log(
              `ℹ️ Caller already hung up (status: ${callerCall.status}) — skipping redirect`,
            )
          }
        } catch (redirectErr) {
          console.error(
            '❌ Failed to redirect caller to retry-or-overflow:',
            redirectErr,
          )
        }
      } catch (error) {
        console.error('❌ Failed to handle conference-end:', error)
      }
    } else {
      console.log(`ℹ️ Conference event: ${statusCallbackEvent}`)
    }

    return new Response('OK', { status: 200 })
  } catch (error) {
    console.error('❌ Conference status callback error:', error)
    return new Response('Error', { status: 500 })
  }
}
