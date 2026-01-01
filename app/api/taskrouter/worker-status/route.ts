/**
 * Worker Status API
 * 
 * Allows reps to toggle their availability status (Available/Unavailable/Offline).
 * Updates both TaskRouter worker activity and database.
 */

import twilio from 'twilio';
import { db } from '@/db';
import { user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { getSession } from '@/lib/auth';

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
      .then(rows => rows[0]);

    if (!currentUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    return Response.json({
      status: currentUser.workerActivity || 'offline',
      hasWorker: !!currentUser.taskRouterWorkerSid,
    });
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
      .then(rows => rows[0]);

    if (!currentUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    let workerSid = currentUser.taskRouterWorkerSid;

    // Create worker if doesn't exist
    if (!workerSid && WORKSPACE_SID) {
      console.log('📋 Creating new TaskRouter worker for:', currentUser.email);
      
      const worker = await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers.create({
          friendlyName: currentUser.email,
          activitySid: ACTIVITY_SIDS[newStatus],
          attributes: JSON.stringify({
            email: currentUser.email,
            contact_uri: `client:${currentUser.email}`,
            phone: currentUser.twilioPhoneNumber,
          }),
        });

      workerSid = worker.sid;
      console.log('✅ Worker created:', workerSid);
    }

    // Update worker activity in TaskRouter
    if (workerSid && WORKSPACE_SID) {
      await client.taskrouter.v1
        .workspaces(WORKSPACE_SID)
        .workers(workerSid)
        .update({
          activitySid: ACTIVITY_SIDS[newStatus],
        });

      console.log(`✅ Worker ${currentUser.email} status updated to: ${newStatus}`);
    }

    // Update database
    await db
      .update(user)
      .set({
        workerActivity: newStatus,
        taskRouterWorkerSid: workerSid,
      })
      .where(eq(user.id, currentUser.id));

    return Response.json({
      success: true,
      status: newStatus,
      workerSid,
    });
  } catch (error) {
    console.error('❌ Worker status POST error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
