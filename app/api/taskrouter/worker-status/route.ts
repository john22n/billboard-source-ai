/**
 * Worker Status API
 *
 * Allows reps to toggle their availability status (Available/Unavailable/Offline).
 * Updates both TaskRouter worker activity and database.
 *
 * Preserves existing worker attributes (e.g. simultaneous_ring, cell_phone)
 * by merging instead of replacing when updating.
 *
 * When a worker goes offline/unavailable with simultaneous_ring enabled:
 * - Cancels any pending cell phone calls so caller doesn't hang indefinitely
 */

import twilio from 'twilio';
import { db } from '@/db';
import { user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';
import { sseManager } from '@/lib/sse-manager';

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const WORKSPACE_SID = process.env.TASKROUTER_WORKSPACE_SID!;

const ACTIVITY_SIDS = {
  available: process.env.TASKROUTER_ACTIVITY_AVAILABLE_SID!,
  unavailable: process.env.TASKROUTER_ACTIVITY_UNAVAILABLE_SID!,
  offline: process.env.TASKROUTER_ACTIVITY_OFFLINE_SID!,
};

const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUser = await db
      .select({
        workerActivity: user.workerActivity,
        taskRouterWorkerSid: user.taskRouterWorkerSid,
      })
      .from(user)
      .where(eq(user.id, session.userId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!currentUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
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
      }
    );
  } catch (error) {
    console.error('❌ Worker status GET error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const newStatus = body.status as 'available' | 'unavailable' | 'offline';

    if (!['available', 'unavailable', 'offline'].includes(newStatus)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 });
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
      .then((rows) => rows[0]);

    if (!currentUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const effectiveStatus = newStatus;
    let workerSid = currentUser.taskRouterWorkerSid;

    // ─────────────────────────────────────────────
    // CREATE WORKER (if doesn't exist yet)
    // No existing attributes to merge — safe to build from scratch
    // ─────────────────────────────────────────────
    if (!workerSid && WORKSPACE_SID) {
      console.log('📋 Creating new TaskRouter worker for:', currentUser.email);

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
        });

      workerSid = worker.sid;
      console.log('✅ Worker created:', workerSid);
    }

    // ─────────────────────────────────────────────
    // UPDATE WORKER ACTIVITY
    // Fetch existing attributes first and merge — this preserves custom
    // fields like simultaneous_ring and cell_phone set via Twilio Console
    // ─────────────────────────────────────────────
    if (workerSid && WORKSPACE_SID) {
      // Fetch current attributes from Twilio to avoid overwriting custom fields
      let existingAttrs: Record<string, unknown> = {};
      try {
        const existingWorker = await client.taskrouter.v1
          .workspaces(WORKSPACE_SID)
          .workers(workerSid)
          .fetch();
        existingAttrs = JSON.parse(existingWorker.attributes || '{}');
        console.log('📋 Existing worker attributes fetched');
      } catch (err) {
        console.warn('⚠️ Could not fetch existing worker attributes, proceeding with defaults:', err);
      }

      // Merge: spread existing attrs first, then override only the fields we manage
      const mergedAttributes = JSON.stringify({
        ...existingAttrs,
        email: currentUser.email,
        contact_uri: `client:${currentUser.email}`,
        phoneNumber: currentUser.twilioPhoneNumber,
        available: effectiveStatus === 'available',
      });

      const maxRetries = 3;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .workers(workerSid)
            .update({
              activitySid: ACTIVITY_SIDS[effectiveStatus],
              attributes: mergedAttributes,
            });

          console.log(`✅ Worker ${currentUser.email} status updated to: ${effectiveStatus}`);
          lastError = null;
          break;
        } catch (err) {
          lastError = err as Error;
          const twilioError = err as { status?: number; code?: number };

          // 409 Conflict - another update in progress, retry after short delay
          if (twilioError.status === 409 || twilioError.code === 20409) {
            console.warn(`⚠️ Worker update conflict (attempt ${attempt}/${maxRetries}), retrying...`);
            await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
            continue;
          }

          // Other errors - don't retry
          throw err;
        }
      }

      if (lastError) {
        console.warn(`⚠️ Worker update failed after ${maxRetries} retries, continuing with DB update`);
      }
    }

    // Update database
    await db
      .update(user)
      .set({
        workerActivity: effectiveStatus,
        taskRouterWorkerSid: workerSid,
      })
      .where(eq(user.id, currentUser.id));

    // ─────────────────────────────────────────────
    // CLEANUP: Going offline/unavailable with simring enabled
    // Cancel any ringing cell calls to prevent caller hanging
    // ─────────────────────────────────────────────
    if ((effectiveStatus === 'offline' || effectiveStatus === 'unavailable') && workerSid) {
      try {
        // Fetch worker attributes to check simultaneous_ring flag
        let workerAttrs: Record<string, unknown> = {};
        try {
          const existingWorker = await client.taskrouter.v1
            .workspaces(WORKSPACE_SID)
            .workers(workerSid)
            .fetch();
          workerAttrs = JSON.parse(existingWorker.attributes || '{}');
        } catch (err) {
          console.warn('⚠️ Could not fetch worker attributes during offline cleanup:', err);
        }

        // If simultaneous_ring is enabled, cancel ringing cell calls
        if ((workerAttrs as any).simultaneous_ring && (workerAttrs as any).cell_phone) {
          console.log(`📱 Worker going ${effectiveStatus} with simring enabled — canceling ringing cell calls`);
          
          const contactUri = (workerAttrs as any).contact_uri || `client:${currentUser.email}`;
          try {
            const ringingCalls = await client.calls.list({ 
              to: (workerAttrs as any).cell_phone, 
              status: 'ringing', 
              limit: 10 
            });
            
            if (ringingCalls.length > 0) {
              for (const call of ringingCalls) {
                try {
                  await client.calls(call.sid).update({ status: 'canceled' });
                  console.log(`✅ Cell call ${call.sid} canceled on worker ${effectiveStatus}`);
                } catch (err) {
                  console.warn(`⚠️ Could not cancel cell call:`, (err as Error).message);
                }
              }
            }

            // Also cancel any in-progress GPP2 calls (clean shutdown)
            const inProgressGPP2 = await client.calls.list({
              to: contactUri,
              status: 'in-progress',
              limit: 10,
            });
            
            if (inProgressGPP2.length > 0) {
              console.log(`⏹️  Worker ${effectiveStatus} — canceling ${inProgressGPP2.length} in-progress GPP2 calls`);
              for (const call of inProgressGPP2) {
                try {
                  await client.calls(call.sid).update({ status: 'canceled' });
                  console.log(`✅ GPP2 call ${call.sid} canceled on worker ${effectiveStatus}`);
                } catch (err) {
                  console.warn(`⚠️ Could not cancel GPP2 call:`, (err as Error).message);
                }
              }
            }
          } catch (err) {
            console.warn('⚠️ Simring cleanup on offline failed:', (err as Error).message);
          }
        }
      } catch (err) {
        console.warn('⚠️ Offline cleanup error:', err);
      }
    }

    // Broadcast to SSE clients immediately
    if (sseManager.hasConnections(currentUser.id)) {
      sseManager.broadcast(currentUser.id, {
        status: effectiveStatus,
        hasWorker: !!workerSid,
      });
      console.log(`📡 Broadcasted ${effectiveStatus} to SSE clients`);
    }

    return Response.json({
      success: true,
      status: effectiveStatus,
      workerSid,
    });
  } catch (error) {
    console.error('❌ Worker status POST error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}