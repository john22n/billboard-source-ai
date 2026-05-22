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

const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN

const ACTIVITY_MAP: Record<string, 'available' | 'unavailable' | 'offline'> = {
  [process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID   || '']: 'available',
  [process.env.TASKROUTER_ACTIVITY_UNAVAILABLE_SID || '']: 'unavailable',
  [process.env.TASKROUTER_ACTIVITY_OFFLINE_SID     || '']: 'offline',
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
        break

      case 'reservation.rejected':
        console.log(`🚫 Reservation rejected by worker: ${workerSid}`)
        break

      case 'reservation.timeout':
        console.log(`⏰ Reservation timeout for worker: ${workerSid}`)
        break

      case 'task.canceled':
        console.log('🗑️ Task canceled')
        console.log('Reason:', formData.get('TaskCanceledReason') || 'unknown')
        break

      case 'task.completed':
        console.log(`📞 Task completed for worker: ${workerSid}`)
        if (workerSid) {
          await db
            .update(user)
            .set({ lastCallAt: new Date() })
            .where(eq(user.taskRouterWorkerSid, workerSid))
          console.log(`✅ Updated lastCallAt for worker: ${workerSid}`)
        }
        break

      case 'worker.activity.update':
        console.log(`👤 Worker activity updated: ${workerSid}`)
        const activitySid = formData.get('WorkerActivitySid') as string

        if (activitySid && workerSid) {
          const newStatus = ACTIVITY_MAP[activitySid] || 'offline'
          console.log(`   Status: ${newStatus}`)

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
        console.log('ℹ️ Unhandled event type')
    }

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('❌ TaskRouter event callback error:', error)
    return new Response(null, { status: 500 })
  }
}