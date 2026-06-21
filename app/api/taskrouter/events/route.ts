/**
 * TaskRouter Event Callback
 *
 * Logs TaskRouter events for debugging and monitoring.
 * Voicemail redirect is handled by the assignment callback using redirect instruction.
 */

import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import {
  recordAcceptedAttempt,
  recordMissedAttempt,
} from '@/lib/call-attempt-outcomes'
import { serverConfig } from '@/lib/config'

function getActivityMap(): Record<
  string,
  'available' | 'unavailable' | 'offline' | 'busy'
> {
  const activitySids = serverConfig.taskRouter.activitySids
  return {
    [activitySids.available || '']: 'available',
    [activitySids.unavailable || '']: 'unavailable',
    [activitySids.offline || '']: 'offline',
    [activitySids.busy || '']: 'busy',
  }
}

async function resetWorkerToBack(workerSid: string, label: string) {
  if (!workerSid) return
  try {
    const { accountSid, authToken } =
      serverConfig.twilio.requireAccountCredentials()
    const workspaceSid = serverConfig.taskRouter.requireWorkspaceSid()
    const activitySids = serverConfig.taskRouter.requireActivitySids([
      'busy',
      'available',
    ] as const)
    const client = twilio(accountSid, authToken)
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .workers(workerSid)
      .update({ activitySid: activitySids.busy })
    await client.taskrouter.v1
      .workspaces(workspaceSid)
      .workers(workerSid)
      .update({ activitySid: activitySids.available })
    console.log(`✅ Worker ${workerSid} reset to back of queue after ${label}`)
  } catch (err) {
    console.error(`❌ Failed to reset worker after ${label}:`, err)
  }
}

export async function POST(req: Request) {
  try {
    const clonedReq = req.clone()
    const bodyText = await clonedReq.text()
    const formData = await req.formData()

    // Validate Twilio signature — skip on preview deployments
    const isProduction = serverConfig.runtime.isProductionDeployment
    const twilioAuthToken = serverConfig.twilio.authToken

    if (twilioAuthToken && isProduction) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || ''
      const url = new URL(req.url)

      const params: Record<string, string> = {}
      new URLSearchParams(bodyText).forEach((value, key) => {
        params[key] = value
      })

      const isValid = twilio.validateRequest(
        twilioAuthToken,
        twilioSignature,
        url.toString(),
        params,
      )

      if (!isValid) {
        console.error('❌ Invalid Twilio signature on events callback')
        return new Response('Forbidden', { status: 403 })
      }
    }

    const eventType = formData.get('EventType') as string
    const taskQueueName = formData.get('TaskQueueName') as string
    const workerSid = formData.get('WorkerSid') as string
    const reservationSid = formData.get('ReservationSid') as string

    switch (eventType) {
      case 'task.created':
        console.log('📋 Task created')
        break

      case 'task-queue.entered':
        console.log(`📥 Task entered queue: ${taskQueueName}`)
        if (taskQueueName === 'Voicemail') {
          console.log(
            '📼 Task entered Voicemail queue - assignment callback will handle redirect',
          )
        }
        break

      case 'reservation.created':
        console.log(`🔔 Reservation created for worker: ${workerSid}`)
        break

      case 'reservation.accepted': {
        console.log(`✅ Reservation accepted by worker: ${workerSid}`)
        if (workerSid) {
          // Skip Busy switch for voicemail worker
          const workerAttrsRaw = formData.get('WorkerAttributes') as string
          const workerAttrs = JSON.parse(workerAttrsRaw || '{}')
          if (workerAttrs.email === 'voicemail@system') {
            console.log('⏭️ Skipping Busy switch for voicemail worker')
            break
          }
          // Accepted for the normal conference path. Simultaneous-ring workers
          // accept the reservation early (accept:true on redirect) before the
          // rep actually answers, so their Accepted is recorded authoritatively
          // in simultaneous-dial-complete instead.
          if (!workerAttrs.simultaneous_ring) {
            await recordAcceptedAttempt({ reservationSid, workerSid })
          }
          try {
            const { accountSid, authToken } =
              serverConfig.twilio.requireAccountCredentials()
            const workspaceSid = serverConfig.taskRouter.requireWorkspaceSid()
            const busyActivitySid =
              serverConfig.taskRouter.requireActivitySid('busy')
            const client = twilio(accountSid, authToken)
            await client.taskrouter.v1
              .workspaces(workspaceSid)
              .workers(workerSid)
              .update({ activitySid: busyActivitySid })
            console.log(`✅ Worker ${workerSid} switched to Busy`)
          } catch (err) {
            console.error('❌ Failed to switch worker to Busy:', err)
          }
        }
        break
      }

      case 'reservation.canceled':
        console.log(`❌ Reservation canceled for worker: ${workerSid}`)
        // Missed (suppressed if the rep just explicitly rejected this attempt).
        await recordMissedAttempt({ reservationSid, workerSid })
        await resetWorkerToBack(workerSid, 'cancellation')
        break

      case 'reservation.rejected':
        console.log(`🚫 Reservation rejected by worker: ${workerSid}`)
        // The explicit browser Reject is recorded by the browser endpoint and
        // stamps last_reject_at, so recordMissedAttempt is suppressed within the
        // window and the attempt is not double-counted.
        await recordMissedAttempt({ reservationSid, workerSid })
        await resetWorkerToBack(workerSid, 'rejection')
        break

      case 'reservation.timeout':
        console.log(`⏰ Reservation timeout for worker: ${workerSid}`)
        await recordMissedAttempt({ reservationSid, workerSid })
        await resetWorkerToBack(workerSid, 'timeout')
        break

      case 'task.canceled':
        console.log('🗑️ Task canceled')
        console.log('Reason:', formData.get('TaskCanceledReason') || 'unknown')
        break

      case 'task.completed':
        console.log(`📞 Task completed for worker: ${workerSid}`)
        break

      case 'worker.activity.update':
        console.log(`👤 Worker activity updated: ${workerSid}`)
        const activitySid = formData.get('WorkerActivitySid') as string

        if (activitySid && workerSid) {
          const newStatus = getActivityMap()[activitySid] || 'offline'
          console.log(`   Status: ${newStatus}`)

          // Skip DB update for Busy — it's transient and set automatically
          if (newStatus === 'busy') {
            console.log(`   ⏭️ Skipping DB update for Busy activity`)
            break
          }

          const currentUser = await db
            .select({ id: user.id, email: user.email })
            .from(user)
            .where(eq(user.taskRouterWorkerSid, workerSid))
            .limit(1)
            .then((rows) => rows[0])

          if (currentUser) {
            await db
              .update(user)
              .set({ workerActivity: newStatus })
              .where(eq(user.id, currentUser.id))

            console.log(`   ✅ Updated ${currentUser.email} to ${newStatus}`)
          }
        }
        break

      default:
        console.log(`ℹ️ Unhandled event type: ${eventType}`)
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('❌ TaskRouter event callback error:', error)
    return new Response(null, { status: 500 })
  }
}
