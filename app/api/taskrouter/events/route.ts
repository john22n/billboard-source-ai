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

const TWILIO_AUTH_TOKEN      = process.env.TWILIO_AUTH_TOKEN
const ACCOUNT_SID            = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN             = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID          = process.env.TASKROUTER_WORKSPACE_SID!
const BUSY_ACTIVITY_SID      = process.env.TASKROUTER_ACTIVITY_BUSY_SID!
const AVAILABLE_ACTIVITY_SID = process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID!

const ACTIVITY_MAP: Record<string, 'available' | 'unavailable' | 'offline' | 'busy'> = {
  [process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID   || '']: 'available',
  [process.env.TASKROUTER_ACTIVITY_UNAVAILABLE_SID || '']: 'unavailable',
  [process.env.TASKROUTER_ACTIVITY_OFFLINE_SID     || '']: 'offline',
  [process.env.TASKROUTER_ACTIVITY_BUSY_SID        || '']: 'busy',
}

async function resetWorkerToBack(workerSid: string, label: string) {
  if (!workerSid || !WORKSPACE_SID || !BUSY_ACTIVITY_SID || !AVAILABLE_ACTIVITY_SID) return
  try {
    const client = twilio(ACCOUNT_SID, AUTH_TOKEN)
    await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers(workerSid)
      .update({ activitySid: BUSY_ACTIVITY_SID })
    await client.taskrouter.v1
      .workspaces(WORKSPACE_SID)
      .workers(workerSid)
      .update({ activitySid: AVAILABLE_ACTIVITY_SID })
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
    const isProduction = process.env.VERCEL_ENV === 'production'

    if (TWILIO_AUTH_TOKEN && isProduction) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') || ''
      const url = new URL(req.url)

      const params: Record<string, string> = {}
      new URLSearchParams(bodyText).forEach((value, key) => {
        params[key] = value
      })

      const isValid = twilio.validateRequest(
        TWILIO_AUTH_TOKEN,
        twilioSignature,
        url.toString(),
        params,
      )

      if (!isValid) {
        console.error('❌ Invalid Twilio signature on events callback')
        return new Response('Forbidden', { status: 403 })
      }
    }

    const eventType     = formData.get('EventType')     as string
    const taskSid       = formData.get('TaskSid')       as string
    const taskQueueName = formData.get('TaskQueueName') as string
    const workerSid     = formData.get('WorkerSid')     as string

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

      case 'reservation.accepted':
        console.log(`✅ Reservation accepted by worker: ${workerSid}`)
        if (workerSid && WORKSPACE_SID && BUSY_ACTIVITY_SID) {
          // Skip Busy switch for voicemail worker
          const workerAttrsRaw = formData.get('WorkerAttributes') as string
          const workerAttrs = JSON.parse(workerAttrsRaw || '{}')
          if (workerAttrs.email === 'voicemail@system') {
            console.log('⏭️ Skipping Busy switch for voicemail worker')
            break
          }
          try {
            const client = twilio(ACCOUNT_SID, AUTH_TOKEN)
            await client.taskrouter.v1
              .workspaces(WORKSPACE_SID)
              .workers(workerSid)
              .update({ activitySid: BUSY_ACTIVITY_SID })
            console.log(`✅ Worker ${workerSid} switched to Busy`)
          } catch (err) {
            console.error('❌ Failed to switch worker to Busy:', err)
          }
        }
        break

      case 'reservation.canceled':
        console.log(`❌ Reservation canceled for worker: ${workerSid}`)
        await resetWorkerToBack(workerSid, 'cancellation')
        break

      case 'reservation.rejected':
        console.log(`🚫 Reservation rejected by worker: ${workerSid}`)
        await resetWorkerToBack(workerSid, 'rejection')
        break

      case 'reservation.timeout':
        console.log(`⏰ Reservation timeout for worker: ${workerSid}`)
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
          const newStatus = ACTIVITY_MAP[activitySid] || 'offline'
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