/**
 * Worker Status API
 *
 * Allows reps to toggle their availability status (Available/Unavailable/Offline).
 * Updates both TaskRouter worker activity and database.
 */

import twilio from 'twilio'
import { db } from '@/db'
import { user } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!

const ACTIVITY_SIDS = {
  available: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID!,
  unavailable: process.env.TASKROUTER_ACTIVITY_UNAVAILABLE_SID!,
  offline: process.env.TASKROUTER_ACTIVITY_OFFLINE_SID!,
}

const client = twilio(ACCOUNT_SID, AUTH_TOKEN)

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const currentUser = await db
      .select({
        workerActivity: user.workerActivity,
        taskRouterWorkerSid: user.taskRouterWorkerSid,
      })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1)
      .then((rows) => rows[0])

    if (!currentUser) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    return Response.json(
      {
        status: currentUser.workerActivity || 'offline',
        hasWorker: !!currentUser.taskRouterWorkerSid,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=5, stale-while-revalidate=10',
        },
      },
    )
  } catch (error) {
    console.error('❌ Worker status GET error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const newStatus = body.status as 'available' | 'unavailable' | 'offline'

    if (!['available', 'unavailable', 'offline'].includes(newStatus)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 })
    }

    const currentUser = await db
      .select({
        id: user.id,
        email: user.email,
        taskRouterWorkerSid: user.taskRouterWorkerSid,
        twilioPhoneNumber: user.twilioPhoneNumber,
      })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1)
      .then((rows) => rows[0])

    if (!currentUser) {
      return Response.json({ error: 'User not found' }, { status: 404 })
    }

    const effectiveStatus = newStatus

    let workerSid = currentUser.taskRouterWorkerSid

    // Create worker if doesn't exist
    if (!workerSid && WORKSPACE_SID) {
      console.log('📋 Creating new TaskRouter worker for:', currentUser.email)

      const worker = await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers.create({
          friendlyName: currentUser.email,
          activitySid: ACTIVITY_SIDS[effectiveStatus],
          attributes: JSON.stringify({
            email: currentUser.email,
            contact_uri: `client:${currentUser.email}`,
            phoneNumber: currentUser.twilioPhoneNumber,
            available: effectiveStatus === 'available',
          }),
        })

      workerSid = worker.sid
      console.log('✅ Worker created:', workerSid)
    }

    // Update worker activity in TaskRouter with retry for conflicts
    if (workerSid && WORKSPACE_SID) {
      const maxRetries = 3
      let lastError: Error | null = null

      // ── Preserve custom worker attributes (simultaneous_ring, cell_phone) ──
      // Fetch the current Twilio worker attributes and merge them so that any
      // custom fields set via the Console (e.g. simultaneous_ring: true,
      // cell_phone: "+1...") are not wiped on every status toggle.
      // Standard fields (email, available, phoneNumber) are always overwritten
      // with current values.  contact_uri is preserved if already set to a
      // custom value (e.g. "client:mcdonald") rather than defaulting to
      // "client:<email>" which could break the simultaneous-ring <Client> target.
      let existingAttrs: Record<string, unknown> = {}
      try {
        const existingWorker = await client.taskrouter.v1
          .workspaces(WORKSPACE_SID)
          .workers(workerSid)
          .fetch()
        existingAttrs = JSON.parse(existingWorker.attributes ?? '{}')
      } catch (fetchErr) {
        console.warn(
          '⚠️ Could not fetch existing worker attributes for merge (proceeding with defaults):',
          fetchErr,
        )
      }

      const mergedAttributes: Record<string, unknown> = { ...existingAttrs }
      mergedAttributes.email = currentUser.email
      mergedAttributes.available = effectiveStatus === 'available'
      if (currentUser.twilioPhoneNumber) {
        mergedAttributes.phoneNumber = currentUser.twilioPhoneNumber
      }
      if (!existingAttrs.contact_uri) {
        mergedAttributes.contact_uri = `client:${currentUser.email}`
      }

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .workers(workerSid)
            .update({
              activitySid: ACTIVITY_SIDS[effectiveStatus],
              attributes: JSON.stringify(mergedAttributes),
            })

          console.log(
            `✅ Worker ${currentUser.email} status updated to: ${effectiveStatus}`,
          )
          lastError = null
          break
        } catch (err) {
          lastError = err as Error
          const twilioError = err as { status?: number; code?: number }

          // 409 Conflict - another update in progress, retry after short delay
          if (twilioError.status === 409 || twilioError.code === 20409) {
            console.warn(
              `⚠️ Worker update conflict (attempt ${attempt}/${maxRetries}), retrying...`,
            )
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
            continue
          }

          // Other errors - don't retry
          throw err
        }
      }

      if (lastError) {
        console.warn(
          `⚠️ Worker update failed after ${maxRetries} retries, continuing with DB update`,
        )
      }
    }

    // Update database
    await db
      .update(user)
      .set({
        workerActivity: effectiveStatus,
        taskRouterWorkerSid: workerSid,
      })
      .where(eq(user.id, currentUser.id))

    return Response.json({
      success: true,
      status: effectiveStatus,
      workerSid,
    })
  } catch (error) {
    console.error('❌ Worker status POST error:', error)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
