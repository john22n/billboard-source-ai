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

function hasValidTwilioSignature(req: Request, bodyText: string) {
  const twilioAuthToken = serverConfig.twilio.authToken
  if (!twilioAuthToken || !serverConfig.runtime.isProductionDeployment) {
    return true
  }

  const params = Object.fromEntries(new URLSearchParams(bodyText))
  return twilio.validateRequest(
    twilioAuthToken,
    req.headers.get('X-Twilio-Signature') || '',
    req.url,
    params,
  )
}

async function setWorkerActivity(workerSid: string, activitySid: string) {
  const { accountSid, authToken } =
    serverConfig.twilio.requireAccountCredentials()
  const workspaceSid = serverConfig.taskRouter.requireWorkspaceSid()
  const client = twilio(accountSid, authToken)
  await client.taskrouter.v1
    .workspaces(workspaceSid)
    .workers(workerSid)
    .update({ activitySid })
}

async function handleReservationAccepted(
  formData: FormData,
  workerSid: string,
  reservationSid: string,
) {
  console.log(`✅ Reservation accepted by worker: ${workerSid}`)
  if (!workerSid) return

  // Skip Busy switch for voicemail worker.
  const workerAttrsRaw = formData.get('WorkerAttributes') as string
  const workerAttrs = JSON.parse(workerAttrsRaw || '{}')
  if (workerAttrs.email === 'voicemail@system') {
    console.log('⏭️ Skipping Busy switch for voicemail worker')
    return
  }

  // Simultaneous-ring workers accept the reservation before the rep answers,
  // so simultaneous-dial-complete records their accepted attempt instead.
  if (!workerAttrs.simultaneous_ring) {
    await recordAcceptedAttempt({ reservationSid, workerSid })
  }

  try {
    const busyActivitySid = serverConfig.taskRouter.requireActivitySid('busy')
    await setWorkerActivity(workerSid, busyActivitySid)
    console.log(`✅ Worker ${workerSid} switched to Busy`)
  } catch (err) {
    console.error('❌ Failed to switch worker to Busy:', err)
  }
}

async function handleMissedReservation(
  reservationSid: string,
  workerSid: string,
  label: string,
) {
  await recordMissedAttempt({ reservationSid, workerSid })
  await resetWorkerToBack(workerSid, label)
}

async function handleWorkerActivityUpdate(
  formData: FormData,
  workerSid: string,
) {
  console.log(`👤 Worker activity updated: ${workerSid}`)
  const activitySid = formData.get('WorkerActivitySid') as string
  if (!activitySid || !workerSid) return

  const newStatus = getActivityMap()[activitySid] || 'offline'
  console.log(`   Status: ${newStatus}`)

  // Busy is transient and set automatically, so it is not persisted.
  if (newStatus === 'busy') {
    console.log('   ⏭️ Skipping DB update for Busy activity')
    return
  }

  const currentUser = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(eq(user.taskRouterWorkerSid, workerSid))
    .limit(1)
    .then((rows) => rows[0])

  if (!currentUser) return

  await db
    .update(user)
    .set({ workerActivity: newStatus })
    .where(eq(user.id, currentUser.id))
  console.log(`   ✅ Updated ${currentUser.email} to ${newStatus}`)
}

async function handleTaskRouterEvent(formData: FormData) {
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

    case 'reservation.accepted':
      await handleReservationAccepted(formData, workerSid, reservationSid)
      break

    case 'reservation.canceled':
      console.log(`❌ Reservation canceled for worker: ${workerSid}`)
      // Missed (suppressed if the rep just explicitly rejected this attempt).
      await handleMissedReservation(reservationSid, workerSid, 'cancellation')
      break

    case 'reservation.rejected':
      console.log(`🚫 Reservation rejected by worker: ${workerSid}`)
      // The explicit browser Reject is recorded by the browser endpoint and
      // stamps last_reject_at, so recordMissedAttempt is suppressed within the
      // window and the attempt is not double-counted.
      await handleMissedReservation(reservationSid, workerSid, 'rejection')
      break

    case 'reservation.timeout':
      console.log(`⏰ Reservation timeout for worker: ${workerSid}`)
      await handleMissedReservation(reservationSid, workerSid, 'timeout')
      break

    case 'task.canceled':
      console.log('🗑️ Task canceled')
      console.log('Reason:', formData.get('TaskCanceledReason') || 'unknown')
      break

    case 'task.completed':
      console.log(`📞 Task completed for worker: ${workerSid}`)
      break

    case 'worker.activity.update':
      await handleWorkerActivityUpdate(formData, workerSid)
      break

    default:
      console.log(`ℹ️ Unhandled event type: ${eventType}`)
  }
}

export async function POST(req: Request) {
  try {
    const bodyTextPromise = req.clone().text()
    const formData = await req.formData()

    if (!hasValidTwilioSignature(req, await bodyTextPromise)) {
      console.error('❌ Invalid Twilio signature on events callback')
      return new Response('Forbidden', { status: 403 })
    }

    await handleTaskRouterEvent(formData)

    return new Response(null, { status: 204 })
  } catch (error) {
    console.error('❌ TaskRouter event callback error:', error)
    return new Response(null, { status: 500 })
  }
}
